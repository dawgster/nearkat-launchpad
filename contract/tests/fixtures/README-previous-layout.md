`nearkat_nft-c74795b.wasm` is the collection contract as built from commit
`c74795b` (`cargo near build non-reproducible-wasm --no-abi` in `contract/`),
the last version before key epochs. The sandbox test
`a_collection_from_before_key_epochs_upgrades_and_keeps_its_tokens` deploys
it, saves a token, and upgrades to the current code, so `migrate` is tested
against state that version really wrote.
