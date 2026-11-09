# Deploying the dataset keeper and the training app on Phala Cloud

This covers brief steps 2 to 7. Step 1 (building the images) is done with
`docker build`, see the end of this page. Commands marked **(to verify)** were
written without the `phala` CLI installed; check them against `phala --help`
and https://docs.phala.network before running. Placeholders in `<angle
brackets>` are filled in as the values become known. Record each one in the
table at the bottom. Nothing here makes the repo public or posts anything.

Everything on testnet uses neutral `pals-*` names (stealth stays on until the
user says otherwise). Do not use other accounts in `~/.near-credentials`.

## 0. What you need first

- A Phala Cloud account with credits, and an API key from its dashboard.
- A container registry the CVMs can pull from (public GHCR is simplest). Image
  pushes are not part of the build step and need the user's say-so.
- The existing testnet admin `pals-c0b7a5.testnet` with testnet NEAR (faucet
  accounts deleted into it are the usual source), and a `NEAR_AI_API_KEY`.
- Tools: `docker`, `node` 24, `cargo near`, `near` CLI, `phala` CLI
  (`npm i -g phala` or `npx phala`, **to verify**).

## 1. Images

```bash
docker build -f deploy/keeper.Dockerfile  -t <registry>/<keeper-image>:<tag> .
docker build -f deploy/trainer.Dockerfile -t <registry>/<trainer-image>:<tag> .
docker push <registry>/<keeper-image>:<tag>      # needs the user's go-ahead
docker push <registry>/<trainer-image>:<tag>
docker inspect --format '{{index .RepoDigests 0}}' <registry>/<trainer-image>:<tag>
```

Reference the images by digest (`@sha256:...`) in the compose files. The
compose hash is part of each app's attested identity, so a changed image digest
is a new app version: renters and collections trust that identity.

## 2. Deploy the two apps

Two CVMs: one for the keeper, one for the training app (the trainer's code must
be a separate identity from the keeper's, so renters trust only it). Put the
non-secret values in an env file kept out of git, e.g. `.phala-keeper.env`:

```
KEEPER_IMAGE=<registry>/<keeper-image>@sha256:<digest>
NEAR_RPC_URL=https://rpc.testnet.near.org           # or the chosen provider
NEAR_ARCHIVAL_RPC_URL=https://archival-rpc.testnet.fastnear.com
CONTRACT_ID=nft2.pals-c0b7a5.testnet
LAUNCHPAD_ID=<launchpad>
KEEPER_ACCOUNT_ID=<keeper-account>                  # e.g. pals-keeper.testnet
WEB_ORIGINS=<web-url>
AUTH_RECIPIENT=<auth-recipient>                     # must equal the web app's VITE_AUTH_RECIPIENT
NEAR_AI_API_KEY=<secret, encrypted at deploy>
```

and `.phala-trainer.env` with `TRAINER_IMAGE`, `NEAR_RPC_URL`,
`NEAR_ARCHIVAL_RPC_URL`, `TRAINER_ACCOUNT_ID=<trainer-account>`,
`LAUNCHPAD_ID=<launchpad>` (the trainer trains only on collections that
launchpad launched and lists as live; it refuses any other contract, which
could relay its signed calls), `WEB_ORIGINS`, and
`TRAINER_AUTH_RECIPIENT=<trainer-auth-recipient>` (e.g. `train.<web-host>`):
the trainer's own sign-in recipient, which must differ from the keeper's
`AUTH_RECIPIENT` so a sign-in for one never opens the other. The web app names
it in `VITE_TRAINER_URLS` as
`{"<trainer-app-id>":{"url":"<trainer-url>","recipient":"<trainer-auth-recipient>"}}`.
Then **(to verify)**:

```bash
phala auth login <api-key>
phala deploy -n <keeper-name>  -c deploy/phala/keeper-dataset.compose.yml -e .phala-keeper.env
phala deploy -n <trainer-name> -c deploy/phala/trainer.compose.yml        -e .phala-trainer.env
phala cvms list
phala cvms get <name>              # app id, public URL, status
phala logs <name>                  # the service prints its public key on start
```

Record the **app id** of each CVM below. Phala's gateway URL has the form
`https://<app-id>-<port>.<gateway-domain>`; take the exact URL from `cvms get`.
Set `WEB_ORIGINS` to the final web URL before the first deploy, since changing
env or compose later redeploys (and the keeper needs the origin to allow the
web app).

