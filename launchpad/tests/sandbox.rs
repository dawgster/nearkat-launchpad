//! The launchpad against a real node: the collection contract is published
//! once as a global contract, and every launch points a new account at it.

use std::sync::{Arc, OnceLock};

use near_api::types::{AccountId, NearToken};
use near_api::{Contract, NetworkConfig, Signer, Tokens};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use near_sdk::json_types::Base58CryptoHash;
use serde_json::{json, Value};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

const FEE: NearToken = NearToken::from_near(1);
const FUNDING: NearToken = NearToken::from_near(2);

fn build(manifest: &str) -> Vec<u8> {
    let artifact = cargo_near_build::build(
        cargo_near_build::BuildOpts::builder()
            .manifest_path(manifest)
            .build(),
    )
    .expect("contract build failed");
    std::fs::read(artifact.path).expect("cannot read built wasm")
}

fn launchpad_wasm() -> &'static [u8] {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| build("Cargo.toml"))
}

fn collection_wasm() -> &'static [u8] {
    static WASM: OnceLock<Vec<u8>> = OnceLock::new();
    WASM.get_or_init(|| build("../contract/Cargo.toml"))
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
    _sandbox: Sandbox,
    network: NetworkConfig,
    launchpad: User,
    admin: User,
    keeper: User,
    alice: User,
    bob: User,
}

