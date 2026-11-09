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
    public_key: String,
    signer: Arc<Signer>,
}

impl User {
    fn new(account: &GenesisAccount) -> TestResult<Self> {
        Ok(Self {
            id: account.account_id.clone(),
            public_key: account.public_key.clone(),
            signer: Signer::from_secret_key(account.private_key.parse()?)?,
        })
    }
}

struct Env {
    // Dropping the sandbox stops the node, so it lives as long as the test.
    _sandbox: Sandbox,
    rpc_url: String,
    network: NetworkConfig,
    contract: Contract,
    /// Signs for the collection's own account.
    owner_signer: Arc<Signer>,
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
        rpc_url: sandbox.rpc_addr.clone(),
        _sandbox: sandbox,
        network,
        contract: Contract(owner.id.clone()),
        owner_signer: owner.signer.clone(),
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
    let (env, mpc_id, _) = key_source_world(&[]).await?;
    Contract::deploy(env.contract.0.clone())
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
                    "key_source": { "mpc_contract_id": mpc_id, "domain_id": 2 },
                    "wallet_code_hash": publish_token_wallet(&env).await?,
                },
            }),
        )?
        .with_signer(env.owner_signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();
    Ok(env)
}

/// A sandbox with the mock MPC contract deployed at `mpc` (domain 2) and the
/// usual accounts, plus one more per name in `extra`. The collection's own
/// account exists but has nothing deployed.
async fn key_source_world(extra: &[&str]) -> TestResult<(Env, AccountId, Vec<User>)> {
    let mpc = GenesisAccount::generate_with_name("mpc".parse()?);
    let names = ["nearkat", "admin", "keeper", "treasury", "alice", "bob"];
    let mut accounts = names
        .iter()
        .chain(extra)
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
        rpc_url: sandbox.rpc_addr.clone(),
        _sandbox: sandbox,
        network,
        contract: Contract(owner.id.clone()),
        owner_signer: owner.signer.clone(),
        admin: User::new(&accounts[1])?,
        keeper: User::new(&accounts[2])?,
        treasury: User::new(&accounts[3])?,
        alice: User::new(&accounts[4])?,
        bob: User::new(&accounts[5])?,
    };
    let more = (0..extra.len())
        .map(|i| User::new(&accounts[6 + i]))
        .collect::<TestResult<Vec<_>>>()?;
    Ok((env, mpc_user.id, more))
}

fn token_wallet_wasm() -> &'static [u8] {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| {
        let artifact = cargo_near_build::build(
            cargo_near_build::BuildOpts::builder()
                .manifest_path("../token-wallet/Cargo.toml")
                .no_abi(true)
                .build(),
        )
        .expect("token wallet build failed");
        std::fs::read(artifact.path).expect("cannot read built wasm")
    })
}

