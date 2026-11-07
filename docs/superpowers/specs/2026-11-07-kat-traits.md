# Kat traits

A trait table for kats, built the way BLACKDRAGONFOREVER's is (see "Where
this comes from" below): one fixed base, five layers that vary, a few common
values per layer and a long tail of rare ones, and a handful of one-of-ones.
Every trait is there, and drawn, from the moment a kat is minted.

Status: draft for review. Nothing here is built yet.

## Shape

| Trait | Values | Common | Rare tail |
|---|---|---|---|
| Base | 1 | Meerkat | |
| Sky | 24 | 4 values, 60% | 20 values, 2% each |
| Fur | 15 | 6 values, 69% | 9 values, 3–4% each |
| Eyes | 30 | 3 values, 50% | 27 values, ~1.85% each |
| Paws | 30 | 3 values, 52% | 27 values, ~1.78% each |
| Outfit | 40 | 3 values, 52% | 37 values, ~1.3% each |
| Headwear | 40 | 3 values, 52% | 37 values, ~1.3% each |

Plus **Stage** (Hatchling, Pup, Sentry, Elder), which isn't rolled: it's read
from the contract and changes as the kat saves conversations. Marketplaces
show it next to the rest.

All six layers are fixed at mint by the token's seed, as today, and the
picture draws all of them from the start: what you mint is what you see, in
the metadata and in the art. Growth never adds, removes or changes a trait.

The art is a close-up bust, as BLACKDRAGONFOREVER draws its dragons: a big
chibi head filling a square frame, headwear running off the top, the outfit
cropped by the bottom edge, thick dark outlines and flat cel shading. Growth
changes the framing: a Hatchling sits smaller and lower in the frame, a Pup a
little less so, a Sentry fills it, and an Elder fills it with grey brows and
a soft glow behind it. No stage hides a layer. The art lives in `art/kat/`
(canvas and anchors, the base meerkat, one file per layer, and the renderer);
`node art/scripts/sheet.ts <layer>` draws a contact sheet of a layer.

This replaces today's kat portrait (`katSvg` in `art/svg.ts`), which hides
its accessory until Sentry and sinks young kats into a burrow.

The existing names carry over: the six furs, the sky names, and the three eye
shapes are the commons below. The current `accessory` splits into Paws,
Outfit and Headwear.

## Nature

Every trait value is also a line of personality, in `art/kat/natures.ts`. A
kat's six lines are its nature: fixed at mint like its look, and given to the
model in every conversation (before who it has become) and in every character
update (as fixed, so the character it grows into stays true to it). Borrowers
talk to the same nature. Launched collections' tokens have no traits and get
none.

Each layer shapes one part of who a kat is, so six random traits make one
personality instead of six that argue: Sky its mood and energy, Fur how it is
with others, Eyes how it sees things, Paws what it's into, Outfit how it
carries itself, Headwear a signature quirk. Commons are mild; rares carry the
strong flavours.

## Sky

The four moods of the savannah are the commons, so most kats match the page
they're shown on at some hour.

| Value | Share |
|---|---|
| Day | 22% |
| Dusk | 14% |
| Night | 14% |
| Dawn | 10% |
| Aurora, Blood Moon, Eclipse, Meteor Shower, Rainbow, Sandstorm, Thunderstorm, Supermoon, Starfield, Nebula, Comet, Monsoon, Fireflies, Lantern Night, Heat Haze, Snowfall, Twin Suns, Green Flash, Desert Mirage, Midnight Sun | 2% each |

## Fur

Fur is the one layer that varies the base itself, so its rare tail is short
and less rare than the others.

| Value | Share |
|---|---|
| Sand | 20% |
| Cinnamon | 15% |
| Ash | 10% |
| Gold, Cocoa, Cream | 8% each |
| Silver, Midnight, Frost, Ember | 4% each |
| Spotted, Striped, Mossy, Albino, Gilded | 3% each |

## Eyes

| Value | Share |
|---|---|
| Round | 22% |
| Sleepy | 15% |
| Bright | 13% |
| Shades, Gold Shades, Laser Green, Laser Gold, Heart Eyes, Star Eyes, Spiral, Side-Eye, Wink, Monocle, Round Glasses, Aviators, Ski Goggles, Eye Patch, 3D Glasses, Pixel Shades, Teary, Angry, Glowing, Cyclops Visor, Robot Eyes, Crossed, Night Vision, Scuba Mask, Opera Glasses, Moon Eyes, Mismatched | ~1.85% each |

## Paws

What it's holding. Black Dragon's "Mouth" layer, moved to where a meerkat
keeps things.

| Value | Share |
|---|---|
| Empty Paws | 25% |
| Beetle | 15% |
| NEAR Coin | 12% |
| Coffee Mug, Scorpion, Grub on a Stick, Lollipop, Watermelon Slice, Map, Compass, Spyglass, Lantern, Walkie-Talkie, Magnifying Glass, Feather, Seashell, Cactus Pot, Balloon, Ice Cream Cone, Taco, Pizza Slice, Egg, Tiny Shovel, Gem, Golden Key, Scroll, Hourglass, Microphone, Fishing Rod, Bubble Wand | ~1.78% each |

## Outfit

