`nearkat_nft-c74795b.wasm` is the collection contract as built from commit
`c74795b` (`cargo near build non-reproducible-wasm --no-abi` in `contract/`),
the last version before key epochs. The sandbox test
`a_collection_from_before_key_epochs_upgrades_and_keeps_its_tokens` deploys
it, saves a token, and upgrades to the current code, so `migrate` is tested
against state that version really wrote.

`nearkat_nft-824f1dc.wasm` is the same, built from commit `824f1dc`: key
epochs, before token wallets. `a_collection_from_before_wallets_upgrades_and_can_turn_them_on`
upgrades from it.
