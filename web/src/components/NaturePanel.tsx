import { katForToken } from "../../../art/kat/collection.ts";
import { NATURES } from "../../../art/kat/natures.ts";
import type { KatLook } from "../../../art/kat/render.ts";

const LAYERS: Array<[keyof KatLook, string]> = [
  ["sky", "Sky"],
  ["fur", "Fur"],
  ["eyes", "Eyes"],
  ["paws", "Paws"],
  ["outfit", "Outfit"],
  ["headwear", "Headwear"],
];

/**
 * A kat's traits and the nature each gives it. Fixed at mint, like its look;
 * the keeper gives the same lines to the model in every conversation.
 */
export function NaturePanel({ tokenId }: { tokenId: string }) {
  const kat = katForToken(tokenId);
  return (
    <section aria-labelledby="nature">
      <h2 id="nature" className="eyebrow">
        Nature
      </h2>
      <dl className="mt-3 space-y-2.5">
        {LAYERS.map(([layer, label]) => (
          <div key={layer} className="grid grid-cols-[5.5rem_1fr] gap-x-3 text-sm">
            <dt className="text-mist">{label}</dt>
            <dd>
              <span className="font-bold text-cream">{kat[layer]}</span>
              <span className="block leading-relaxed text-mist">{NATURES[layer][kat[layer]]}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-mist">
        Its traits were fixed when it was minted, and so is the nature they give it. Its character
        grows on top of it.
      </p>
    </section>
  );
}
