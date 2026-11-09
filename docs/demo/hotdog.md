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
   `scripts/fetch-hotdog.sh` fills `data/hotdog/train` with the 200 training
   images (100 `hotdog`, 100 `not_hotdog`).
   *Fallback:* no network, use the copy of `data/hotdog/` kept on a USB stick.
2. Check the ingest app and the training app are up: `<web-url>` shows the
   launch page without a warning, and `<trainer-url>/attestation` answers.
   *Fallback:* if either is down, restart it from its deploy; if that fails,
   run the whole demo from `<recorded-run-url>` and say so.
3. Launch: sign in as `<creator>` at `<web-url>/launch`, pick Dataset, drop the
   `data/hotdog/train` folder, confirm once. Wait for "samples sealed".
4. Make sure `<app-id>` is registered on `<collection>`. Attested apps register
   themselves; a locally run one needs the admin to call `trust_app_key`.
   *Fallback:* if the trust call fails, use the attested app instead and change
   `<app-id>` everywhere below.
5. Spread and list the samples (run from the repo root, needs Node 24 and
   `keeper/node_modules`):

   ```
   node scripts/demo-hotdog.ts --collection <collection> --creator <creator> \
     --holders <holder1>,<holder2>,<holder3> --fee 0.01 --duration 86400 \
     --app <app-id>
   ```

   It reads keys from `~/.near-credentials/testnet/<account>.json`. For another
   network, add `--network sandbox --rpc <url> --keys keys.json`, where
   `keys.json` is `{ "<account>": "ed25519:<secret key>" }`. The last line reads
   `Total: N of N samples on offer (N held by holders)`; the exit code is 1
   if not every sample is on offer. It is
   safe to run again.
6. Pre-download one trained model as `<model-file>` and record one full run at
   `<recorded-run-url>`.
   *Fallback:* if no run completes, record the stage steps with the last good
   run's transaction links, and keep an earlier model file.

Fallback: if the launch fails, use the collection launched the day before. If
the script lists fewer than all 200 samples, run it again; rented ones are
skipped. If its keys fail, check `~/.near-credentials/testnet/`.

## On stage

1. **A collection with no visible image.** Open `<web-url>/c/<collection>`. Show
   the 200 samples as sealed tiles: no picture anywhere, only the class
   counts. *Fallback:* the same page on `<recorded-run-url>`.
2. **Rent 150 samples in one confirmation.** In "Rent samples" choose app
   `<app-id>`, enter 150, press Rent, confirm in the wallet once. Open the
   transaction: three holders (`<holder1>`, `<holder2>`, `<holder3>`) were each
   paid their fees. *Fallback:* if the wallet or rent fails, rent from the
   command line as the same account:
   `node scripts/demo-hotdog.ts --collection <collection> --renter <renter> --rent 150 --app <app-id>`
   (it prints what each holder was paid; run again after a failure and it only
   tops up to 150), or skip to the recorded run.
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