If the trainer logs a permission error on `/var/run/dstack.sock`: the image
runs as the unprivileged `node` user. Either add `user: root` to the trainer
service in the compose (which changes the compose hash) or relax the socket's
group access; decide with the user.

## 3. Fund the accounts and add the keys

Both services print the NEAR public key their account must hold on start
(`logs`). The keys derive from dstack's KMS, so they are stable for the app id.

```bash
# Neutral names, created under the admin account.
near account create-account fund-myself keeper.pals-c0b7a5.testnet '10 NEAR' \
  autogenerate-new-keypair save-to-keychain sign-as pals-c0b7a5.testnet \
  network-config testnet sign-with-keychain send
near account create-account fund-myself trainer.pals-c0b7a5.testnet '10 NEAR' \
  autogenerate-new-keypair save-to-keychain sign-as pals-c0b7a5.testnet \
  network-config testnet sign-with-keychain send
```

(any other `pals-*.testnet` names are fine; use them in `KEEPER_ACCOUNT_ID` and
`TRAINER_ACCOUNT_ID`.) Then add each derived key as **full-access**; the
trainer needs it because `record_training` takes a deposit and
`register_app_key` must be signed by the key it registers:

```bash
near account add-key <keeper-account>  grant-full-access use-manually ed25519:<keeper-key>  \
  network-config testnet sign-with-keychain send
near account add-key <trainer-account> grant-full-access use-manually ed25519:<trainer-key> \
  network-config testnet sign-with-keychain send
```

Budget: the keeper pays FastFS transaction fees per sample and the quote
registration; the trainer pays 0.05 NEAR to register plus 300 Tgas, and the
record deposit per run. 10 NEAR each is generous. Restart the CVMs after adding
keys (the startup warning "SETUP PROBLEM ... does not hold the key" should be
gone).

## 4. Check the deployed apps (step 3)

```bash
curl -s <trainer-url>/info
curl -s <trainer-url>/attestation        # mode phala, quote, event_log, compose_hash
curl -s <keeper-url>/attestation

cd keeper
NEAR_NETWORK=testnet COLLECTION_ID=<collection> KEEPER_ACCOUNT_ID=<keeper-account> \
  npm run live-check
```

`live-check` runs against testnet's MPC and FastFS; with `COLLECTION_ID` and a
`KEEPER_ROOT_SECRET` it also requests the collection's key and uploads as the
keeper. A deployed phala keeper has no exportable root secret, so run it
without those to check the MPC domain and FastFS reads, and prove the deployed
keeper through the attestation. Verify the trainer's quote with the web app's
verify logic (the verify page for the collection, or the functions in
`web/src/lib`); expect "quote verifies" and the app id in the quote to equal
the CVM's app id. Record both.

Go / no-go: both quotes verify; both app ids match the CVM records below; the
trainer's `heldout` count in `/info` is 50; `live-check` is all green. Any
failure stops the run.

## 5. Contracts on testnet (step 4)

Stealth build: the default build embeds the home-directory path and the crate
name. Use a rustc wrapper that adds `--remap-path-prefix=$HOME=/build` (plain
`RUSTFLAGS` is overridden by cargo-near) and build without the ABI:

```bash
cat > /tmp/rustc-remap.sh <<'SH'
#!/bin/sh
rustc="$1"; shift
exec "$rustc" "$@" --remap-path-prefix="$HOME=/build"
SH
chmod +x /tmp/rustc-remap.sh
export RUSTC_WRAPPER=/tmp/rustc-remap.sh
(cd contract  && cargo near build non-reproducible-wasm --no-abi --no-embed-abi)
(cd launchpad && cargo near build non-reproducible-wasm --no-abi --no-embed-abi)
unset RUSTC_WRAPPER
# Check nothing identifying survived (should print nothing):
strings contract/target/near/*.wasm launchpad/target/near/*.wasm | grep -i -e "$USER" -e nearkat
```

(The previous deployment's notes say the wrapper must be the rustc wrapper
form above; confirm that it still applies. Some method names and error strings
still contain "kat"; testnet is relaxed, mainnet is not.)

Deploy following `contract/README.md` and `launchpad/README.md`: deploy the
wasm, publish it as a global contract by hash, deploy the launchpad and call
`set_collection_code_hash`. Then the key source, which every launch inherits:

```bash
near contract call-function as-transaction <launchpad> set_key_source \
  json-args '{"key_source":{"mpc_contract_id":"v1.signer-prod.testnet","domain_id":2}}' \
  prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as pals-c0b7a5.testnet network-config testnet sign-with-keychain send
```

(`domain_id` 2 is the CKD domain on `v1.signer-prod.testnet`; confirm with
`near contract call-function as-read-only v1.signer-prod.testnet state
json-args {} ...` or the live-check output.) Point the keeper's `LAUNCHPAD_ID`
at the launchpad (redeploy the keeper CVM if it changed; its identity then
changes) and the web app's `VITE_CONTRACT_ID`, `VITE_KEEPER_URL`,
`VITE_FACTORY_ID`, `VITE_AUTH_RECIPIENT` at the new deployment.

## 6. Launch the hotdog collection (step 5)

```bash
scripts/fetch-hotdog.sh        # fills data/hotdog/train (200 images)
```

In the web app, sign in as the creator, open Launch, pick Dataset with the
keeper's app as the TEE, drop `data/hotdog/train`, confirm. Expect "200 samples
sealed".

## 7. Run the demo (step 6)

```bash
node scripts/demo-hotdog.ts --collection <collection> --creator <creator> \
  --holders <holder1>,<holder2>,<holder3> --fee 0.01 --duration 86400 \
  --app <trainer-app-id>
```

The last line must read `Total: 200 of 200 samples on offer`. Then, as
`weakrice6857.testnet` in the web app: rent 150 samples for the trainer app,
train, download the model, then drop a hotdog photo. The trainer registers its
own key on the collection the first time (`register_app_key`, attested).

Go / no-go: training under 60 s; held-out accuracy clearly above 50%; the run
is on-chain (`recordTx` on `GET <trainer-url>/runs/<id>`); rented samples
cannot be rented again. Fallback script: see `docs/demo/hotdog.md`.

## 8. Commit

Record the values below and commit the doc only. Do not make the repo public or
post anything until the user says so.

## Recorded values

| Item | Value |
| --- | --- |
| Keeper app id | `<keeper-app-id>` |
| Keeper URL | `<keeper-url>` |
| Keeper account | `<keeper-account>` |
| Trainer app id | `<trainer-app-id>` |
| Trainer URL | `<trainer-url>` |
| Trainer account | `<trainer-account>` |
| Keeper image digest | `<sha256:...>` |
| Trainer image digest | `<sha256:...>` |
| Launchpad | `<launchpad>` |
| Hotdog collection | `<collection>` |
| Web URL | `<web-url>` |

## Local check of the images (step 1)

```bash
docker build -f deploy/trainer.Dockerfile -t trainer-local .
docker build -f deploy/keeper.Dockerfile  -t keeper-local .
docker run --rm -p 8790:8790 -e TRAINER_MODE=local -e TRAINER_ROOT_SECRET=$(openssl rand -hex 32) \
  -e TRAINER_ACCOUNT_ID=pals-throwaway.testnet trainer-local
curl localhost:8790/info
```

The trainer image fetches the held-out images in a build stage (pinned commit),
so a clean checkout builds without running `scripts/fetch-hotdog.sh` first.