| Value | Share |
|---|---|
| Bare | 25% |
| Burrow Scarf | 15% |
| Sentry Vest | 12% |
| Gold Chain, Explorer Jacket, Raincoat, Hoodie, Bomber Jacket, Tracksuit, Lab Coat, Chef Apron, Tuxedo, Hawaiian Shirt, Knit Sweater, Puffer Jacket, Overalls, Kimono, Poncho, Superhero Cape, Wizard Robe, Knight Armour, Astronaut Suit, Diving Suit, Pilot Jacket, Safari Shirt, Referee Shirt, Sailor Suit, Pajamas, Tie-Dye Tee, Varsity Jacket, Denim Jacket, Leather Jacket, Flannel, Life Vest, Hi-Vis Vest, Beetle Bandolier, Scarab Necklace, Barrel, Cardboard Box, Bubble Wrap | ~1.3% each |

## Headwear

| Value | Share |
|---|---|
| None | 30% |
| Leaf Sprig | 12% |
| Beanie | 10% |
| Explorer Hat, Nightcap, Crown, Halo, Flower Crown, Propeller Cap, Cowboy Hat, Top Hat, Bowler, Beret, Bucket Hat, Baseball Cap, Backwards Cap, Headphones, Antenna Headband, Party Hat, Chef Hat, Pirate Hat, Wizard Hat, Knight Helmet, Space Helmet, Miner Lamp, Hard Hat, Bandana, Sweatband, Mohawk, Bird's Nest, Snail Friend, Mushroom Cap, Cactus Hat, Straw Hat, Earmuffs, Tiara, Unicorn Horn, Lightbulb, Little Raincloud, Graduation Cap | ~1.3% each |

## One-of-ones

Black Dragon has one (token #0). Kats could keep a few token ids for
hand-drawn kats that replace all six layers with a single `1 of 1` trait:

- The First Sentry
- Ghost of the Burrow
- Kat of the Eclipse
- The Golden Elder
- The Mob Boss

These are placeholders: which ids, how many, and who draws them is open.

## Rules

- **Rarity is computed, not declared.** Black Dragon writes a rarity next to
  each trait; 11 of its 241 values are off from the real share by more than
  0.6 points. Kats should show rarity from the actual counts of minted tokens.
- **No real people, brands or projects in names.** Black Dragon's outfits
  include celebrities and other projects' merch. Kat values stay generic;
  "NEAR" is the only name used, and only where it's the chain itself.
- **Every layer draws on the burrow meerkat.** The drawing in
  `web/src/components/Savannah.tsx` already has shades, the explorer hat, the
  nightcap, the coffee mug, the gold chain and the NEAR coin; those become
  the first values to draw.

## No two alike

Decided: every kat is different, and the collection has a fixed supply
(5,000 as a placeholder, Black Dragon's size).

**The set.** Before deploy, a script draws the whole collection. Each
value gets an exact count, its share times the supply (a 2% sky is on
exactly 100 kats at 5,000), so the shares above are the real ones, not a
roll that drifts; a straight random draw wanders up to 1.7 points. The
script shuffles each layer's values into the slots, then swaps values
within a layer until no two slots share a combination (about 20 clashes to
break at 5,000), and puts the one-of-ones in their own slots. Its output is
a list of exactly `supply` entries, kept in the art package beside the
generator (`art/kats.json`) and drawn from a fixed seed, so anyone can re-run
the script and get the same list. The contract stores the list's SHA-256 at
deploy, so it can't be changed afterwards.

**Fair minting.** The list is public, so handing slots out in order would
let anyone see what the next kat is and time a mint for a rare one. Each
mint takes a random slot that hasn't been taken, from the block's random
seed (`env::random_seed()`), using a swap map: the contract keeps a count of
slots left and a map of the few slots that have been swapped, so a mint is
constant work and storage grows by at most one entry per mint, never the
whole list. Token ids stay sequential (#1, #2, …); each token records its
slot, and the kat view returns it.

**Art.** The picture is drawn from the slot's combination instead of from a
random roll of the seed. The web app and the keeper (which serves the image
to wallets and marketplaces) read the slot from the contract and look it up
in `art/kats.json`. `max_supply` becomes required for the kat collection and
must equal the list's length; launched collections keep their own art and
their optional supply.

**Existing kats.** Not kept: the testnet kats are test data. The new
contract is a fresh deploy, not a migration.

## Open questions

1. **Supply.** 5,000 is a placeholder.
2. **Validator influence.** A block's random seed can't be predicted by the
   minter, but the block's producer has some say in it. For a 5,000-kat
   collection that's an accepted risk on NEAR; a commit-and-reveal mint
   would close it at the cost of a second transaction per mint.

## Where this comes from

BLACKDRAGONFOREVER (`blackdragonforever.nfts.tg`, 5,000 tokens, traits on
Arweave), read on 2026-11-07:

- Six traits per token: Background (50 values), Base (always
  "BlackDragon"), Body (61), Mouth (33), Eye (43), Headwear (53). One token,
  #0, is a one-of-one with a single `1 of 1` trait instead.
- Each layer has 2–4 common values covering about 50–70% of tokens; every
  other value lands on roughly 1% (32–71 tokens).
- All 4,999 regular tokens have a different combination.
