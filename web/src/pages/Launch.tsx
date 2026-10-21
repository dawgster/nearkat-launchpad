import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Shell } from "../components/Shell.tsx";
import { TokenSigil } from "../components/TokenSigil.tsx";
import { formatNear, parseNear, shorten } from "../lib/format.ts";
import {
  appIdProblem,
  Launchpad,
  MAX_PROMPT_CHARS,
  MAX_STARTER_CHARS,
  PROMPT_TEMPLATES,
  promptFor,
  slugFrom,
  slugProblem,
} from "../lib/launchpad.ts";
import { describeProblem } from "../lib/problems.ts";
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
      <label htmlFor={id} className="block font-bold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-mist">
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

function Counter({ text, max }: { text: string; max: number }) {
  return (
    <p className={`mt-1 text-right text-xs ${text.length > max ? "text-alarm" : "text-mist"}`}>
      {text.length} / {max}
    </p>
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
  const { prices } = useServices();
  const navigate = useNavigate();
  const [config] = useAsync("launchpad", () => launchpad.getConfig());
  const [listing] = useAsync("collections", () => launchpad.collections());

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [starter, setStarter] = useState("");
  const [price, setPrice] = useState("1");
  const [supply, setSupply] = useState("");
  const [private_, setPrivate] = useState(false);
  const [appId, setAppId] = useState("");
  const [keeperId, setKeeperId] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);

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
  const maxSupply = supply.trim() === "" ? null : Number(supply);
  const problems = {
    name: name.trim() ? null : "Give the collection a name.",
    symbol: /^[A-Z0-9]{1,10}$/.test(symbol) ? null : "1 to 10 capital letters or digits.",
    slug: effectiveSlug ? slugProblem(effectiveSlug) : "Pick an address.",
    prompt: prompt.trim()
      ? prompt.length > MAX_PROMPT_CHARS
        ? "Too long."
        : null
      : "Write the prompt every token shares.",
    starter: starter.trim()
      ? starter.length > MAX_STARTER_CHARS
        ? "Too long."
        : null
      : "Say where each token starts.",
    price: mintPrice === null ? "Enter an amount in NEAR, like 1 or 0.5." : null,
    supply:
      maxSupply === null || (Number.isInteger(maxSupply) && maxSupply > 0)
        ? null
        : "A whole number, or leave it empty for no limit.",
    appId: private_ ? appIdProblem(appId) : null,
  };
  const valid = Object.values(problems).every((p) => p === null) && !taken;
  const [touched, setTouched] = useState(false);
  const show = (p: string | null) => (touched ? p : null);

  const cost =
    config.status === "ready"
      ? BigInt(config.data.launch_fee) + BigInt(config.data.collection_funding)
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid || cost === null || mintPrice === null || !wallet.near) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await new Launchpad(wallet.near, launchpad.id).launch(
        {
          slug: effectiveSlug,
          name: name.trim(),
          symbol,
          mintPrice,
          prompt,
          starter,
          maxSupply,
          phalaAppId: private_ ? appId : null,
          keeperId: private_ && keeperId.trim() ? keeperId.trim() : null,
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
      <div className="pt-10">
        <h1 className="text-[2.4rem] leading-[1.05] sm:text-6xl">Launch a collection</h1>
        <p className="mt-5 max-w-[40rem] text-lg leading-relaxed text-mist">
          Every token in your collection shares one prompt and starts from the same context. From
          there, each grows its own way through conversations with whoever owns it, and keeps what
          it learned when it changes hands.
        </p>
      </div>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1.4fr_1fr]">
        <form onSubmit={submit} className="space-y-8" noValidate>
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
            problem={taken ? "That address is taken." : show(problems.slug)}
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

          <Field
            id="prompt"
            label="Prompt"
            hint="What every token is. Any kind of prompt works. {name} and {token_id} are filled in for each token. Everyone can read it before minting."
            problem={show(problems.prompt)}
          >
            <div className="mb-2 flex flex-wrap gap-2">
              <span className="text-sm text-mist">Start from:</span>
              {PROMPT_TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  className="rounded-full border border-glow/40 px-3 py-0.5 text-sm hover:border-glow hover:bg-glow/10"
                  onClick={() => {
                    setPrompt(template.prompt);
                    setStarter(template.starter);
                  }}
                >
                  {template.label}
                </button>
              ))}
            </div>
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

          <fieldset className="rounded-xl border border-cream/15 p-5">
            <legend className="px-2 font-bold">Who can open the tokens' minds</legend>
            <label className="flex gap-3">
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
            <label className="mt-4 flex gap-3">
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
            {private_ && (
              <div className="mt-5 space-y-5 pl-7">
                <Field id="app-id" label="Phala app id" problem={show(problems.appId)}>
                  <input
                    id="app-id"
                    className="field font-mono"
                    placeholder="e.g. 0a1b2c3d…"
                    value={appId}
                    onChange={(e) => setAppId(e.target.value.trim().toLowerCase())}
                  />
                </Field>
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
          </fieldset>

          <div className="rounded-xl border border-cream/15 bg-dusk/80 p-5">
            {config.status === "ready" ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-mist">Launch fee</dt>
                  <dd>{formatNear(config.data.launch_fee)} NEAR</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-mist">The collection's own storage</dt>
                  <dd>{formatNear(config.data.collection_funding)} NEAR</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-cream/15 pt-3">
                  <dt className="text-mist">You pay</dt>
                  <dd className="text-xl font-bold">{formatNear(cost ?? 0n)} NEAR</dd>
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
              Mint revenue goes to you. Owners pay for their tokens' conversations from each token's
              own balance ({formatNear(prices.chat)} NEAR a message here).
            </p>
            {wallet.near ? (
              <button
                type="submit"
                className="button mt-5 w-full"
                disabled={busy || config.status !== "ready"}
              >
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

        <aside className="lg:sticky lg:top-6 lg:self-start" aria-labelledby="preview">
          <h2 id="preview" className="font-sans text-lg font-bold">
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
          <h3 className="mt-6 text-sm font-bold">What token #1 is told</h3>
          <blockquote className="mt-2 whitespace-pre-wrap rounded-lg bg-black/30 p-4 text-sm leading-relaxed">
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
          {account && (
            <p className="mt-4 text-sm text-mist">
              Address <span className="font-mono text-cream">{account}</span>
            </p>
          )}
        </aside>
      </div>

      <section className="mt-20" aria-labelledby="launched">
        <h2 id="launched" className="text-3xl">
          Launched so far
        </h2>
        {listing.status === "ready" && listing.data.length === 0 && (
          <p className="mt-4 text-mist">Nothing yet. Yours could be the first.</p>
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
                    className="group flex items-center gap-4 rounded-xl border border-cream/10 p-4 hover:border-glow/50"
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
