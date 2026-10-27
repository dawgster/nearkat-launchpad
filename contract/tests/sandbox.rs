use std::sync::{Arc, OnceLock};

use near_api::types::{AccountId, NearToken};
use near_api::{Contract, NetworkConfig, Signer, Tokens};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

const PRICE: NearToken = NearToken::from_near(1);
const YOCTO: NearToken = NearToken::from_yoctonear(1);

/// Builds the contract once per test binary and returns its wasm bytes.
fn wasm() -> &'static [u8] {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| {
        let artifact = cargo_near_build::build(cargo_near_build::BuildOpts::default())
            .expect("contract build failed");
        std::fs::read(artifact.path).expect("cannot read built wasm")
    })
}

struct User {
    id: AccountId,
    signer: Arc<Signer>,
}

impl User {
    fn new(account: &GenesisAccount) -> TestResult<Self> {
        Ok(Self {
            id: account.account_id.clone(),
            signer: Signer::from_secret_key(account.private_key.parse()?)?,
        })
    }
}

struct Env {
    // Dropping the sandbox stops the node, so it lives as long as the test.
    _sandbox: Sandbox,
    network: NetworkConfig,
    contract: Contract,
    admin: User,
    keeper: User,
    treasury: User,
    alice: User,
    bob: User,
}

async fn setup() -> TestResult<Env> {
    setup_with(Value::Null).await
}

/// Deploys the contract, with `tee` as the collection's TEE requirement.
async fn setup_with(tee: Value) -> TestResult<Env> {
    setup_with_code(wasm(), tee).await
}

/// Deploys `code` and initialises it as the collection.
async fn setup_with_code(code: &[u8], tee: Value) -> TestResult<Env> {
    let names = ["nearkat", "admin", "keeper", "treasury", "alice", "bob"];
    let accounts = names
        .iter()
        .map(|name| Ok(GenesisAccount::generate_with_name(name.parse()?)))
        .collect::<TestResult<Vec<_>>>()?;
    let sandbox = Sandbox::start_sandbox_with_config(SandboxConfig {
        additional_accounts: accounts.clone(),
        ..Default::default()
    })
    .await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);

    let owner = User::new(&accounts[0])?;
    let env = Env {
        _sandbox: sandbox,
        network,
        contract: Contract(owner.id.clone()),
        admin: User::new(&accounts[1])?,
        keeper: User::new(&accounts[2])?,
        treasury: User::new(&accounts[3])?,
        alice: User::new(&accounts[4])?,
        bob: User::new(&accounts[5])?,
    };
    Contract::deploy(owner.id.clone())
        .use_code(code.to_vec())
        .with_init_call(
            "new",
            json!({
                "admin_id": env.admin.id,
                "keeper_id": env.keeper.id,
                "treasury_id": env.treasury.id,
                "mint_price": PRICE,
                "collection": {
                    "name": "Nearkat",
                    "symbol": "KAT",
                    "base_uri": "https://art.example/",
                    "tee": tee,
                    "key_source": { "mpc_contract_id": "mpc.test.near", "domain_id": 2 },
                },
            }),
        )?
        .with_signer(owner.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();
    Ok(env)
}

