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
        .use_code(wasm().to_vec())
        .with_init_call(
            "new",
            json!({
                "admin_id": env.admin.id,
                "keeper_id": env.keeper.id,
                "treasury_id": env.treasury.id,
                "mint_price": PRICE,
                "base_uri": "https://art.example/",
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
            "token_id": id, "context_hash": hash_b64(7), "context_ref": "ref-1", "version": "1",
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

    assert!(result.is_err());
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
        json!({ "items": [
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
    Ok(())
}

#[tokio::test]
async fn withdraw_pays_mint_price_and_debits_to_treasury() -> TestResult {
    let env = setup().await?;
    let id = mint(&env, &env.alice, NearToken::from_near(3)).await?;
    call(
        &env,
        &env.keeper,
        "debit_batch",
        json!({ "items": [[id, NearToken::from_millinear(500)]] }),
        NearToken::from_yoctonear(0),
    )
    .await??;
    let balance_of = |user: &User| Tokens::account(user.id.clone()).near_balance();
    let before = balance_of(&env.treasury)
        .fetch_from(&env.network)
        .await?
        .total;

    call(&env, &env.admin, "withdraw_treasury", json!({}), YOCTO).await??;

    let after = balance_of(&env.treasury)
        .fetch_from(&env.network)
        .await?
        .total;
    assert_eq!(
        after.saturating_sub(before),
        NearToken::from_millinear(1500)
    );
    Ok(())
}

#[tokio::test]
async fn mint_storage_is_paid_by_the_minter() -> TestResult {
    let env = setup().await?;
    let id = mint(&env, &env.alice, NearToken::from_near(2)).await?;

    let account = Tokens::account(env.contract.0.clone())
        .near_balance()
        .fetch_from(&env.network)
        .await?;
    let kat_balance: NearToken = serde_json::from_value(kat(&env, &id).await?["balance"].clone())?;
    // The contract must hold enough to cover its storage, the kat's balance and
    // the accrued treasury at the same time.
    let owed = account
        .storage_locked
        .saturating_add(kat_balance)
        .saturating_add(PRICE);
    assert!(account.total >= owed, "{} < {}", account.total, owed);
    Ok(())
}
