# Attestation fixtures

Real attestation data, used to test the on-chain checks in `src/attestation.rs`.

| File | Source | What it is |
|---|---|---|
| `intel-tdx-quote.bin`, `intel-tdx-collateral.json` | [dcap-qvl](https://github.com/Phala-Network/dcap-qvl) `sample/tdx_quote_td15ex*` (MIT) | A TDX quote and Intel's collateral for it, valid from 2026-10-08 to 2026-11-07. |
| `dstack-quote-report.json` | [dstack](https://github.com/Dstack-TEE/dstack) `verifier/fixtures/quote-report.json` (Apache-2.0) | A quote from a dstack CVM with its event log, so RTMR3 replay and the app-id event can be checked. |

The collateral expires on 2026-11-07. Tests that verify against it pin the
time, except the sandbox gas test, which runs at the real time and is skipped
once the collateral has expired.
