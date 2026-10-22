import { sha256, sha384 } from "@noble/hashes/sha2.js";

/**
 * What a browser can check about a keeper running in a Phala (dstack) app,
 * without Intel's collateral: that the quote speaks for the keeper's key, and
 * which app its event log says it is. Intel's signature on the quote is not
 * checked here; Phala's verifier does that.
 */

const utf8 = (text: string) => new TextEncoder().encode(text);

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error("Not a hex string");
  }
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const TDX_TEE_TYPE = 0x81;
const HEADER = 48;
/** Offsets inside the TD report body. */
const RTMR3 = 472;
const REPORT_DATA = 520;
const BODY = 584;

export interface TdxQuote {
  version: number;
  rtmr3: Uint8Array;
  reportData: Uint8Array;
}

/** Reads the fields this page checks from a TDX quote (versions 4 and 5). */
export function parseQuote(hex: string): TdxQuote {
  const quote = fromHex(hex);
  const view = new DataView(quote.buffer, quote.byteOffset, quote.byteLength);
  if (quote.length < HEADER + BODY) {
    throw new Error("Too short to be a TDX quote");
  }
  const version = view.getUint16(0, true);
  if (view.getUint32(4, true) !== TDX_TEE_TYPE) {
    throw new Error("Not a TDX quote");
  }
  // Version 5 puts a body type and size between the header and the body.
  const body = version === 4 ? HEADER : version === 5 ? HEADER + 6 : -1;
  if (body < 0 || quote.length < body + BODY) {
    throw new Error(`Unsupported TDX quote version ${version}`);
  }
  return {
    version,
    rtmr3: quote.slice(body + RTMR3, body + RTMR3 + 48),
    reportData: quote.slice(body + REPORT_DATA, body + REPORT_DATA + 64),
  };
}

/** The report data a keeper puts in its quote. Must match the keeper's `reportDataFor`. */
export function expectedReportData(publicKey: string, sealPublicKey: string): Uint8Array {
  const out = new Uint8Array(64);
  out.set(sha256(utf8(`nearkat-keeper:v2:${publicKey}:${sealPublicKey}`)));
  return out;
}

export interface DstackEvent {
  imr: number;
  event_type: number;
  digest: string;
  event: string;
  event_payload: string;
  /** 1 (binary digest) when absent, or 2 (canonical JSON digest). */
  version?: number;
}

/** Replays one measurement register from the event log, as the TDX module extends it. */
export function replayRtmr(events: DstackEvent[], imr: number): Uint8Array {
  let mr = new Uint8Array(48);
  for (const event of events.filter((e) => e.imr === imr)) {
    const digest = new Uint8Array(48);
    digest.set(fromHex(event.digest).subarray(0, 48));
    const joined = new Uint8Array(96);
    joined.set(mr);
    joined.set(digest, 48);
    mr = sha384(joined);
  }
  return mr;
}

/**
 * The digest dstack records for one of its runtime events. Version 1 hashes
 * `type_le || ":" || name || ":" || payload`; version 2 hashes RFC 8785
 * canonical JSON of the name, hex payload and type.
 */
export function dstackEventDigest(event: DstackEvent): Uint8Array {
  const payload = fromHex(event.event_payload);
  if ((event.version ?? 1) === 2) {
    const canonical = `{"name":${JSON.stringify(event.event)},"payload":"${toHex(payload)}","type":${0x08000001}}`;
    return sha384(utf8(canonical));
  }
  const type = new Uint8Array(4);
  new DataView(type.buffer).setUint32(0, event.event_type, true);
  const parts = [type, utf8(":"), utf8(event.event), utf8(":"), payload];
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return sha384(joined);
}

export interface PhalaReport {
  quote: string;
  event_log: string;
  keeper_public_key: string;
  /** The X25519 key creators seal prompts to, hex. */
  seal_public_key: string;
  app_id: string;
}

export type PhalaCheck =
  | { status: "unreadable"; reason: string }
  | {
      status: "read";
      /** The quote's report data commits to the keeper's reported NEAR key. */
      bindsKey: boolean;
      /** The event log replays to the RTMR3 in the quote. */
      logMatchesQuote: boolean;
      /** The app id the event log records, if its event is intact. */
      appId: string | null;
      /** The app id the keeper claims matches the one the log records. */
      claimMatchesLog: boolean;
    };

/** Everything about a Phala keeper report that can be checked in the browser. */
export function checkPhalaReport(report: PhalaReport): PhalaCheck {
  let quote: TdxQuote;
  let events: DstackEvent[];
  try {
    quote = parseQuote(report.quote);
    events = JSON.parse(report.event_log) as DstackEvent[];
    if (!Array.isArray(events)) {
      throw new Error("The event log is not a list");
    }
  } catch (error) {
    return { status: "unreadable", reason: String((error as Error).message ?? error) };
  }
  const bindsKey =
    toHex(quote.reportData) ===
    toHex(expectedReportData(report.keeper_public_key, report.seal_public_key ?? ""));
  let logMatchesQuote = false;
  let appId: string | null = null;
  try {
    logMatchesQuote = toHex(replayRtmr(events, 3)) === toHex(quote.rtmr3);
    const event = events.find((e) => e.imr === 3 && e.event === "app-id");
    // Only trust the payload if it is what the measured digest was made from.
    if (event && toHex(dstackEventDigest(event)) === event.digest.toLowerCase()) {
      appId = event.event_payload.toLowerCase();
    }
  } catch {
    logMatchesQuote = false;
  }
  return {
    status: "read",
    bindsKey,
    logMatchesQuote,
    appId,
    claimMatchesLog: appId !== null && appId === report.app_id.toLowerCase(),
  };
}
