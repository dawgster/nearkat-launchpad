import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { type Dataset, DatasetDrop } from "../components/DatasetDrop.tsx";
import { Icon } from "../components/Icon.tsx";
import { Shell } from "../components/Shell.tsx";
import { TokenSigil } from "../components/TokenSigil.tsx";
import { type LaunchProgress, launchDataset, sealKeyForApp } from "../lib/datasetLaunch.ts";
import { formatNear, parseNear, shorten } from "../lib/format.ts";
import type { Keeper } from "../lib/keeper.ts";
import {
  appIdProblem,
  Launchpad,
  MAX_PROMPT_CHARS,
  MAX_STARTER_CHARS,
  PROMPT_TEMPLATES,
  promptFor,
  SAMPLE_STORAGE_DEPOSIT,
  type SealedPrompt,
  slugFrom,
  slugProblem,
} from "../lib/launchpad.ts";
import { describeProblem } from "../lib/problems.ts";
import { datasetProblem } from "../lib/samples.ts";
import { sealPrompt } from "../lib/sealing.ts";
import { type KeeperPrivacy, privacyOf } from "../lib/tdx.ts";
import { useAsync } from "../lib/useAsync.ts";
import { useServices } from "../services.tsx";
import { useWallet } from "../wallet/WalletProvider.tsx";