async fn setup() -> TestResult<Env> {
    let names = ["launch", "admin", "keeper", "alice", "bob"];
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
    let env = Env {
        _sandbox: sandbox,
        network,
        launchpad: User::new(&accounts[0])?,
        admin: User::new(&accounts[1])?,
        keeper: User::new(&accounts[2])?,
        alice: User::new(&accounts[3])?,
        bob: User::new(&accounts[4])?,
    };

    // Anyone may publish code by hash; the admin does it here.
    Contract::deploy_global_contract_code(collection_wasm().to_vec())
        .as_hash()
        .with_signer(env.admin.id.clone(), env.admin.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();

    Contract::deploy(env.launchpad.id.clone())
        .use_code(launchpad_wasm().to_vec())
        .with_init_call(
            "new",
            json!({
                "admin_id": env.admin.id,
                "keeper_id": env.keeper.id,
                "launch_fee": FEE,
                "collection_funding": FUNDING,
            }),
        )?
        .with_signer(env.launchpad.signer.clone())
        .send_to(&env.network)
        .await?
        .assert_success();

    let code_hash: Base58CryptoHash = near_sdk::env::sha256_array(collection_wasm()).into();
    call(
        &env,
        &env.launchpad.id,
        &env.admin,
        "set_collection_code_hash",
        json!({ "code_hash": code_hash }),
        NearToken::from_yoctonear(1),
    )
    .await??;
    call(
        &env,
        &env.launchpad.id,
        &env.admin,
        "set_key_source",
        json!({ "key_source": { "mpc_contract_id": "mpc.test.near", "domain_id": 2, "wallet_domain_id": 1 } }),
        NearToken::from_yoctonear(1),
    )
    .await??;
    Ok(env)
}

async fn call(
    env: &Env,
    contract: &AccountId,
    who: &User,
    method: &str,
    args: Value,
    deposit: NearToken,
) -> TestResult<Result<Value, String>> {
    let outcome = Contract(contract.clone())
        .call_function(method, args)
        .transaction()
        .deposit(deposit)
        .gas(near_api::types::NearGas::from_tgas(200))
        .with_signer(who.id.clone(), who.signer.clone())
        .send_to(&env.network)
        .await?;
    Ok(match outcome.into_result() {
        Ok(success) => Ok(success.json().unwrap_or(Value::Null)),
        Err(failure) => Err(format!("{failure:?}")),
    })
}

async fn view(env: &Env, contract: &AccountId, method: &str, args: Value) -> TestResult<Value> {
    Ok(Contract(contract.clone())
        .call_function(method, args)
        .read_only::<Value>()
        .fetch_from(&env.network)
        .await?
        .data)
}

fn launch_args(slug: &str, app_id: &str) -> Value {
    json!({ "args": {
        "slug": slug,
        "mint_price": NearToken::from_near(1),
        "collection": {
            "name": "Magister",
            "symbol": "LAT",
            "prompt": "You are {name} #{token_id}, a patient Latin tutor.",
            "starter": "Your student has not told you anything yet.",
            "max_supply": "2",
            "tee": { "Phala": { "app_id": app_id } },
        },
        "keeper_id": null,
    }})
}

#[tokio::test]
async fn a_creator_launches_a_collection_and_someone_mints_from_it() -> TestResult {
    let env = setup().await?;
    let launched = call(
        &env,
        &env.launchpad.id,
        &env.alice,
        "launch",
        launch_args("magister", "0a1b2c"),
        NearToken::from_near(3),
    )
    .await??;
    assert_eq!(launched, json!(true));

    let collection: AccountId = format!("magister.{}", env.launchpad.id).parse()?;
    let listed = view(&env, &env.launchpad.id, "get_collections", json!({})).await?;
    assert_eq!(listed[0]["account_id"], collection.as_str());
    assert_eq!(listed[0]["live"], true);

    // Every launch gets wallets from the launchpad's MPC domain.
    let info = view(&env, &collection, "get_collection", json!({})).await?;
    assert_eq!(info["wallet_domain_id"], 1);

    // The collection runs the published code with what the creator chose.
    let info = view(&env, &collection, "get_collection", json!({})).await?;
    assert_eq!(
        info["prompt"],
        "You are {name} #{token_id}, a patient Latin tutor."
    );
    assert_eq!(info["tee"]["Phala"]["app_id"], "0a1b2c");
    assert_eq!(info["max_supply"], "2");
    let config = view(&env, &collection, "get_config", json!({})).await?;
    assert_eq!(config["admin_id"], env.alice.id.as_str());
    assert_eq!(config["treasury_id"], env.alice.id.as_str());
    assert_eq!(config["keeper_id"], env.keeper.id.as_str());

    let token = call(
        &env,
        &collection,
        &env.bob,
        "mint",
        json!({}),
        NearToken::from_near(2),
    )
    .await??;
    assert_eq!(token["token_id"], "1");
    assert_eq!(token["owner_id"], env.bob.id.as_str());

    let fees = view(&env, &env.launchpad.id, "get_config", json!({})).await?;
    assert_eq!(fees["fees_accrued"], json!(FEE));
    Ok(())
}

#[tokio::test]
async fn a_failed_launch_refunds_the_creator_and_frees_the_name() -> TestResult {
    let env = setup().await?;
    let balance = || Tokens::account(env.alice.id.clone()).near_balance();
    let before = balance().fetch_from(&env.network).await?.total;

    // The collection refuses this app id, so the whole launch is undone.
    let result = call(
        &env,
        &env.launchpad.id,
        &env.alice,
        "launch",
        launch_args("magister", "NOT-HEX"),
        NearToken::from_near(3),
    )
    .await??;
    assert_eq!(result, json!(false));

    let after = balance().fetch_from(&env.network).await?.total;
    // Only gas was spent.
    assert!(before.saturating_sub(after) < NearToken::from_millinear(100));
    let listed = view(&env, &env.launchpad.id, "get_collections", json!({})).await?;
    assert_eq!(listed, json!([]));
    let fees = view(&env, &env.launchpad.id, "get_config", json!({})).await?;
    assert_eq!(fees["fees_accrued"], "0");

    // The name is free again.
    call(
        &env,
        &env.launchpad.id,
        &env.bob,
        "launch",
        launch_args("magister", "0a1b2c"),
        NearToken::from_near(3),
    )
    .await??;
    Ok(())
}

#[tokio::test]
async fn a_creator_upgrades_their_collection_only_to_an_approved_version() -> TestResult {
    let env = setup().await?;
    call(
        &env,
        &env.launchpad.id,
        &env.alice,
        "launch",
        launch_args("magister", "0a1b2c"),
        NearToken::from_near(3),
    )
    .await??;
    let collection: AccountId = format!("magister.{}", env.launchpad.id).parse()?;
    call(
        &env,
        &collection,
        &env.bob,
        "mint",
        json!({}),
        NearToken::from_near(2),
    )
    .await??;
    let code_hash: Base58CryptoHash = near_sdk::env::sha256_array(collection_wasm()).into();
    let info = view(&env, &collection, "get_collection", json!({})).await?;
    assert_eq!(info["code_hash"], json!(code_hash));
    assert_eq!(info["factory_id"], env.launchpad.id.as_str());

    // A version the launchpad never approved is refused.
    let unapproved: Base58CryptoHash = [7u8; 32].into();
    let refused = call(
        &env,
        &collection,
        &env.alice,
        "upgrade",
        json!({ "code_hash": unapproved }),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert!(
        format!("{refused:?}").contains("has not approved that version"),
        "{refused:?}"
    );

    // An approved one goes through, migrates, and keeps every token.
    call(
        &env,
        &collection,
        &env.alice,
        "upgrade",
        json!({ "code_hash": code_hash }),
        NearToken::from_yoctonear(1),
    )
    .await??;
    let kat = view(&env, &collection, "get_kat", json!({ "token_id": "1" })).await?;
    assert_eq!(kat["owner_id"], env.bob.id.as_str());
    let token = call(
        &env,
        &collection,
        &env.bob,
        "mint",
        json!({}),
        NearToken::from_near(2),
    )
    .await??;
    assert_eq!(token["token_id"], "2");
    let entry = view(
        &env,
        &env.launchpad.id,
        "get_collection",
        json!({ "account_id": collection }),
    )
    .await?;
    assert_eq!(entry["code_hash"], json!(code_hash));

    // Only the collection's admin can upgrade it.
    let stranger = call(
        &env,
        &collection,
        &env.bob,
        "upgrade",
        json!({ "code_hash": code_hash }),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert!(format!("{stranger:?}").contains("Only the admin"));
    Ok(())
}