/// Sends a contract call and returns whether it succeeded plus its JSON result.
async fn call(
    env: &Env,
    who: &User,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> TestResult<Result<Value, String>> {
    let outcome = env
        .contract
        .call_function(method, args)
        .transaction()
        .deposit(deposit)
        .with_signer(who.id.clone(), who.signer.clone())
        .send_to(&env.network)
        .await?;
    Ok(match outcome.into_result() {
        Ok(success) => Ok(success.json().unwrap_or(Value::Null)),
        Err(failure) => Err(format!("{failure:?}")),
    })
}

async fn mint(env: &Env, who: &User, deposit: NearToken) -> TestResult<String> {
    let token = call(env, who, "mint", json!({}), deposit).await??;
    Ok(token["token_id"].as_str().unwrap().to_string())
}

async fn kat(env: &Env, token_id: &str) -> TestResult<Value> {
    Ok(env
        .contract
        .call_function("get_kat", json!({ "token_id": token_id }))
        .read_only::<Value>()
        .fetch_from(&env.network)
        .await?
        .data)
}

async fn transfer(
    env: &Env,
    from: &User,
    to: &User,
    token_id: &str,
) -> TestResult<Result<Value, String>> {
    call(
        env,
        from,
        "nft_transfer",
        json!({ "receiver_id": to.id, "token_id": token_id }),
        YOCTO,
    )
    .await
}

fn hash_b64(byte: u8) -> String {
    use near_sdk::base64::Engine;
    near_sdk::base64::engine::general_purpose::STANDARD.encode([byte; 32])
}

#[tokio::test]
async fn personality_and_balance_follow_the_kat_on_transfer() -> TestResult {
    let env = setup().await?;
    let id = mint(&env, &env.alice, NearToken::from_near(3)).await?;
    call(
        &env,
        &env.keeper,
        "set_context",
        json!({
            "token_id": id, "context_hash": hash_b64(7), "context_ref": "ref-1", "version": "1", "key_epoch": 1,
        }),
        NearToken::from_yoctonear(0),
    )
    .await??;
    let before = kat(&env, &id).await?;
    assert_eq!(before["owner_id"], env.alice.id.as_str());

    transfer(&env, &env.alice, &env.bob, &id).await??;

    let after = kat(&env, &id).await?;
    assert_eq!(after["owner_id"], env.bob.id.as_str());
    assert_eq!(after["context_hash"], before["context_hash"]);
    assert_eq!(after["context_ref"], "ref-1");
    assert_eq!(after["context_version"], "1");
    assert_eq!(after["balance"], before["balance"]);
    Ok(())
}

#[tokio::test]
async fn previous_owner_cannot_transfer_back() -> TestResult {
    let env = setup().await?;
    let id = mint(&env, &env.alice, NearToken::from_near(2)).await?;
    transfer(&env, &env.alice, &env.bob, &id).await??;

    let result = transfer(&env, &env.alice, &env.alice, &id).await?;

    assert!(result.unwrap_err().contains("Sender not approved"));
    assert_eq!(kat(&env, &id).await?["owner_id"], env.bob.id.as_str());
    Ok(())
}

#[tokio::test]
async fn debit_batch_is_all_or_nothing() -> TestResult {
    let env = setup().await?;
    let rich = mint(&env, &env.alice, NearToken::from_near(5)).await?;
    let poor = mint(&env, &env.alice, NearToken::from_millinear(1100)).await?;
    let rich_before = kat(&env, &rich).await?["balance"].clone();
    let poor_before = kat(&env, &poor).await?["balance"].clone();

    let result = call(
        &env,
        &env.keeper,
        "debit_batch",
        json!({ "seq": "1", "items": [
            [rich, NearToken::from_near(1)],
            [poor, NearToken::from_near(1)],
        ]}),
        NearToken::from_yoctonear(0),
    )
    .await?;

    assert!(result
        .unwrap_err()
        .contains("Insufficient balance for kat 2"));
    assert_eq!(kat(&env, &rich).await?["balance"], rich_before);
    assert_eq!(kat(&env, &poor).await?["balance"], poor_before);

    // The failed batch did not use up its sequence number.
    call(
        &env,
        &env.keeper,
        "debit_batch",
        json!({ "seq": "1", "items": [[rich, NearToken::from_near(1)]] }),
        NearToken::from_yoctonear(0),
    )
    .await??;
    Ok(())
}

#[tokio::test]
async fn mint_revenue_goes_to_the_treasury_and_inference_to_the_keeper() -> TestResult {
    let env = setup().await?;
    let id = mint(&env, &env.alice, NearToken::from_near(3)).await?;
    call(
        &env,
        &env.keeper,
        "debit_batch",
        json!({ "seq": "1", "items": [[id, NearToken::from_millinear(500)]] }),
        NearToken::from_yoctonear(0),
    )
    .await??;
    let balance_of = |user: &User| Tokens::account(user.id.clone()).near_balance();
    let treasury_before = balance_of(&env.treasury)
        .fetch_from(&env.network)
        .await?
        .total;
    let keeper_before = balance_of(&env.keeper)
        .fetch_from(&env.network)
        .await?
        .total;

    call(&env, &env.admin, "withdraw_treasury", json!({}), YOCTO).await??;
    call(
        &env,
        &env.keeper,
        "withdraw_inference",
        json!({}),
        NearToken::from_yoctonear(0),
    )
    .await??;

    let treasury_after = balance_of(&env.treasury)
        .fetch_from(&env.network)
        .await?
        .total;
    let keeper_after = balance_of(&env.keeper)
        .fetch_from(&env.network)
        .await?
        .total;
    assert_eq!(treasury_after.saturating_sub(treasury_before), PRICE);
    // The keeper paid gas for its call, so it gains a little less than the debit.
    let keeper_gain = keeper_after.saturating_sub(keeper_before);
    assert!(
        keeper_gain > NearToken::from_millinear(400),
        "{keeper_gain}"
    );
    assert!(
        keeper_gain <= NearToken::from_millinear(500),
        "{keeper_gain}"
    );
    Ok(())
}

#[tokio::test]
async fn contract_stays_solvent_through_context_approval_and_transfer() -> TestResult {
    let env = setup().await?;
    let contract_balance = || Tokens::account(env.contract.0.clone()).near_balance();
    let before = contract_balance().fetch_from(&env.network).await?;

    let id = mint(&env, &env.alice, NearToken::from_near(2)).await?;
    call(
        &env,
        &env.keeper,
        "set_context",
        json!({
            "token_id": id, "context_hash": hash_b64(7), "context_ref": "x".repeat(256), "version": "1", "key_epoch": 1,
        }),
        NearToken::from_yoctonear(0),
    )
    .await??;
    call(
        &env,
        &env.alice,
        "nft_approve",
        json!({ "token_id": id, "account_id": env.keeper.id }),
        NearToken::from_millinear(10),
    )
    .await??;
    transfer(&env, &env.alice, &env.bob, &id).await??;

    let after = contract_balance().fetch_from(&env.network).await?;
    let kat_balance: NearToken = serde_json::from_value(kat(&env, &id).await?["balance"].clone())?;
    // What the contract gained, minus what storage staking now locks, must
    // cover everything it owes: the kat's balance and the accrued mint price.
    let free_gain = after
        .total
        .saturating_sub(before.total)
        .saturating_sub(after.storage_locked.saturating_sub(before.storage_locked));
    let owed = kat_balance.saturating_add(PRICE);
    assert!(free_gain >= owed, "{free_gain} < {owed}");
    Ok(())
}

#[tokio::test]
async fn failed_treasury_transfer_restores_the_accrual() -> TestResult {
    let env = setup().await?;
    mint(&env, &env.alice, NearToken::from_near(2)).await?;
    call(
        &env,
        &env.admin,
        "set_treasury",
        json!({ "treasury_id": "ghost" }),
        YOCTO,
    )
    .await??;

    // "ghost" does not exist, so the transfer receipt fails.
    let _ = call(&env, &env.admin, "withdraw_treasury", json!({}), YOCTO).await?;

    let config: Value = env
        .contract
        .call_function("get_config", json!({}))
        .read_only::<Value>()
        .fetch_from(&env.network)
        .await?
        .data;
    assert_eq!(
        serde_json::from_value::<NearToken>(config["treasury_accrued"].clone())?,
        PRICE
    );
    Ok(())
}

/// Verifying a TDX quote on-chain must fit in a transaction. Runs the real
/// Intel-signed fixture through `register_keeper_key` at the node's real
/// time: Intel's checks pass, and the call then stops at the key binding,
/// because the fixture was not made for our key.
#[tokio::test]
async fn a_real_tdx_quote_verifies_on_chain_within_the_gas_limit() -> TestResult {
    // The fixture's collateral expires on 2026-11-07T00:09:46Z.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    if now >= 1_793_923_786 {
        eprintln!("skipped: the fixture's collateral has expired");
        return Ok(());
    }
    let env = setup_with(json!({ "Phala": { "app_id": "0a1b2c" } })).await?;
    let quote = include_bytes!("fixtures/intel-tdx-quote.bin");
    let collateral = include_str!("fixtures/intel-tdx-collateral.json");
    let outcome = env
        .contract
        .call_function(
            "register_keeper_key",
            json!({
                "public_key": "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp",
                "seal_public_key": "11".repeat(32),
                "quote": quote.iter().map(|b| format!("{b:02x}")).collect::<String>(),
                "collateral": collateral,
                "event_log": "[]",
            }),
        )
        .transaction()
        .gas(near_api::types::NearGas::from_tgas(300))
        .with_signer(env.alice.id.clone(), env.alice.signer.clone())
        .send_to(&env.network)
        .await?;
    let near_api::types::transaction::result::TransactionResult::Full(result) = outcome else {
        return Err("the transaction did not finish".into());
    };
    let burnt = result.total_gas_burnt;
    let failure = format!("{:?}", result.outcomes());
    eprintln!("register_keeper_key burnt {} Tgas", burnt.as_tgas());
    assert!(
        failure.contains("does not commit to these keys"),
        "Intel's checks should pass on-chain: {failure}"
    );
    assert!(burnt.as_tgas() < 250, "{} Tgas", burnt.as_tgas());
    Ok(())
}

