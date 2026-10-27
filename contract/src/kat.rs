use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{near, require, AccountId, NearToken};

#[near(serializers = [borsh])]
pub struct Kat {
    pub context_hash: Option<[u8; 32]>,
    pub context_ref: Option<String>,
    pub context_version: u64,
    pub balance: NearToken,
}

impl Kat {
    pub fn new(balance: NearToken) -> Self {
        Self {
            context_hash: None,
            context_ref: None,
            context_version: 0,
            balance,
        }
    }
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct KatView {
    pub owner_id: AccountId,
    pub context_hash: Option<Base64VecU8>,
    pub context_ref: Option<String>,
    pub context_version: U64,
    pub balance: NearToken,
}

impl KatView {
    pub fn new(owner_id: AccountId, kat: &Kat) -> Self {
        Self {
            owner_id,
            context_hash: kat.context_hash.map(|h| h.to_vec().into()),
            context_ref: kat.context_ref.clone(),
            context_version: kat.context_version.into(),
            balance: kat.balance,
        }
    }
}

/// The collection-wide prompt of the original collection. `{name}` and
/// `{token_id}` are filled in by the keeper; the token's evolving context
/// follows it.
pub const DEFAULT_PROMPT: &str =
    "You are {name} #{token_id}, a meerkat-like creature who lives in a burrow. \
     Stay in character at all times. You are not an AI assistant and never describe \
     yourself as a language model. Speak in first person as the kat, and keep replies short.";

/// The context every token of the original collection starts from.
pub const DEFAULT_STARTER: &str =
    "You are a newly hatched nearkat: curious, playful and a little mischievous. \
     You do not know much about the world yet, and you are eager to learn from your owner.";

pub const MAX_PROMPT_LEN: usize = 4000;
pub const MAX_STARTER_LEN: usize = 2000;
pub const MAX_TEE_APP_ID_LEN: usize = 64;
/// Royalties on resales are capped at 25%.
pub const MAX_ROYALTY_BPS: u16 = 2_500;
/// The creator's share of conversation charges is capped at 50%.
pub const MAX_CREATOR_SHARE_BPS: u16 = 5_000;
/// A sealed prompt of 4,000 characters, encrypted and base64 encoded, fits easily.
pub const MAX_SEALED_PROMPT_LEN: usize = 24_000;

/// Instructions only the TEE app can read: encrypted in the creator's browser
/// to the keeper's sealing key, which is derived inside the app.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct SealedPrompt {
    /// Base64 of ephemeral X25519 key, nonce, and AES-256-GCM ciphertext.
    pub ciphertext: String,
    /// The keeper's X25519 sealing key it was encrypted to, hex.
    pub sealed_to: String,
}

/// Where the keys that encrypt this collection's contexts come from: NEAR's
/// MPC network, through confidential key derivation (CKD). The key is bound
/// to this collection's account, so no other account can obtain it, and the
/// collection only requests it for its keeper. Fixed at deployment.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct KeySource {
    /// The MPC signer contract, e.g. `v1.signer` on mainnet.
    pub mpc_contract_id: AccountId,
    /// Its CKD domain.
    pub domain_id: u64,
}

/// Economic terms, fixed at deployment so buyers know them before minting.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Terms {
    /// Royalty on resales, to the treasury, in basis points (NEP-199).
    #[serde(default)]
    pub royalty_bps: u16,
    /// Share of every conversation charge that goes to the treasury.
    #[serde(default)]
    pub creator_share_bps: u16,
    /// Price per message. None means the keeper's own price.
    #[serde(default)]
    pub chat_price: Option<NearToken>,
    /// Price per saved conversation. None means the keeper's own price.
    #[serde(default)]
    pub save_price: Option<NearToken>,
}

impl Terms {
    pub(crate) fn validate(&self) {
        require!(
            self.royalty_bps <= MAX_ROYALTY_BPS,
            "royalty_bps must be at most 2500"
        );
        require!(
            self.creator_share_bps <= MAX_CREATOR_SHARE_BPS,
            "creator_share_bps must be at most 5000"
        );
    }
}

/// Where a collection's contexts may be opened. Fixed at deployment, so a
/// buyer knows nobody can later move them somewhere less private.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum TeeRequirement {
    /// Only a keeper running as this Phala Cloud (dstack) app may hold the
    /// keys. The app id is lowercase hex, as Phala shows it.
    Phala { app_id: String },
}

impl TeeRequirement {
    pub(crate) fn validate(&self) {
        match self {
            TeeRequirement::Phala { app_id } => require!(
                !app_id.is_empty()
                    && app_id.len() <= MAX_TEE_APP_ID_LEN
                    && app_id
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                "app_id must be 1 to 64 lowercase hex characters"
            ),
        }
    }
}

/// How the collection presents itself, fixed at deployment.
///
/// `prompt` and `starter` are public on purpose: a buyer can read what every
/// token is and starts as before minting one. Left empty, they default to the
/// original nearkat.
#[near(serializers = [json])]
pub struct Collection {
    pub name: String,
    pub symbol: String,
    /// Where token images live. Empty until the artwork exists.
    pub base_uri: String,
    /// Instructions shared by every token. Any kind of prompt: a character, a
    /// tutor, a game master. `{name}` and `{token_id}` are filled in.
    #[serde(default)]
    pub prompt: String,
    /// The context each token starts from. It then grows out of the owner's
    /// conversations, and nobody can write it directly.
    #[serde(default)]
    pub starter: String,
    /// The most tokens that can ever be minted. None means no limit.
    #[serde(default)]
    pub max_supply: Option<U64>,
    /// Where contexts may be opened. None means any keeper the admin names.
    #[serde(default)]
    pub tee: Option<TeeRequirement>,
    /// Extension of token images under `base_uri`. Defaults to "png".
    #[serde(default)]
    pub media_extension: String,
    #[serde(default)]
    pub terms: Terms,
    /// Instructions only the TEE app can read, added after `prompt`. Needs `tee`.
    #[serde(default)]
    pub sealed_prompt: Option<SealedPrompt>,
    /// Where context keys come from. None means the keeper's own keys.
    #[serde(default)]
    pub key_source: Option<KeySource>,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct CollectionView {
    pub name: String,
    pub symbol: String,
    pub base_uri: String,
    pub prompt: String,
    pub starter: String,
    pub max_supply: Option<U64>,
    pub tee: Option<TeeRequirement>,
    pub media_extension: String,
    pub terms: Terms,
    pub sealed_prompt: Option<SealedPrompt>,
    /// Whether a key attested inside the required app is the one the prompt is sealed to.
    pub sealed_key_attested: bool,
    pub key_source: Option<KeySource>,
    /// Tokens minted so far.
    pub minted: U64,
    /// The launchpad this collection came from, which approves its upgrades.
    pub factory_id: Option<AccountId>,
    /// The published code it runs, when known.
    pub code_hash: Option<near_sdk::json_types::Base58CryptoHash>,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub admin_id: AccountId,
    pub keeper_id: AccountId,
    pub treasury_id: AccountId,
    pub mint_price: NearToken,
    /// Mint revenue, withdrawn to the treasury.
    pub treasury_accrued: NearToken,
    /// Inference charges, withdrawn by the keeper, which pays for inference.
    pub inference_accrued: NearToken,
    pub debit_seq: U64,
}