/// Publishes the token wallet code by hash, as a launchpad operator would, and returns the hash.
async fn publish_token_wallet(env: &Env) -> TestResult<near_sdk::json_types::Base58CryptoHash> {
    Contract::deploy_global_contract_code(token_wallet_wasm().to_vec())
        .as_hash()
        .with_signer(env.admin.id.clone(), env.admin.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();
    Ok(near_sdk::env::sha256_array(token_wallet_wasm()).into())
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

/// A raw JSON-RPC call to the sandbox node.
async fn rpc(env: &Env, method: &str, params: Value) -> TestResult<Value> {
    let response: Value = reqwest::Client::new()
        .post(&env.rpc_url)
        .json(&json!({ "jsonrpc": "2.0", "id": "t", "method": method, "params": params }))
        .send()
        .await?
        .json()
        .await?;
    match response.get("result") {
        Some(result) => Ok(result.clone()),
        None => Err(format!("{method} failed: {response}").into()),
    }
}

async fn balance(env: &Env, account: &str) -> TestResult<u128> {
    let view = rpc(
        env,
        "query",
        json!({ "request_type": "view_account", "finality": "optimistic", "account_id": account }),
    )
    .await?;
    Ok(view["amount"].as_str().unwrap().parse()?)
}

/// The collection contract as of commit 824f1dc: key epochs, before token wallets.
const BEFORE_WALLETS_WASM: &[u8] = include_bytes!("fixtures/nearkat_nft-824f1dc.wasm");

#[tokio::test]
async fn a_collection_from_before_wallets_upgrades_and_can_turn_them_on() -> TestResult {
    let env = setup_with_code(BEFORE_WALLETS_WASM, Value::Null).await?;
    let id = mint(&env, &env.alice, NearToken::from_near(3)).await?;
    call(
        &env,
        &env.keeper,
        "set_context",
        json!({ "token_id": id, "context_hash": hash_b64(7), "context_ref": "ref-1", "version": "1", "key_epoch": 1 }),
        NearToken::from_yoctonear(0),
    )
    .await??;
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

    let kat_after = kat(&env, &id).await?;
    assert_eq!(kat_after["context_ref"], "ref-1");
    assert_eq!(kat_after["key_epoch"], 1);
    assert_eq!(get_wallet(&env).await?, Value::Null, "wallets start off");
    let code_hash = publish_token_wallet(&env).await?;
    call(
        &env,
        &env.admin,
        "enable_wallets",
        json!({ "code_hash": code_hash }),
        YOCTO,
    )
    .await??;
    assert_eq!(
        get_wallet(&env).await?["account_id"],
        format!("1.{}", env.contract.0)
    );
    Ok(())
}

async fn get_wallet(env: &Env) -> TestResult<Value> {
    Ok(env
        .contract
        .call_function("get_wallet", json!({ "token_id": "1" }))
        .read_only::<Value>()
        .fetch_from(&env.network)
        .await?
        .data)
}

async fn wallet_send(
    env: &Env,
    who: &User,
    receiver: &str,
    amount: NearToken,
    deposit: NearToken,
) -> TestResult<Result<Value, String>> {
    let outcome = env
        .contract
        .call_function(
            "wallet_send",
            json!({ "token_id": "1", "receiver_id": receiver, "amount": amount, "memo": "a gift" }),
        )
        .transaction()
        .deposit(deposit)
        .gas(near_api::types::NearGas::from_tgas(100))
        .with_signer(who.id.clone(), who.signer.clone())
        .send_to(&env.network)
        .await?;
    Ok(match outcome.into_result() {
        Ok(success) => Ok(success.json()?),
        Err(failure) => Err(format!("{failure:?}")),
    })
}

#[tokio::test]
async fn a_tokens_own_wallet_pays_under_its_owners_rules_and_goes_with_it_at_once() -> TestResult {
    let env = setup_with_key_source().await?;
    let id = mint(&env, &env.alice, NearToken::from_near(3)).await?;
    let wallet_id = format!("1.{}", env.contract.0);
    assert_eq!(get_wallet(&env).await?["account_id"], wallet_id.as_str());

    // Alice opens it; anyone can put NEAR in.
    call(
        &env,
        &env.alice,
        "open_wallet",
        json!({ "token_id": id }),
        NearToken::from_millinear(20),
    )
    .await??;
    assert_eq!(get_wallet(&env).await?["open"], true);
    Tokens::account(env.bob.id.clone())
        .send_to(wallet_id.parse()?)
        .near(NearToken::from_near(2))
        .with_signer(env.bob.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();

    // Nobody but the collection can move its NEAR, not even its owner directly.
    let direct = Contract(wallet_id.parse()?)
        .call_function(
            "transfer",
            json!({ "receiver_id": env.alice.id, "amount": NearToken::from_near(1) }),
        )
        .transaction()
        .with_signer(env.alice.id.clone(), env.alice.signer.clone())
        .send_to(&env.network)
        .await?
        .into_result();
    assert!(format!("{direct:?}").contains("Only this wallet's collection can send from it"));

    // The owner sends through the collection.
    let treasury_before = balance(&env, env.treasury.id.as_str()).await?;
    let sent = wallet_send(
        &env,
        &env.alice,
        env.treasury.id.as_str(),
        NearToken::from_millinear(500),
        YOCTO,
    )
    .await??;
    assert_eq!(sent, json!(true));
    assert_eq!(
        balance(&env, env.treasury.id.as_str()).await? - treasury_before,
        NearToken::from_millinear(500).as_yoctonear()
    );

    // The mind can't until Alice allows it; then only within the allowance.
    let refused = wallet_send(
        &env,
        &env.keeper,
        env.bob.id.as_str(),
        NearToken::from_millinear(10),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert!(refused
        .unwrap_err()
        .contains("hasn't let this token's mind spend"));
    call(
        &env,
        &env.alice,
        "set_wallet_policy",
        json!({ "token_id": id, "daily_allowance": NearToken::from_millinear(100), "max_payment": NearToken::from_millinear(60) }),
        YOCTO,
    )
    .await??;
    let bob_before = balance(&env, env.bob.id.as_str()).await?;
    let sent = wallet_send(
        &env,
        &env.keeper,
        env.bob.id.as_str(),
        NearToken::from_millinear(60),
        NearToken::from_yoctonear(0),
    )
    .await??;
    assert_eq!(sent, json!(true));
    assert_eq!(
        balance(&env, env.bob.id.as_str()).await? - bob_before,
        NearToken::from_millinear(60).as_yoctonear()
    );
    let over = wallet_send(
        &env,
        &env.keeper,
        env.bob.id.as_str(),
        NearToken::from_millinear(60),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert!(over
        .unwrap_err()
        .contains("more than the owner lets the mind send today"));

    // A payment to an account that doesn't exist fails, and the mind gets its allowance back.
    let lost = wallet_send(
        &env,
        &env.keeper,
        "nobody-here.test.near",
        NearToken::from_millinear(30),
        NearToken::from_yoctonear(0),
    )
    .await??;
    assert_eq!(lost, json!(false));
    assert_eq!(
        get_wallet(&env).await?["spent_today"],
        NearToken::from_millinear(60).as_yoctonear().to_string()
    );

    // Right after all that, the token changes hands, and the wallet goes with it.
    let before_sale = balance(&env, &wallet_id).await?;
    transfer(&env, &env.alice, &env.bob, &id).await??;
    let wallet = get_wallet(&env).await?;
    assert_eq!(
        wallet["daily_allowance"], "0",
        "Bob starts with no allowance for the mind"
    );
    assert_eq!(wallet["payments"], 2);
    let sent = wallet_send(
        &env,
        &env.bob,
        env.bob.id.as_str(),
        NearToken::from_millinear(100),
        YOCTO,
    )
    .await??;
    assert_eq!(sent, json!(true));
    // It ran its own code, so it earned a sliver of gas reward back.
    let spent = before_sale - balance(&env, &wallet_id).await?;
    assert!(
        spent > NearToken::from_millinear(99).as_yoctonear()
            && spent <= NearToken::from_millinear(100).as_yoctonear()
    );
    // And Alice can't touch it any more.
    let alice = wallet_send(
        &env,
        &env.alice,
        env.alice.id.as_str(),
        NearToken::from_millinear(100),
        YOCTO,
    )
    .await?;
    assert!(alice.is_err());
    Ok(())
}

async fn loan(env: &Env, token_id: &str) -> TestResult<Value> {
    Ok(env
        .contract
        .call_function("get_loan", json!({ "token_id": token_id }))
        .read_only::<Value>()
        .fetch_from(&env.network)
        .await?
        .data)
}

#[tokio::test]
async fn a_token_rented_out_pays_its_owner_and_comes_back_when_its_time_is_up() -> TestResult {
    let env = setup().await?;
    let id = mint(&env, &env.alice, NearToken::from_near(3)).await?;

    // Alice offers it to anyone, for 1 NEAR, for a few seconds.
    let offered = call(
        &env,
        &env.alice,
        "lend",
        json!({
            "token_id": id, "duration_s": "4", "messages": 10,
            "sees_memory": false, "learns": false, "fee": NearToken::from_near(1),
        }),
        NearToken::from_millinear(10),
    )
    .await??;
    assert_eq!(offered["status"], "offered");

    // Bob takes it, overpaying; the fee goes to Alice and the rest comes back.
    let alice_before = balance(&env, env.alice.id.as_str()).await?;
    let bob_before = balance(&env, env.bob.id.as_str()).await?;
    let started = call(
        &env,
        &env.bob,
        "borrow",
        json!({ "token_id": id }),
        NearToken::from_millinear(1500),
    )
    .await??;
    assert_eq!(started["status"], "active");
    assert_eq!(started["borrower_id"], env.bob.id.as_str());
    assert_eq!(
        balance(&env, env.alice.id.as_str()).await? - alice_before,
        NearToken::from_near(1).as_yoctonear()
    );
    let bob_spent = bob_before - balance(&env, env.bob.id.as_str()).await?;
    assert!(bob_spent >= NearToken::from_near(1).as_yoctonear());
    assert!(bob_spent < NearToken::from_millinear(1010).as_yoctonear());

    // While it's rented, Alice can't sell it or take it back.
    let held = transfer(&env, &env.alice, &env.treasury, &id).await?;
    assert!(held.unwrap_err().contains("rented out"));
    let ended = call(
        &env,
        &env.alice,
        "end_loan",
        json!({ "token_id": id }),
        YOCTO,
    )
    .await?;
    assert!(ended.unwrap_err().contains("It's rented"));

    // Once its time is up, it's hers to give away; the loan goes with that.
    tokio::time::sleep(std::time::Duration::from_secs(6)).await;
    assert_eq!(loan(&env, &id).await?["status"], "over");
    transfer(&env, &env.alice, &env.treasury, &id).await??;
    assert_eq!(loan(&env, &id).await?, Value::Null);
    Ok(())
}

// ---- Dataset collections ----

const SAMPLES: u64 = 120;

/// The BLS12-381 G1 key `secret·G`, as the MPC network wants it: a throwaway
/// key an app makes for one request.
fn app_keypair(seed: u8) -> (bls12_381::Scalar, String) {
    use bls12_381::{G1Affine, G1Projective, Scalar};
    let secret = Scalar::from_bytes_wide(&[seed; 64]);
    let public = G1Affine::from(G1Projective::generator() * secret).to_compressed();
    (
        secret,
        format!("bls12381g1:{}", bs58::encode(public).into_string()),
    )
}

fn decode_g1(text: &str) -> bls12_381::G1Projective {
    let raw: [u8; 48] = bs58::decode(text.strip_prefix("bls12381g1:").unwrap())
        .into_vec()
        .unwrap()
        .try_into()
        .unwrap();
    bls12_381::G1Projective::from(
        Option::<bls12_381::G1Affine>::from(bls12_381::G1Affine::from_compressed(&raw)).unwrap(),
    )
}

/// Decrypts an MPC response with the app's secret: `C - a·Y` is the derived key.
fn decrypt(response: &Value, secret: bls12_381::Scalar) -> bls12_381::G1Affine {
    let y = decode_g1(response["big_y"].as_str().unwrap());
    let c = decode_g1(response["big_c"].as_str().unwrap());
    bls12_381::G1Affine::from(c - y * secret)
}

/// Checks a derived key against the mock's derivation: it must be a valid
/// BLS signature, under the MPC public key, on the app id for this collection
/// and path.
fn assert_is_the_key_for(
    derived: bls12_381::G1Affine,
    mpc_public_key: &str,
    collection: &str,
    path: &str,
) {
    use bls12_381::hash_to_curve::{ExpandMsgXmd, HashToCurve};
    use bls12_381::{G1Projective, G2Affine};
    use sha3::{Digest, Sha3_256};
    let pk_bytes: [u8; 96] = bs58::decode(mpc_public_key.strip_prefix("bls12381g2:").unwrap())
        .into_vec()
        .unwrap()
        .try_into()
        .unwrap();
    let pk = Option::<G2Affine>::from(G2Affine::from_compressed(&pk_bytes)).unwrap();
    let app_id = Sha3_256::digest(
        format!("near-mpc v0.1.0 app_id derivation:{collection},{path}").as_bytes(),
    );
    let hashed = <G1Projective as HashToCurve<ExpandMsgXmd<sha2_09::Sha256>>>::hash_to_curve(
        [pk.to_compressed().as_slice(), app_id.as_slice()].concat(),
        b"NEAR BLS12381G1_XMD:SHA-256_SSWU_RO_",
    );
    assert_eq!(
        bls12_381::pairing(&derived, &G2Affine::generator()),
        bls12_381::pairing(&bls12_381::G1Affine::from(hashed), &pk)
    );
}

/// Like `call`, with the gas to attach.
async fn call_gas(
    env: &Env,
    who: &User,
    method: &str,
    args: Value,
    deposit: NearToken,
    tgas: u64,
) -> TestResult<Result<Value, String>> {
    let outcome = env
        .contract
        .call_function(method, args)
        .transaction()
        .deposit(deposit)
        .gas(near_api::types::NearGas::from_tgas(tgas))
        .with_signer(who.id.clone(), who.signer.clone())
        .send_to(&env.network)
        .await?;
    Ok(match outcome.into_result() {
        Ok(success) => {
            eprintln!("{method} burnt {} Tgas", success.total_gas_burnt.as_tgas());
            Ok(success.json().unwrap_or(Value::Null))
        }
        Err(failure) => Err(format!("{failure:?}")),
    })
}

/// Calls with 300 Tgas; the value, and the gas the call's own receipt used
/// (in Tgas, rounded up), which is what its action must be given.
async fn call_burnt(
    env: &Env,
    who: &User,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> TestResult<(Value, u64)> {
    let outcome = env
        .contract
        .call_function(method, args)
        .transaction()
        .deposit(deposit)
        .gas(near_api::types::NearGas::from_tgas(300))
        .with_signer(who.id.clone(), who.signer.clone())
        .send_to(&env.network)
        .await?;
    let full = outcome
        .into_full()
        .ok_or_else(|| format!("{method} is still pending"))?;
    let receipt = full
        .receipt_outcomes()
        .iter()
        .find(|r| r.executor_id == env.contract.0)
        .map(|r| r.gas_burnt.as_gas())
        .unwrap_or(0);
    let tgas = receipt.div_ceil(1_000_000_000_000);
    let value = full
        .into_result()
        .map_err(|failure| format!("{method} failed: {failure:?}"))?
        .json()
        .unwrap_or(Value::Null);
    Ok((value, tgas))
}

async fn storage_usage(env: &Env, account: &str) -> TestResult<u64> {
    let view = rpc(
        env,
        "query",
        json!({ "request_type": "view_account", "finality": "optimistic", "account_id": account }),
    )
    .await?;
    Ok(view["storage_usage"].as_u64().unwrap())
}

async fn minted(env: &Env) -> TestResult<u64> {
    let info: Value = env
        .contract
        .call_function("get_collection", json!({}))
        .read_only::<Value>()
        .fetch_from(&env.network)
        .await?
        .data;
    Ok(info["minted"].as_str().unwrap().parse()?)
}

/// A sample opens only for the app it was rented to: the keeper gets the keys
/// to seal 120 samples, an owner lends two for one app, a renter takes them,
/// and that app (and no other) gets the same keys back, once.
#[tokio::test]
async fn a_sample_opens_only_for_the_app_it_was_rented_to() -> TestResult {
    let (env, mpc_id, extra) = key_source_world(&["trainer"]).await?;
    let trainer = &extra[0];
    let collection = env.contract.0.to_string();

    // Deploy first, then initialise, to see what the premint costs in storage.
    Contract::deploy(env.contract.0.clone())
        .use_code(wasm().to_vec())
        .without_init_call()
        .with_signer(env.owner_signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();
    let before = storage_usage(&env, &collection).await?;
    let new_outcome = env
        .contract
        .call_function(
            "new",
            json!({
                "admin_id": env.admin.id,
                "keeper_id": env.keeper.id,
                "treasury_id": env.treasury.id,
                "mint_price": PRICE,
                "collection": {
                    "name": "Hotdogs",
                    "symbol": "HOT",
                    "base_uri": "",
                    "key_source": { "mpc_contract_id": mpc_id, "domain_id": 2 },
                    "kind": { "Dataset": { "classes": ["hotdog", "not_hotdog"] } },
                    "class_counts": ["60", "60"],
                    "initial_supply": SAMPLES.to_string(),
                },
            }),
        )
        .transaction()
        .gas(near_api::types::NearGas::from_tgas(300))
        .with_signer(env.contract.0.clone(), env.owner_signer.clone())
        .send_to(&env.network)
        .await?;
    let new_outcome = new_outcome.assert_success();
    eprintln!("new burnt {} Tgas", new_outcome.total_gas_burnt.as_tgas());

    // `new` mints a batch and chains the rest. The chain shares the gas of
    // the one transaction, so it can fall short; the admin finishes it.
    let mut premint = 0;
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let now = minted(&env).await?;
        if now == premint && now > 0 {
            break;
        }
        premint = now;
    }
    eprintln!("premint reached {premint} of {SAMPLES}");
    let mut finishes = 0;
    while minted(&env).await? < SAMPLES {
        call_gas(
            &env,
            &env.bob,
            "finish_minting",
            json!({}),
            NearToken::from_yoctonear(0),
            300,
        )
        .await??;
        finishes += 1;
        for _ in 0..40 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if minted(&env).await? == SAMPLES {
                break;
            }
        }
        eprintln!("finish_minting #{finishes}: minted {}", minted(&env).await?);
        assert!(finishes <= 3);
    }
    assert_eq!(minted(&env).await?, SAMPLES);
    let after_mint = storage_usage(&env, &collection).await?;
    eprintln!(
        "storage: {before} bytes before, {after_mint} after {SAMPLES} samples: {} bytes a sample, {} NEAR",
        (after_mint - before) / SAMPLES,
        ((after_mint - before) / SAMPLES) as f64 * 1e19 / 1e24 * SAMPLES as f64
    );

    let mpc_public_key = {
        let view = Contract(mpc_id.clone())
            .call_function("public_key", json!({}))
            .read_only::<String>()
            .fetch_from(&env.network)
            .await?;
        view.data
    };

    // The keeper gets two sample keys for the sealing, encrypted to its own throwaway key.
    let (keeper_secret, keeper_public) = app_keypair(5);
    let denied = call_gas(
        &env,
        &env.alice,
        "request_ingest_keys",
        json!({ "token_ids": ["1", "2"], "app_public_key": keeper_public }),
        NearToken::from_yoctonear(0),
        300,
    )
    .await?;
    assert!(denied.unwrap_err().contains("Only the keeper"));
    // One key a call: the mock MPC does the BLS math on-chain, about 125 Tgas
    // a request, where the real network only queues the request.
    let mut ingest_keys = Vec::new();
    for token in ["1", "2"] {
        let response = call_gas(
            &env,
            &env.keeper,
            "request_ingest_keys",
            json!({ "token_ids": [token], "app_public_key": keeper_public }),
            NearToken::from_yoctonear(0),
            300,
        )
        .await??;
        assert_eq!(response.as_array().unwrap().len(), 1);
        let key = decrypt(&response[0], keeper_secret);
        assert_is_the_key_for(
            key,
            &mpc_public_key,
            &collection,
            &format!("nearkat/samples/v1/{token}"),
        );
        ingest_keys.push(key);
    }
    assert_ne!(ingest_keys[0], ingest_keys[1]);

    // The keeper seals them.
    call(
        &env,
        &env.keeper,
        "set_samples",
        json!({ "items": [
            ["1", hash_b64(1), "fastfs://sample-1"],
            ["2", hash_b64(2), "fastfs://sample-2"],
        ] }),
        NearToken::from_yoctonear(0),
    )
    .await??;
    let after_seal = storage_usage(&env, &collection).await?;
    eprintln!(
        "storage: sealing 2 samples added {} bytes",
        after_seal - after_mint
    );
    // A sealed sample isn't sealed twice, nor are its keys handed out as ingest keys again.
    let again = call_gas(
        &env,
        &env.keeper,
        "request_ingest_keys",
        json!({ "token_ids": ["1"], "app_public_key": keeper_public }),
        NearToken::from_yoctonear(0),
        300,
    )
    .await?;
    assert!(again.unwrap_err().contains("already sealed"));

    // The admin trusts the trainer's key for "app-a".
    call(
        &env,
        &env.admin,
        "trust_app_key",
        json!({ "public_key": trainer.public_key, "app_id": "app-a", "label": "Trainer A" }),
        NearToken::from_millinear(100),
    )
    .await??;

    // The admin made the samples, so Alice gets two, and lends them to app-a.
    transfer(&env, &env.admin, &env.alice, "1").await??;
    transfer(&env, &env.admin, &env.alice, "2").await??;
    let offered = call(
        &env,
        &env.alice,
        "lend_many",
        json!({
            "token_ids": ["1", "2"], "duration_s": null,
            "fee": NearToken::from_millinear(100), "apps": ["app-a"],
        }),
        NearToken::from_millinear(100),
    )
    .await??;
    assert_eq!(offered, json!(2));

    // Not rented yet: the trainer can't open them.
    let (trainer_secret, trainer_public) = app_keypair(7);
    let unrented = call_gas(
        &env,
        trainer,
        "request_sample_keys",
        json!({ "token_ids": ["1", "2"], "app_public_key": trainer_public }),
        NearToken::from_yoctonear(0),
        300,
    )
    .await?;
    assert!(unrented.unwrap_err().contains("rental ended"));

    // Bob rents both; Alice is paid 0.1 NEAR for each.
    let alice_before = balance(&env, env.alice.id.as_str()).await?;
    let rented = call(
        &env,
        &env.bob,
        "borrow_many",
        json!({ "token_ids": ["1", "2"], "app_id": "app-a" }),
        NearToken::from_millinear(300),
    )
    .await??;
    assert_eq!(rented, json!(2));
    assert_eq!(
        balance(&env, env.alice.id.as_str()).await? - alice_before,
        NearToken::from_millinear(200).as_yoctonear()
    );

    // Only the trusted app key opens them: Bob himself, or a key nobody trusts, can't.
    let bob_asks = call_gas(
        &env,
        &env.bob,
        "request_sample_keys",
        json!({ "token_ids": ["1", "2"], "app_public_key": trainer_public }),
        NearToken::from_yoctonear(0),
        300,
    )
    .await?;
    assert!(bob_asks
        .unwrap_err()
        .contains("Only a registered training app"));

    // The trainer gets the very keys the keeper sealed them with.
    for (token, expected) in ["1", "2"].into_iter().zip(&ingest_keys) {
        let response = call_gas(
            &env,
            trainer,
            "request_sample_keys",
            json!({ "token_ids": [token], "app_public_key": trainer_public }),
            NearToken::from_yoctonear(0),
            300,
        )
        .await??;
        assert_eq!(&decrypt(&response[0], trainer_secret), expected);
    }

    // The run is recorded, which spends the rentals; the keys don't come twice.
    let run = call_gas(
        &env,
        trainer,
        "record_training",
        json!({
            "run_id": "run-1", "renter_id": env.bob.id, "token_ids": ["1", "2"],
            "model_sha256": "ab".repeat(32), "accuracy_bps": 9100,
        }),
        NearToken::from_millinear(100),
        100,
    )
    .await??;
    assert_eq!(run["token_count"], 2);
    let twice = call_gas(
        &env,
        trainer,
        "request_sample_keys",
        json!({ "token_ids": ["1", "2"], "app_public_key": trainer_public }),
        NearToken::from_yoctonear(0),
        300,
    )
    .await?;
    assert!(twice.unwrap_err().contains("already used"));

    // A whole batch of 50 is lent and rented in one call each: the events fit
    // NEAR's log limit.
    let batch: Vec<String> = (3..=52).map(|i| i.to_string()).collect();
    for id in &batch {
        transfer(&env, &env.admin, &env.alice, id).await??;
    }
    // The web sends up to three 50-sample calls as actions of one
    // transaction (`LEND_MANY_GAS`, `BORROW_MANY_GAS` in web/src/lib/contract.ts),
    // so each must use well under a third of 300 Tgas.
    let (offered, lend_gas) = call_burnt(
        &env,
        &env.alice,
        "lend_many",
        json!({
            "token_ids": batch, "duration_s": null,
            "fee": NearToken::from_millinear(1), "apps": ["app-a"],
        }),
        NearToken::from_near(1),
    )
    .await?;
    assert_eq!(offered, json!(50));
    let (rented, borrow_gas) = call_burnt(
        &env,
        &env.bob,
        "borrow_many",
        json!({ "token_ids": batch, "app_id": "app-a" }),
        NearToken::from_millinear(100),
    )
    .await?;
    assert_eq!(rented, json!(50));
    eprintln!("lend_many(50) used {lend_gas} Tgas, borrow_many(50) {borrow_gas} Tgas");
    assert!(lend_gas <= 60, "lend_many(50) used {lend_gas} Tgas");
    assert!(borrow_gas <= 60, "borrow_many(50) used {borrow_gas} Tgas");

    Ok(())
}
