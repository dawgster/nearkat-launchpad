# Hotdog demo: stage script

Placeholders in `<angle brackets>` are filled in by the deploy step.

| Placeholder | Meaning |
| --- | --- |
| `<web-url>` | The deployed web app |
| `<launchpad>` | Launchpad contract account (`pals-*.testnet`) |
| `<creator>` | Account that launches the collection |
| `<holder1>,<holder2>,<holder3>` | Three holder accounts (`pals-*.testnet`) |
| `<renter>` | Account that rents and trains |
| `<collection>` | The launched collection's account, `hotdog.<launchpad>` |
| `<app-id>` | The training app's id, as trusted or attested on the collection |
| `<trainer-url>` | The training app's URL |
| `<recorded-run-url>` | The recorded run, a screen capture of a full pass |
| `<model-file>` | A pre-downloaded trained model, kept on the laptop |

## Before the demo (once, the day before)

1. Fetch the dataset (pinned commit, never committed):
   `scripts/fetch-hotdog.sh` fills `data/hotdog/train` with the training images.
2. Check the ingest app and the training app are up: `<web-url>` shows the
   launch page without a warning, and `<trainer-url>/attestation` answers.
3. Launch: sign in as `<creator>` at `<web-url>/launch`, pick Dataset, drop the
   `data/hotdog/train` folder, confirm once. Wait for "samples sealed".
4. Make sure `<app-id>` is registered on `<collection>`. Attested apps register
   themselves; a locally run one needs the admin to call `trust_app_key`.
5. Spread and list the samples (run from the repo root, needs Node 24 and
   `keeper/node_modules`):

   ```
   node scripts/demo-hotdog.ts --collection <collection> --creator <creator> \
     --holders <holder1>,<holder2>,<holder3> --fee 0.01 --duration 86400 \
     --app <app-id>
   ```

   It reads keys from `~/.near-credentials/testnet/<account>.json`. For another
   network, add `--network sandbox --rpc <url> --keys keys.json`, where
   `keys.json` is `{ "<account>": "ed25519:<secret key>" }`. The last line must
   read `Total: N of N samples on offer`; the exit code is 1 otherwise. It is
   safe to run again.
6. Pre-download one trained model as `<model-file>` and record one full run at
   `<recorded-run-url>`.

Fallback: if the launch fails, use the collection launched the day before. If
the script lists fewer than all samples, run it again; rented ones are skipped.

## On stage

1. **A collection with no visible image.** Open `<web-url>/c/<collection>`. Show
   the 100-odd samples as sealed tiles: no picture anywhere, only the class
   counts. *Fallback:* the same page on `<recorded-run-url>`.
2. **Rent 150 samples in one confirmation.** In "Rent samples" choose app
   `<app-id>`, enter 150, press Rent, confirm in the wallet once. Open the
   transaction: three holders (`<holder1>`, `<holder2>`, `<holder3>`) were each
   paid their fees. *Fallback:* if the wallet or rent fails, rent from the
   command line with the same account, or skip to the recorded run.
3. **Train.** Press "Train on 150 rented samples". Show the attestation and key
   requests on-chain, then the progress for under a minute. Accuracy appears,
   the run is recorded on-chain, and the model downloads. *Fallback:* if
   training stalls past 90 seconds, say so, switch to `<recorded-run-url>`, and
   continue with `<model-file>`.
4. **Try it.** Drop a hotdog photo on the page: it says "hotdog". Open a sample's
   page: it shows it earned rent and trained model #1 for `<app-id>`.
   *Fallback:* load `<model-file>` in the same try box.
5. *(Stretch)* A second training app rents the same samples and gets a
   different model. *Fallback:* skip.
6. *(Stretch)* Load the model into the on-chain hotdog contract from `near_nn`.
   *Fallback:* skip.

If time allows, launch a small folder live, as in "Before the demo", step 3.

## Resetting for another run

Rented samples can't be transferred or listed again until their loans end (one
day). To rehearse again, launch a fresh collection and run the script on it.
