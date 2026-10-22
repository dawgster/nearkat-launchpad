import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha384 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "vitest";
import {
  checkPhalaReport,
  type DstackEvent,
  dstackEventDigest,
  expectedReportData,
  parseQuote,
  replayRtmr,
  toHex,
} from "../src/lib/tdx.ts";

const KEY = "ed25519:4eUKxcVz6kQgHHvJDY2jkm6mYwSj8b8N3pHn1dQd8Z8C";
const APP = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
const SEAL = "ab".repeat(32);

function event(name: string, payloadHex: string, imr = 3): DstackEvent {
  const e = { imr, event_type: 0x08000001, digest: "", event: name, event_payload: payloadHex };
  return { ...e, digest: toHex(dstackEventDigest(e)) };
}

/** A version-4 TDX quote with only the fields this page reads filled in. */
function quote(rtmr3: Uint8Array, reportData: Uint8Array, version = 4): string {
  const extra = version === 5 ? 6 : 0;
  const bytes = new Uint8Array(48 + extra + 584 + 64);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, version, true);
  view.setUint32(4, 0x81, true);
  bytes.set(rtmr3, 48 + extra + 472);
  bytes.set(reportData, 48 + extra + 520);
  return toHex(bytes);
}

function report(overrides: { events?: DstackEvent[]; key?: string; appId?: string } = {}) {
  const events = overrides.events ?? [
    event("compose-hash", "c0ffee"),
    event("app-id", APP),
    event("instance-id", "01"),
    event("boot", "aa", 1),
  ];
  return {
    quote: quote(replayRtmr(events, 3), expectedReportData(KEY, SEAL)),
    event_log: JSON.stringify(events),
    keeper_public_key: overrides.key ?? KEY,
    seal_public_key: SEAL,
    app_id: overrides.appId ?? APP,
  };
}

describe("parseQuote", () => {
  test("reads RTMR3 and the report data from version 4 and 5 quotes", () => {
    const rtmr = new Uint8Array(48).fill(7);
    const data = new Uint8Array(64).fill(9);
    for (const version of [4, 5]) {
      const parsed = parseQuote(quote(rtmr, data, version));
      expect(parsed.version).toBe(version);
      expect(parsed.rtmr3).toEqual(rtmr);
      expect(parsed.reportData).toEqual(data);
    }
  });

  test("refuses something that is not a TDX quote", () => {
    expect(() => parseQuote("00")).toThrow(/Too short/);
    const sgx = quote(new Uint8Array(48), new Uint8Array(64)).replace(/^(.{8})81/, "$100");
    expect(() => parseQuote(sgx)).toThrow(/Not a TDX quote/);
  });
});

describe("checkPhalaReport", () => {
  test("accepts a quote for this key whose log names this app", () => {
    expect(checkPhalaReport(report())).toEqual({
      status: "read",
      bindsKey: true,
      logMatchesQuote: true,
      appId: APP,
      claimMatchesLog: true,
    });
  });

  test("notices a quote made for a different key", () => {
    const check = checkPhalaReport({ ...report(), keeper_public_key: "ed25519:other" });
    expect(check).toMatchObject({ bindsKey: false });
  });

  test("notices an event log that was edited after the fact", () => {
    const honest = report();
    const events = JSON.parse(honest.event_log) as DstackEvent[];
    // Swap in a different app id, with a digest that matches it, but the quote no longer does.
    const forged = events.map((e) => (e.event === "app-id" ? event("app-id", "ff") : e));
    const check = checkPhalaReport({ ...honest, event_log: JSON.stringify(forged), app_id: "ff" });
    expect(check).toMatchObject({ logMatchesQuote: false });
  });

  test("ignores an app id whose payload doesn't produce its digest", () => {
    const events = report().event_log;
    const tampered = (JSON.parse(events) as DstackEvent[]).map((e) =>
      e.event === "app-id" ? { ...e, event_payload: "ff" } : e,
    );
    const check = checkPhalaReport({ ...report({ events: tampered }), app_id: "ff" });
    expect(check).toMatchObject({ logMatchesQuote: true, appId: null, claimMatchesLog: false });
  });

  test("notices a keeper claiming a different app than its log shows", () => {
    expect(checkPhalaReport(report({ appId: "ff" }))).toMatchObject({ claimMatchesLog: false });
  });

  test("says why an unreadable report can't be checked", () => {
    expect(checkPhalaReport({ ...report(), quote: "zz" })).toMatchObject({ status: "unreadable" });
  });
});

describe("a real dstack quote", () => {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), "test/fixtures/dstack-quote-report.json"), "utf8"),
  ) as { quote: string; event_log: string; report_data: string };
  const events = JSON.parse(fixture.event_log) as DstackEvent[];

  test("parses to the report data dstack reported", () => {
    expect(toHex(parseQuote(fixture.quote).reportData)).toBe(
      fixture.report_data.replace(/^0x/, ""),
    );
  });

  test("replays its event log to the RTMR3 in its quote", () => {
    expect(toHex(replayRtmr(events, 3))).toBe(toHex(parseQuote(fixture.quote).rtmr3));
  });

  test("recomputes every runtime event's digest", () => {
    for (const e of events.filter((e) => e.imr === 3)) {
      expect(toHex(dstackEventDigest(e)), e.event).toBe(e.digest);
    }
  });

  test("names the app it ran as", () => {
    const check = checkPhalaReport({
      quote: fixture.quote,
      event_log: fixture.event_log,
      keeper_public_key: "ed25519:x",
      seal_public_key: SEAL,
      app_id: "3763bc34552cf3a27ff71ad5f7a90471562a1a2d",
    });
    // Its report data wasn't made for a keeper key, but the app and log hold up.
    expect(check).toMatchObject({
      bindsKey: false,
      logMatchesQuote: true,
      appId: "3763bc34552cf3a27ff71ad5f7a90471562a1a2d",
      claimMatchesLog: true,
    });
  });
});

test("computes dstack v2 digests over canonical JSON", () => {
  // The vector from dstack's own test of v2 events.
  const digest = dstackEventDigest({
    imr: 3,
    event_type: 0x08000001,
    digest: "",
    event: "compose-hash",
    event_payload: "abcd",
    version: 2,
  });
  expect(digest).toEqual(
    sha384(new TextEncoder().encode('{"name":"compose-hash","payload":"abcd","type":134217729}')),
  );
});

test("notices a quote made for a different sealing key", () => {
  const check = checkPhalaReport({ ...report(), seal_public_key: "cd".repeat(32) });
  expect(check).toMatchObject({ bindsKey: false });
});