fn mock_mpc_wasm() -> Vec<u8> {
    let artifact = cargo_near_build::build(
        cargo_near_build::BuildOpts::builder()
            .manifest_path("../mock-mpc/Cargo.toml")
            .no_abi(true)
            .build(),
    )
    .expect("mock MPC build failed");
    std::fs::read(artifact.path).expect("cannot read built wasm")
}

/// The keeper asks the collection for its context key; the collection asks
/// the MPC contract, which answers with the key encrypted to the keeper's
/// throwaway key. Only the keeper may ask.
#[tokio::test]
async fn the_keeper_gets_the_context_key_from_the_mpc_network_through_the_collection() -> TestResult
{
    let env = setup_with_key_source().await?;
    // The BLS12-381 G1 generator, compressed: a valid point anyone can use for a test.
    let generator = hex::decode(
        "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
    )?;
    let app_key = format!("bls12381g1:{}", bs58::encode(generator).into_string());
    let app_key = app_key.as_str();

    // Anyone else is refused before the MPC network is asked.
    let refused = call(
        &env,
        &env.alice,
        "request_context_key",
        json!({ "app_public_key": app_key }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert!(refused.unwrap_err().contains("Only the keeper"));

    let outcome = env
        .contract
        .call_function("request_context_key", json!({ "app_public_key": app_key }))
        .transaction()
        .gas(near_api::types::NearGas::from_tgas(300))
        .with_signer(env.keeper.id.clone(), env.keeper.signer.clone())
        .send_to(&env.network)
        .await?;
    let near_api::types::transaction::result::TransactionResult::Full(result) = &outcome else {
        return Err("the transaction did not finish".into());
    };
    eprintln!(
        "request_context_key burnt {} Tgas",
        result.total_gas_burnt.as_tgas()
    );
    let response: Value = outcome.into_result()?.json()?;
    assert!(response["big_y"]
        .as_str()
        .unwrap()
        .starts_with("bls12381g1:"));
    assert!(response["big_c"]
        .as_str()
        .unwrap()
        .starts_with("bls12381g1:"));
    Ok(())
}

async fn setup_with_key_source() -> TestResult<Env> {
    let mpc = GenesisAccount::generate_with_name("mpc".parse()?);
    let names = ["nearkat", "admin", "keeper", "treasury", "alice", "bob"];
    let mut accounts = names
        .iter()
        .map(|name| Ok(GenesisAccount::generate_with_name(name.parse()?)))
        .collect::<TestResult<Vec<_>>>()?;
    accounts.push(mpc.clone());
    let sandbox = Sandbox::start_sandbox_with_config(SandboxConfig {
        additional_accounts: accounts.clone(),
        ..Default::default()
    })
    .await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let mpc_user = User::new(&mpc)?;
    Contract::deploy(mpc_user.id.clone())
        .use_code(mock_mpc_wasm())
        .with_init_call(
            "new",
            json!({ "master_secret": "11".repeat(32), "domain_id": 2 }),
        )?
        .gas(near_api::types::NearGas::from_tgas(300))
        .with_signer(mpc_user.signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let owner = User::new(&accounts[0])?;
    let env = Env {
        _sandbox: sandbox,
        network,
        contract: Contract(owner.id.clone()),
        admin: User::new(&accounts[1])?,
        keeper: User::new(&accounts[2])?,
        treasury: User::new(&accounts[3])?,
        alice: User::new(&accounts[4])?,
        bob: User::new(&accounts[5])?,
    };
    Contract::deploy(owner.id.clone())
        .use_code(wasm().to_vec())
        .with_init_call(
            "new",
            json!({
                "admin_id": env.admin.id,
                "keeper_id": env.keeper.id,
                "treasury_id": env.treasury.id,
                "mint_price": PRICE,
                "collection": {
                    "name": "Nearkat",
                    "symbol": "KAT",
                    "base_uri": "",
                    "key_source": { "mpc_contract_id": mpc_user.id, "domain_id": 2 },
                },
            }),
        )?
        .with_signer(owner.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();
    Ok(env)
}

/// The collection contract as of commit c74795b: the layout before key epochs.
const PREVIOUS_LAYOUT_WASM: &[u8] = include_bytes!("fixtures/nearkat_nft-c74795b.wasm");

#[tokio::test]
async fn a_collection_from_before_key_epochs_upgrades_and_keeps_its_tokens() -> TestResult {
    let env = setup_with_code(PREVIOUS_LAYOUT_WASM, Value::Null).await?;
    let id = mint(&env, &env.alice, NearToken::from_near(3)).await?;
    // Saved as the previous version did, without an epoch.
    call(
        &env,
        &env.keeper,
        "set_context",
        json!({ "token_id": id, "context_hash": hash_b64(7), "context_ref": "ref-old", "version": "1" }),
        NearToken::from_yoctonear(0),
    )
    .await??;

    // The new code, published by hash; the admin moves the collection to it.
    Contract::deploy_global_contract_code(wasm().to_vec())
        .as_hash()
        .with_signer(env.admin.id.clone(), env.admin.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();
    let code_hash: near_sdk::json_types::Base58CryptoHash =
        near_sdk::env::sha256_array(wasm()).into();
    env.contract
        .call_function("upgrade", json!({ "code_hash": code_hash }))
        .transaction()
        .deposit(YOCTO)
        .gas(near_api::types::NearGas::from_tgas(300))
        .with_signer(env.admin.id.clone(), env.admin.signer.clone())
        .send_to(&env.network)
        .await?
        .into_result()?;

    let collection: Value = env
        .contract
        .call_function("get_collection", json!({}))
        .read_only::<Value>()
        .fetch_from(&env.network)
        .await?
        .data;
    assert_eq!(collection["key_epoch"], 1);
    assert_eq!(collection["code_hash"], json!(code_hash));
    let before = kat(&env, &id).await?;
    assert_eq!(before["owner_id"], env.alice.id.as_str());
    assert_eq!(before["context_ref"], "ref-old");
    assert_eq!(
        before["key_epoch"], 0,
        "saved under the key from before epochs"
    );

    // The next save moves the token to epoch 1.
    call(
        &env,
        &env.keeper,
        "set_context",
        json!({ "token_id": id, "context_hash": hash_b64(8), "context_ref": "ref-new", "version": "2", "key_epoch": 1 }),
        NearToken::from_yoctonear(0),
    )
    .await??;
    assert_eq!(kat(&env, &id).await?["key_epoch"], 1);
    Ok(())
}
