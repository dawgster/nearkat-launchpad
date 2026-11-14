import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { type ReactNode, useState } from "react";
import type { ModelView } from "../lib/contract.ts";
import { saveFile } from "../lib/download.ts";
import { shorten } from "../lib/format.ts";
import { KeeperError } from "../lib/keeper.ts";
import type { Classifier, Picture } from "../lib/model.ts";
import { describeProblem } from "../lib/problems.ts";
import type { TrainerAccess } from "../lib/trainer.ts";
import { Icon } from "./Icon.tsx";
import { TokenSigil } from "./TokenSigil.tsx";
import { TryModel } from "./TryModel.tsx";

export interface ModelPanelProps {
  contractId: string;
  model: ModelView;
  /** The dataset's classes, in the order the model answers in. */
  classes: string[];
  /** App labels by app id. They are the apps' own words, so the id is shown too. */
  labels: Record<string, string>;
  /** The connected account; null while no wallet is connected. */
  viewer: string | null;
  /** The training app that made the model, when this site knows its address. */
  access: TrainerAccess | undefined;
  /** More for the owner, below the model: giving it away. */
  children?: ReactNode;
  save?: (bytes: Uint8Array, name: string) => void;
  load?: (bytes: Uint8Array, sha256: string) => Promise<Classifier>;
  heldout?: (classifier: Classifier, classes: string[]) => Promise<number>;
  decode?: (file: File) => Promise<Picture>;
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** The training app's own words are the clearest; keeper-specific wording would mislead. */
function describe(error: unknown): string {
  return error instanceof KeeperError ? error.message : describeProblem(error);
}

type Opened =
  | { status: "closed" }
  | { status: "opening" }
  | { status: "open"; bytes: Uint8Array }
  | { status: "error"; text: string };

/**
 * A trained model's page: the run that made it, what the contract recorded,
 * and, for its owner, the model itself. Its weights are sealed like a
 * sample's picture: only the training app that made it can get the key.
 */
export function ModelPanel({
  contractId,
  model,
  classes,
  labels,
  viewer,
  access,
  children,
  save = saveFile,
  load,
  heldout,
  decode,
}: ModelPanelProps) {
  const [opened, setOpened] = useState<Opened>({ status: "closed" });
  const isOwner = viewer !== null && viewer === model.owner_id;
  const label = labels[model.app_id];
  const recorded = model.model_sha256.toLowerCase();

  async function open() {
    if (!access) {
      return;
    }
    setOpened({ status: "opening" });
    try {
      const bytes = await access.trainer.tokenModel(access.session, contractId, model.token_id);
      // Only the model the chain recorded is opened: the app's word alone isn't enough.
      setOpened(
        bytesToHex(sha256(bytes)) === recorded
          ? { status: "open", bytes }
          : {
              status: "error",
              text: "The file the training app returned doesn't match the hash recorded on-chain, so it wasn't opened.",
            },
      );
    } catch (error) {
      setOpened({ status: "error", text: describe(error) });
    }
  }

  return (
    <div className="mt-8 space-y-5">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        <TokenSigil seed={`${contractId}/${model.token_id}`} stage={3} size={128} decorative />
        <div className="min-w-0">
          <h1 className="break-words text-4xl sm:text-6xl">Model {model.run_id}</h1>
          <p className="mt-3 text-sm text-mist">
            Owned by{" "}
            <span className="font-mono text-cream" title={model.owner_id}>
              {shorten(model.owner_id, 12)}
            </span>
          </p>
          <p className="mt-2 flex items-start gap-2 text-sm text-mist">
            <Icon name="lock" size={15} className="mt-0.5 shrink-0" />
            <span>
              Its weights are sealed. Only the training app that made it can get their key, and it
              opens the model for whoever owns this token.
            </span>
          </p>
        </div>
      </header>

      <section className="card" aria-labelledby="model-record">
        <h2 id="model-record" className="card-title">
          The model
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
          <dt className="text-mist">Training run</dt>
          <dd className="break-all font-mono">{model.run_id}</dd>
          <dt className="text-mist">Trained by</dt>
          <dd className="break-all">
            {label ? `${label} ` : ""}
            <span className="font-mono text-xs text-mist">({model.app_id})</span>
          </dd>
          <dt className="text-mist">Trained on</dt>
          <dd>{plural(model.token_count, "rented sample")}</dd>
          <dt className="text-mist">Held-out accuracy</dt>
          <dd>{(model.accuracy_bps / 100).toFixed(2)}%, as the training app measured it</dd>
          <dt className="text-mist">Trained for</dt>
          <dd className="break-all font-mono">{model.renter_id}</dd>
          <dt className="text-mist">Model file</dt>
          <dd className="break-all font-mono text-xs" data-testid="model-sha256">
            sha256 {model.model_sha256}
          </dd>
          <dt className="text-mist">Sealed weights</dt>
          <dd className="break-all font-mono text-xs" data-testid="model-sealed-ref">
            {model.sealed_ref}
          </dd>
        </dl>
        <p className="hint mt-4">
          What is sealed is what the run learned from the rented samples: the classifier's weights,
          a few kilobytes, stored encrypted under a key of this token's own from NEAR's MPC network.
          The rest of the model is a public backbone, MobileNetV3-Large, pinned by its hash. The
          training app puts the two together into the file whose hash is recorded here.
        </p>
      </section>

      <section className="card" aria-labelledby="open-model">
        <h2 id="open-model" className="card-title flex items-center gap-2">
          <Icon name="key" size={18} className="text-mist" />
          Open the model
        </h2>
        {!isOwner ? (
          <p className="mt-2 text-sm text-mist" data-testid="model-closed">
            Only its owner can open it.
            {viewer === null && " Connect the wallet that owns this token to open it here."}
          </p>
        ) : !access ? (
          <p className="mt-2 text-sm text-mist" data-testid="model-closed">
            This site has no address for the training app that made it, so it can't be opened here.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              The training app checks that you own this token, gets its key, and puts the model
              together again. The file is checked against the hash recorded on-chain before it is
              used. Once opened, the file is in your hands like any download.
            </p>
            {opened.status !== "open" && (
              <button
                type="button"
                className="button mt-4 w-full"
                disabled={opened.status === "opening"}
                onClick={() => void open()}
              >
                {opened.status === "opening" ? "Opening…" : "Open the model"}
              </button>
            )}
            {opened.status === "opening" && (
              <p className="mt-3 text-sm text-mist" role="status">
                Signing in to the training app and asking for the model. Approve the message in your
                wallet if it asks. Getting the key takes a few seconds.
              </p>
            )}
            {opened.status === "error" && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-alarm/30 bg-alarm/10 px-3 py-2 text-sm text-alarm"
              >
                {opened.text}
              </p>
            )}
            {opened.status === "open" && (
              <div className="mt-4 space-y-4">
                <p className="flex items-start gap-2 text-sm text-mist" role="status">
                  <Icon name="check" size={16} className="mt-0.5 shrink-0 text-glow" />
                  <span>Opened. The file matches the hash recorded on-chain.</span>
                </p>
                <button
                  type="button"
                  className="button button-quiet w-full"
                  onClick={() => save(opened.bytes, `${contractId}-${model.run_id}.onnx`)}
                >
                  <Icon name="download" size={16} />
                  Download model
                </button>
                <TryModel
                  bytes={opened.bytes}
                  sha256={recorded}
                  classes={classes}
                  {...(load && { load })}
                  {...(heldout && { heldout })}
                  {...(decode && { decode })}
                />
              </div>
            )}
          </>
        )}
      </section>
      {isOwner && children}
    </div>
  );
}