function Field({
  id,
  label,
  hint,
  problem,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  problem?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="hint mt-1">
          {hint}
        </p>
      )}
      <div className="mt-2">{children}</div>
      {problem && (
        <p className="mt-1 text-sm text-alarm" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** One numbered part of the form, drawn as a card. A fieldset when it groups choices. */
function Step({
  n,
  title,
  children,
  group = false,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  group?: boolean;
}) {
  const heading = (
    <p className="card-title mb-5 flex items-center gap-3" aria-hidden={group || undefined}>
      <span className="flex size-7 items-center justify-center rounded-full bg-glow/12 font-mono text-xs text-glow ring-1 ring-glow/30">
        {n}
      </span>
      {title}
    </p>
  );
  return group ? (
    <fieldset className="card">
      <legend className="sr-only">{title}</legend>
      {heading}
      {children}
    </fieldset>
  ) : (
    <section className="card">
      {heading}
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function Counter({ text, max }: { text: string; max: number }) {
  return (
    <p className={`mt-1 text-right text-xs ${text.length > max ? "text-alarm" : "text-mist"}`}>
      {text.length} / {max}
    </p>
  );
}

/** A percentage typed by a person, as basis points, or null if invalid. */
function percentToBps(text: string, max: number): number | null {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= max * 100 ? bps : null;
}

/** Seals secret instructions to the sealing key of this app's keeper; see `sealKeyForApp`. */
async function sealForApp(keeper: Keeper, appId: string, secret: string): Promise<SealedPrompt> {
  const key = sealKeyForApp(await keeper.attestation(), appId, "Secret instructions");
  return { ciphertext: await sealPrompt(key, secret), sealed_to: key };
}

/** What a progress bar says for each step of a dataset launch. */
const PROGRESS_LABELS = {
  sealing: "Sealing pictures in this browser",
  launching: "Launching the collection",
  storing: "The keeper is storing the samples",
} as const;

const TEMPLATE_CHIP =
  "rounded-full border border-glow/35 bg-glow/5 px-3 py-1 text-sm transition-colors hover:border-glow hover:bg-glow/12 aria-pressed:border-glow aria-pressed:bg-glow/15";

/** Where the pictures will be sealed to, and the creator's go-ahead when that isn't a TEE. */
function SealingNote({
  privacy,
  understood,
  onUnderstood,
  problem,
}: {
  privacy: KeeperPrivacy | null;
  understood: boolean;
  onUnderstood: (value: boolean) => void;
  problem: string | null;
}) {
  if (privacy === null) {
    return <p className="text-sm text-mist">Checking where the keeper runs…</p>;
  }
  if (privacy.kind === "tee") {
    return (
      <p className="flex items-start gap-2 text-sm text-glow">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
        <span>
          Sealed to a key that exists only inside the keeper's TEE app
          {privacy.appId ? ` (Phala app ${privacy.appId})` : ""}, checked in this browser against
          its hardware quote.
        </span>
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-2 text-sm text-lamp">
        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
        <span>
          {privacy.kind === "local"
            ? "This keeper runs in local mode, not in a sealed TEE app. The pictures are still encrypted on the way, but whoever runs the keeper could see them."
            : `This browser couldn't confirm the keeper runs in a sealed TEE app: ${privacy.reason}.`}
        </span>
      </p>
      <label className="flex items-start gap-2.5 text-sm text-mist">
        <input
          type="checkbox"
          className="mt-1"
          checked={understood}
          onChange={(event) => onUnderstood(event.target.checked)}
        />
        I understand this keeper isn't sealed, so whoever runs it could see the pictures.
      </label>
      {problem && (
        <p className="text-sm text-alarm" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Where anyone launches their own collection of prompt-based NFTs. */
export function Launch() {
  const { launchpad } = useServices();
  if (!launchpad) {
    return (
      <Shell world="surface">
        <h1 className="pt-16 text-5xl">No launchpad here</h1>
        <p className="mt-4 text-mist">This deployment has no launchpad configured.</p>
      </Shell>
    );
  }
  return <LaunchForm launchpad={launchpad} />;
}

function LaunchForm({ launchpad }: { launchpad: Launchpad }) {
  const wallet = useWallet();
  const { prices, keeper, config: app, reader, session } = useServices();
  const navigate = useNavigate();
  const [config] = useAsync("launchpad", () => launchpad.getConfig());
  const [listing] = useAsync("collections", () => launchpad.collections());

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [starter, setStarter] = useState("");
  const [historyImport, setHistoryImport] = useState(false);
  const [price, setPrice] = useState("1");
  const [supply, setSupply] = useState("");
  const [private_, setPrivate] = useState(false);
  const [appId, setAppId] = useState("");
  const [keeperId, setKeeperId] = useState("");
  const [secret, setSecret] = useState("");
  const [royalty, setRoyalty] = useState("5");
  const [share, setShare] = useState("0");
  const [chatPrice, setChatPrice] = useState("");
  const [savePrice, setSavePrice] = useState("");
  const [ownImages, setOwnImages] = useState(false);
  const [imageBase, setImageBase] = useState("");
  const [imageExtension, setImageExtension] = useState("png");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  /** A dataset's tokens hold labelled pictures instead of sharing a prompt. */
  const [kind, setKind] = useState<"character" | "dataset">("character");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  /** The creator accepts sealing to a keeper this browser can't confirm runs in a TEE. */
  const [understood, setUnderstood] = useState(false);
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const [finished, setFinished] = useState<{ count: number; account: string } | null>(null);
  const [attestation] = useAsync(kind === "dataset" ? "keeper-attestation" : null, () =>
    keeper.attestation(),
  );
  const privacy =
    attestation.status === "ready"
      ? privacyOf(attestation.data)
      : attestation.status === "error"
        ? ({ kind: "unknown", reason: describeProblem(attestation.error) } as const)
        : null;
  const isDataset = kind === "dataset";

  const effectiveSlug = slugEdited ? slug : slugFrom(name);
  const account = effectiveSlug ? launchpad.accountFor(effectiveSlug) : null;

  // Look the name up shortly after typing stops, so a taken one is flagged before paying.
  useEffect(() => {
    setTaken(false);
    if (slugProblem(effectiveSlug)) {
      return;
    }
    const timer = setTimeout(() => {
      launchpad.isTaken(effectiveSlug).then(setTaken, () => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [effectiveSlug, launchpad]);

  const mintPrice = parseNear(price);
  const royaltyBps = percentToBps(royalty, 25);
  const shareBps = percentToBps(share, 50);
  const chatPriceValue = chatPrice.trim() ? parseNear(chatPrice) : null;
  const savePriceValue = savePrice.trim() ? parseNear(savePrice) : null;
  const maxSupply = supply.trim() === "" ? null : Number(supply);
  const problems = {
    name: name.trim() ? null : "Give the collection a name.",
    symbol: /^[A-Z0-9]{1,10}$/.test(symbol) ? null : "1 to 10 capital letters or digits.",
    slug: effectiveSlug ? slugProblem(effectiveSlug) : "Pick an address.",
    prompt: isDataset
      ? null
      : prompt.trim()
        ? prompt.length > MAX_PROMPT_CHARS
          ? "Too long."
          : null
        : "Write the prompt every token shares.",
    starter: isDataset
      ? null
      : starter.trim()
        ? starter.length > MAX_STARTER_CHARS
          ? "Too long."
          : null
        : "Say where each token starts.",
    price: !isDataset && mintPrice === null ? "Enter an amount in NEAR, like 1 or 0.5." : null,
    supply:
      isDataset || maxSupply === null || (Number.isInteger(maxSupply) && maxSupply > 0)
        ? null
        : "A whole number, or leave it empty for no limit.",
    dataset: isDataset
      ? dataset
        ? datasetProblem(
            dataset.classes,
            dataset.samples.map((s) => s.label),
          )
        : "Drop a folder of pictures, one folder per class."
      : null,
    // Without a TEE, whoever runs the keeper could see the pictures: the creator must say it's fine.
    unsealed:
      isDataset && !private_ && privacy?.kind !== "tee" && !understood
        ? "Confirm that this keeper may see the pictures."
        : null,
    appId: private_ ? appIdProblem(appId) : null,
    secret: !isDataset && secret.length > MAX_PROMPT_CHARS ? "Too long." : null,
    royalty: royaltyBps === null ? "A percentage from 0 to 25." : null,
    share: shareBps === null ? "A percentage from 0 to 50." : null,
    chatPrice:
      chatPrice.trim() && chatPriceValue === null ? "An amount in NEAR, or leave it empty." : null,
    savePrice:
      savePrice.trim() && savePriceValue === null ? "An amount in NEAR, or leave it empty." : null,
    imageBase:
      ownImages && !/^https?:\/\/\S+\/$/.test(imageBase)
        ? "A web address ending in /, like https://example.com/art/"
        : null,
    imageExtension:
      ownImages && !/^[A-Za-z0-9]{1,8}$/.test(imageExtension) ? "Like png, jpg or webp." : null,
  };
  // A dataset that is already launched can be finished: its samples are sealed again.
  const valid = Object.values(problems).every((p) => p === null) && (!taken || isDataset);
  const [touched, setTouched] = useState(false);
  const show = (p: string | null) => (touched ? p : null);

  /** This address holds the creator's earlier launch of the dataset: only missing samples are stored. */
  const resuming = isDataset && taken;
  const sampleCount = isDataset ? (dataset?.samples.length ?? 0) : 0;
  const sampleStorage = SAMPLE_STORAGE_DEPOSIT * BigInt(sampleCount);
  const cost =
    config.status === "ready"
      ? BigInt(config.data.launch_fee) + BigInt(config.data.collection_funding) + sampleStorage
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    // A dataset has no mint price: the field is hidden, so a bad one must not block it.
    if (!valid || cost === null || (!isDataset && mintPrice === null) || !wallet.near) {
      return;
    }
    setBusy(true);
    setProblem(null);
    setFinished(null);
    if (isDataset && dataset) {
      try {
        if (!wallet.accountId || !session) {
          throw new Error("Connect your wallet first.");
        }
        const done = await launchDataset(
          {
            launchpad,
            launcher: new Launchpad(wallet.near, launchpad.id),
            keeper,
            session,
            reader,
            accountId: wallet.accountId,
            keeperUrl: app.keeperUrl,
          },
          dataset,
          {
            slug: effectiveSlug,
            name: name.trim(),
            symbol,
            royaltyBps: royaltyBps ?? 0,
            app: private_ ? { appId, keeperId } : null,
            ownImages: ownImages ? { baseUri: imageBase, extension: imageExtension } : null,
            understood,
            deposit: cost,
            onProgress: setProgress,
          },
        );
        setFinished(done);
        setTaken(true);
      } catch (error) {
        setProblem(describeProblem(error));
      } finally {
        setProgress(null);
        setBusy(false);
      }
      return;
    }
    try {
      const sealedPrompt =
        private_ && secret.trim() ? await sealForApp(keeper, appId, secret) : null;
      await new Launchpad(wallet.near, launchpad.id).launch(
        {
          slug: effectiveSlug,
          name: name.trim(),
          symbol,
          mintPrice: mintPrice ?? 0n,
          prompt,
          starter,
          maxSupply,
          phalaAppId: private_ ? appId : null,
          keeperId: private_ && keeperId.trim() ? keeperId.trim() : null,
          images: ownImages
            ? { baseUri: imageBase, extension: imageExtension }
            : // The keeper draws each token's art live, as it grows.
              {
                baseUri: `${app.keeperUrl}/art/${launchpad.accountFor(effectiveSlug)}/`,
                extension: "svg",
              },
          terms: {
            royaltyBps: royaltyBps ?? 0,
            creatorShareBps: shareBps ?? 0,
            chatPrice: chatPriceValue,
            savePrice: savePriceValue,
          },
          sealedPrompt,
          historyImport,
          dataset: null,
        },
        cost,
      );
      // A failed launch is refunded inside the same transaction; check it went live.
      if (!(await launchpad.isTaken(effectiveSlug))) {
        throw new Error("The launch did not go through. Your deposit was refunded.");
      }
      navigate(`/c/${launchpad.accountFor(effectiveSlug)}`);
    } catch (error) {
      setProblem(describeProblem(error));
    } finally {
      setBusy(false);
    }
  }

  const sample = promptFor(prompt || "…", name.trim() || "Your collection", "1");

  return (
    <Shell world="surface">
      <div className="pt-8 sm:pt-12">
        <p className="chip chip-accent mb-5">
          <Icon name="rocket" size={14} />
          Launchpad
        </p>
        <h1 className="text-[2.4rem] leading-[1.05] sm:text-6xl">Launch a collection</h1>
        <p className="mt-5 max-w-[40rem] text-lg leading-relaxed text-mist">
          Every token in your collection shares one prompt and starts from the same context. From
          there, each grows its own way through conversations with whoever owns it, and keeps what
          it learned when it changes hands.
        </p>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-8">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Step n={1} title="Your collection">
            <div className="grid gap-6 sm:grid-cols-[1fr_9rem]">
              <Field id="name" label="Name" problem={show(problems.name)}>
                <input
                  id="name"
                  className="field"
                  value={name}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field id="symbol" label="Symbol" problem={show(problems.symbol)}>
                <input
                  id="symbol"
                  className="field"
                  value={symbol}
                  maxLength={10}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                />
              </Field>
            </div>

            <Field
              id="slug"
              label="Address"
              hint="The collection gets its own NEAR account. This can't be changed later."
              problem={
                taken
                  ? isDataset
                    ? "That address is taken. If it's your dataset, launching again stores only the samples it is missing."
                    : "That address is taken."
                  : show(problems.slug)
              }
            >
              <div className="flex items-center gap-2">
                <input
                  id="slug"
                  className="field max-w-xs"
                  value={effectiveSlug}
                  aria-describedby="slug-hint"
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                />
                <span className="truncate font-mono text-sm text-mist">.{launchpad.id}</span>
              </div>
            </Field>
          </Step>

          <Step n={2} title="What every token is">
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-sm text-mist">Start from:</span>
              {PROMPT_TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  className={TEMPLATE_CHIP}
                  aria-pressed={!isDataset && prompt === template.prompt}
                  onClick={() => {
                    setKind("character");
                    setPrompt(template.prompt);
                    setStarter(template.starter);
                    setHistoryImport("historyImport" in template && template.historyImport);
                  }}
                >
                  {template.label}
                </button>
              ))}
              <button
                type="button"
                className={TEMPLATE_CHIP}
                aria-pressed={isDataset}
                onClick={() => {
                  setKind("dataset");
                  setHistoryImport(false);
                }}
              >
                Dataset
              </button>
            </div>
            {isDataset ? (
              <>
                <div>
                  <p className="label">Pictures</p>
                  <p className="hint mt-1">
                    Every token holds one labelled picture for training models. They are all minted
                    to you at launch, and can be lent to training apps.
                  </p>
                  <div className="mt-3">
                    <DatasetDrop onChange={setDataset} disabled={busy} />
                  </div>
                  {show(problems.dataset) && (
                    <p className="mt-2 text-sm text-alarm" role="alert">
                      {problems.dataset}
                    </p>
                  )}
                </div>
                {!private_ && (
                  <SealingNote
                    privacy={privacy}
                    understood={understood}
                    onUnderstood={setUnderstood}
                    problem={show(problems.unsealed)}
                  />
                )}
              </>
            ) : (
              <>
                <Field
                  id="prompt"
                  label="Prompt"
                  hint="What every token is. Any kind of prompt works. {name} and {token_id} are filled in for each token. Everyone can read it before minting."
                  problem={show(problems.prompt)}
                >
                  <textarea
                    id="prompt"
                    className="field min-h-36"
                    value={prompt}
                    aria-describedby="prompt-hint"
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <Counter text={prompt} max={MAX_PROMPT_CHARS} />
                </Field>

                <Field
                  id="starter"
                  label="Where each token starts"
                  hint="Its first memory of itself. After that it changes only through conversations with its owner. Nobody can write it, you included."
                  problem={show(problems.starter)}
                >
                  <textarea
                    id="starter"
                    className="field min-h-24"
                    value={starter}
                    aria-describedby="starter-hint"
                    onChange={(e) => setStarter(e.target.value)}
                  />
                  <Counter text={starter} max={MAX_STARTER_CHARS} />
                </Field>
                <label className="option">
                  <input
                    type="checkbox"
                    checked={historyImport}
                    onChange={(e) => setHistoryImport(e.target.checked)}
                  />
                  <span>
                    Owners can teach their token their ChatGPT or Claude history
                    <span className="block text-sm text-mist">
                      The export is opened and trimmed in the owner's browser and sealed to the
                      keeper; the token keeps only what it learns. Good for companions and
                      recommenders; leave it off for tokens that should grow only by being talked
                      to. Fixed at launch.
                    </span>
                  </span>
                </label>
              </>
            )}
          </Step>

          <Step n={3} title="Price and earnings">
            {isDataset ? (
              <Field
                id="royalty"
                label="Royalty on resales (%)"
                hint="Every sample is minted to you at launch. Paid to you by marketplaces that honour NEAR royalties (NEP-199) when one is sold on. Up to 25%."
                problem={show(problems.royalty)}
              >
                <input
                  id="royalty"
                  className="field max-w-40"
                  inputMode="decimal"
                  value={royalty}
                  aria-describedby="royalty-hint"
                  onChange={(e) => setRoyalty(e.target.value)}
                />
              </Field>
            ) : (
              <>
                <div className="grid gap-6 sm:grid-cols-2">
                  <Field id="price" label="Mint price (NEAR)" problem={show(problems.price)}>
                    <input
                      id="price"
                      className="field"
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </Field>
                  <Field id="supply" label="Supply" problem={show(problems.supply)}>
                    <input
                      id="supply"
                      className="field"
                      inputMode="numeric"
                      placeholder="No limit"
                      value={supply}
                      onChange={(e) => setSupply(e.target.value)}
                    />
                  </Field>
                </div>

                <div className="divider" />
                <fieldset>
                  <legend className="eyebrow mb-4">What you earn</legend>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <Field
                      id="royalty"
                      label="Royalty on resales (%)"
                      hint="Paid to you by marketplaces that honour NEAR royalties (NEP-199). Up to 25%."
                      problem={show(problems.royalty)}
                    >
                      <input
                        id="royalty"
                        className="field"
                        inputMode="decimal"
                        value={royalty}
                        aria-describedby="royalty-hint"
                        onChange={(e) => setRoyalty(e.target.value)}
                      />
                    </Field>
                    <Field
                      id="share"
                      label="Your share of conversations (%)"
                      hint="Taken from every message and memory save. Up to 50%; raises the price owners pay."
                      problem={show(problems.share)}
                    >
                      <input
                        id="share"
                        className="field"
                        inputMode="decimal"
                        value={share}
                        aria-describedby="share-hint"
                        onChange={(e) => setShare(e.target.value)}
                      />
                    </Field>
                    <Field
                      id="chat-price"
                      label="Price per message (NEAR)"
                      hint={`Optional. Empty means the keeper's price, ${formatNear(prices.chat, 6)} NEAR, plus your share.`}
                      problem={show(problems.chatPrice)}
                    >
                      <input
                        id="chat-price"
                        className="field"
                        inputMode="decimal"
                        value={chatPrice}
                        aria-describedby="chat-price-hint"
                        onChange={(e) => setChatPrice(e.target.value)}
                      />
                    </Field>
                    <Field
                      id="save-price"
                      label="Price per memory save (NEAR)"
                      hint={`Optional. Empty means the keeper's price, ${formatNear(prices.save, 6)} NEAR, plus your share.`}
                      problem={show(problems.savePrice)}
                    >
                      <input
                        id="save-price"
                        className="field"
                        inputMode="decimal"
                        value={savePrice}
                        aria-describedby="save-price-hint"
                        onChange={(e) => setSavePrice(e.target.value)}
                      />
                    </Field>
                  </div>
                  <p className="hint mt-4">
                    A keeper only serves a collection whose prices still cover its own after your
                    share. These are fixed at launch.
                  </p>
                </fieldset>
              </>
            )}
          </Step>

          <Step n={4} title="Token images" group>
            <div className="grid gap-3">
              <label className="option">
                <input
                  type="radio"
                  name="images"
                  checked={!ownImages}
                  onChange={() => setOwnImages(false)}
                />
                <span>
                  Generated, and growing
                  <span className="block text-sm text-mist">
                    Each token gets the art in the preview, served by the keeper, so wallets and
                    marketplaces see it change as the token grows.
                  </span>
                </span>
              </label>
              <label className="option">
                <input
                  type="radio"
                  name="images"
                  checked={ownImages}
                  onChange={() => setOwnImages(true)}
                />
                <span>
                  My own images
                  <span className="block text-sm text-mist">
                    Token 1's image is at your address followed by 1 and the extension.
                  </span>
                </span>
              </label>
            </div>
            {ownImages && (
              <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_8rem]">
                <Field id="image-base" label="Image address" problem={show(problems.imageBase)}>
                  <input
                    id="image-base"
                    className="field font-mono"
                    placeholder="https://example.com/art/"
                    value={imageBase}
                    onChange={(e) => setImageBase(e.target.value.trim())}
                  />
                </Field>
                <Field
                  id="image-extension"
                  label="Extension"
                  problem={show(problems.imageExtension)}
                >
                  <input
                    id="image-extension"
                    className="field font-mono"
                    value={imageExtension}
                    onChange={(e) => setImageExtension(e.target.value.trim())}
                  />
                </Field>
              </div>
            )}
          </Step>

          <Step n={5} title="Who can open the tokens' minds" group>
            <div className="grid gap-3">
              <label className="option">
                <input
                  type="radio"
                  name="privacy"
                  checked={!private_}
                  onChange={() => setPrivate(false)}
                />
                <span>
                  The launchpad's keeper
                  {config.status === "ready" && (
                    <span className="font-mono text-sm text-mist">
                      {" "}
                      ({shorten(config.data.keeper_id, 14)})
                    </span>
                  )}
                  <span className="block text-sm text-mist">
                    Only owners can read their token's context through the app, but the keeper's
                    operator could read it too unless the keeper runs in a TEE.
                  </span>
                </span>
              </label>
              <label className="option">
                <input
                  type="radio"
                  name="privacy"
                  checked={private_}
                  onChange={() => setPrivate(true)}
                />
                <span>
                  Only inside a Phala TEE app
                  <span className="block text-sm text-mist">
                    Contexts are encrypted with keys that only this Phala Cloud app can get from
                    dstack's key service. A keeper running as any other app refuses to serve the
                    collection. This is fixed at launch.
                  </span>
                </span>
              </label>
            </div>
            {private_ && (
              <div className="mt-5 space-y-5">
                <Field id="app-id" label="Phala app id" problem={show(problems.appId)}>
                  <input
                    id="app-id"
                    className="field font-mono"
                    placeholder="e.g. 0a1b2c3d…"
                    value={appId}
                    onChange={(e) => setAppId(e.target.value.trim().toLowerCase())}
                  />
                </Field>
                {!isDataset && (
                  <Field
                    id="secret"
                    label="Secret instructions (optional)"
                    hint="Added after the prompt, for the model only. They're sealed in this browser to a key that exists only inside the Phala app; buyers, owners and the keeper's operator never see them."
                    problem={show(problems.secret)}
                  >
                    <textarea
                      id="secret"
                      className="field min-h-24"
                      value={secret}
                      aria-describedby="secret-hint"
                      onChange={(e) => setSecret(e.target.value)}
                    />
                  </Field>
                )}
                <Field
                  id="keeper-id"
                  label="Keeper account (optional)"
                  hint="The NEAR account of the keeper running as that app. Leave empty to use the launchpad's keeper."
                >
                  <input
                    id="keeper-id"
                    className="field font-mono"
                    value={keeperId}
                    aria-describedby="keeper-id-hint"
                    onChange={(e) => setKeeperId(e.target.value.trim())}
                  />
                </Field>
              </div>
            )}
          </Step>

          <div className="card card-lit">
            {config.status === "ready" ? (
              <dl className="space-y-2 text-sm">
                {!resuming && (
                  <>
                    <div className="flex justify-between gap-4">
                      <dt className="text-mist">Launch fee</dt>
                      <dd>{formatNear(config.data.launch_fee)} NEAR</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-mist">The collection's own storage</dt>
                      <dd>{formatNear(config.data.collection_funding)} NEAR</dd>
                    </div>
                    {isDataset && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-mist">
                          Storage for {sampleCount} sample{sampleCount === 1 ? "" : "s"}
                        </dt>
                        <dd>{formatNear(sampleStorage)} NEAR</dd>
                      </div>
                    )}
                  </>
                )}
                <div
                  className={`flex items-baseline justify-between gap-4 ${resuming ? "" : "border-t border-[var(--card-line)] pt-3"}`}
                >
                  <dt className="text-mist">{resuming ? "Already launched" : "You pay"}</dt>
                  <dd className="font-display text-2xl tracking-tight">
                    {resuming ? "Nothing to pay" : `${formatNear(cost ?? 0n)} NEAR`}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-mist" role="status">
                {config.status === "loading"
                  ? "Reading the launchpad…"
                  : `Can't read the launchpad. ${describeProblem(config.error)}`}
              </p>
            )}
            <p className="mt-3 text-sm text-mist">
              {isDataset
                ? "One wallet confirmation launches the collection. The keeper then stores each sealed sample and records it on-chain; you sign nothing more."
                : `Mint revenue goes to you. Owners pay for their tokens' conversations from each token's own balance (${formatNear(prices.chat, 6)} NEAR a message here).`}
            </p>
            {wallet.near ? (
              <button
                type="submit"
                className="button mt-5 w-full py-3 text-base"
                disabled={busy || config.status !== "ready"}
              >
                <Icon name="rocket" size={18} />
                {busy ? "Launching…" : "Launch collection"}
              </button>
            ) : (
              <button
                type="button"
                className="button mt-5 w-full"
                onClick={() => {
                  setProblem(null);
                  wallet.connect().catch((error) => setProblem(describeProblem(error)));
                }}
              >
                Connect wallet to launch
              </button>
            )}
            {progress && (
              <div className="mt-4">
                <label htmlFor="launch-progress" className="flex justify-between text-sm text-mist">
                  <span>{PROGRESS_LABELS[progress.step]}</span>
                  {progress.step !== "launching" && (
                    <span className="font-mono">
                      {progress.done} / {progress.total}
                    </span>
                  )}
                </label>
                <progress
                  id="launch-progress"
                  className="mt-2 h-2 w-full accent-[var(--accent)]"
                  max={progress.total}
                  value={progress.step === "launching" ? undefined : progress.done}
                />
              </div>
            )}
            {finished && (
              <p
                className="mt-4 flex items-start gap-2 rounded-xl border border-glow/30 bg-glow/10 px-3 py-2 text-sm text-glow"
                role="status"
              >
                <Icon name="check" size={16} className="mt-0.5 shrink-0" />
                <span>
                  {finished.count} samples sealed.{" "}
                  <Link to={`/c/${finished.account}`} className="link">
                    Open the collection
                  </Link>
                </span>
              </p>
            )}
            {touched && !valid && !problem && (
              <p className="mt-3 text-sm text-alarm" role="alert">
                Some fields need attention.
              </p>
            )}
            {problem && (
              <p className="mt-3 text-sm text-alarm" role="alert">
                {problem}
              </p>
            )}
          </div>
        </form>

        <aside className="card lg:sticky lg:top-5 lg:self-start" aria-labelledby="preview">
          <h2 id="preview" className="card-title">
            Preview
          </h2>
          <div className="mt-4 flex gap-3">
            {[1, 2, 3].map((n) => (
              <TokenSigil
                key={n}
                seed={`${account ?? "preview"}/${n}`}
                stage={(n - 1) as 0 | 1 | 2}
                size={84}
                label={`Token #${n}`}
              />
            ))}
          </div>
          <p className="mt-2 text-sm text-mist">
            Each token's art comes from its number and grows as it saves conversations.
          </p>
          {isDataset ? (
            <>
              <h3 className="eyebrow mt-6">What each token holds</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">
                One picture and its label, sealed in this browser to the keeper's key and stored
                under a key of its own. Token #1 is the first picture of the first class, and so on
                through the classes in order.
              </p>
            </>
          ) : (
            <>
              <h3 className="eyebrow mt-6">What token #1 is told</h3>
              <blockquote className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/35 p-4 text-sm leading-relaxed ring-1 ring-cream/8">
                {sample}
                {starter && (
                  <>
                    {"\n\n"}
                    <span className="text-mist">This is who you are now:</span>
                    {"\n\n"}
                    {starter}
                  </>
                )}
              </blockquote>
            </>
          )}
          {account && (
            <p className="mt-4 text-sm text-mist">
              Address <span className="break-all font-mono text-cream">{account}</span>
            </p>
          )}
        </aside>
      </div>

      <section className="mt-20" aria-labelledby="launched">
        <h2 id="launched" className="text-3xl">
          Launched so far
        </h2>
        {listing.status === "ready" && listing.data.length === 0 && (
          <p className="card mt-6 text-mist">Nothing yet. Yours could be the first.</p>
        )}
        {listing.status === "error" && (
          <p className="mt-4 text-alarm" role="alert">
            Can't list collections. {describeProblem(listing.error)}
          </p>
        )}
        {listing.status === "ready" && listing.data.length > 0 && (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listing.data
              .filter((entry) => entry.live)
              .map((entry) => (
                <li key={entry.account_id}>
                  <Link
                    to={`/c/${entry.account_id}`}
                    className="card group flex items-center gap-4 !p-4 transition-colors hover:border-glow/50"
                  >
                    <TokenSigil seed={`${entry.account_id}/1`} stage={2} size={56} decorative />
                    <span className="min-w-0">
                      <span className="block truncate font-bold group-hover:text-glow">
                        {entry.name}
                      </span>
                      <span className="block truncate text-sm text-mist">
                        {entry.symbol} · by{" "}
                        <span className="font-mono">{shorten(entry.creator_id, 10)}</span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
