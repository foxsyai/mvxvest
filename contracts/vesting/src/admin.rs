//! Owner endpoints. The owner (the multisig) can issue the key collections,
//! set how new keys look, set the two fees up to hard caps, pause the
//! creation of new vestings and collect fees. It can never pause claims or cancels, and
//! never move locked funds.

use multiversx_sc::imports::*;

use crate::{
    errors::*,
    events,
    storage::{self, KeyDisplay, KeyKind},
};

/// Highest fee per vesting the owner can ever set: 1 EGLD.
pub const MAX_FEE_PER_VESTING: u64 = 1_000_000_000_000_000_000;
/// Highest token fee the owner can ever set: 2% of each vesting's total.
pub const MAX_TOKEN_FEE_BPS: u32 = 200;
/// Basis points in one whole.
pub const BPS: u32 = 10_000;

#[multiversx_sc::module]
pub trait AdminModule:
    storage::StorageModule
    + events::EventsModule
    + multiversx_sc_modules::default_issue_callbacks::DefaultIssueCallbacksModule
{
    /// Issues the claim key collection, with this contract holding its roles.
    /// Pay the issue cost in EGLD (0.05 EGLD on mainnet).
    #[only_owner]
    #[payable("EGLD")]
    #[endpoint(issueClaimKey)]
    fn issue_claim_key(&self, display_name: ManagedBuffer, ticker: ManagedBuffer) {
        let cost = self.call_value().egld().clone();
        self.claim_key().issue_and_set_all_roles(
            EsdtTokenType::NonFungible,
            cost,
            display_name,
            ticker,
            0,
            None,
        );
    }

    /// Issues the cancel key collection, like `issueClaimKey`.
    #[only_owner]
    #[payable("EGLD")]
    #[endpoint(issueCancelKey)]
    fn issue_cancel_key(&self, display_name: ManagedBuffer, ticker: ManagedBuffer) {
        let cost = self.call_value().egld().clone();
        self.cancel_key().issue_and_set_all_roles(
            EsdtTokenType::NonFungible,
            cost,
            display_name,
            ticker,
            0,
            None,
        );
    }

    /// Stops holders from burning keys of `kind` themselves. The protocol lets
    /// every holder burn tokens of a new collection by default
    /// (`ESDTRoleBurnForAll`), and a burned claim key would lock its vesting
    /// forever. Call once per collection after issuing it, with about 100M gas
    /// (the ESDT system contract charges 50M, then notifies every shard); the
    /// contract keeps its own burn role.
    #[only_owner]
    #[endpoint(disableKeyBurnByHolders)]
    fn disable_key_burn_by_holders(&self, kind: KeyKind) {
        let mapper = match kind {
            KeyKind::Claim => self.claim_key(),
            KeyKind::Cancel => self.cancel_key(),
        };
        let not_issued = match kind {
            KeyKind::Claim => ERR_CLAIM_KEY_NOT_ISSUED,
            KeyKind::Cancel => ERR_CANCEL_KEY_NOT_ISSUED,
        };
        require!(mapper.get_token_state().is_set(), not_issued);
        self.tx()
            .to(ESDTSystemSCAddress)
            .raw_call("unsetBurnRoleGlobally")
            .argument(&mapper.get_token_id())
            .async_call_and_exit();
    }

    /// Sets the media URIs and metadata of keys minted from now on. Keys
    /// already minted keep theirs.
    #[only_owner]
    #[endpoint(setKeyDisplay)]
    fn set_key_display(
        &self,
        kind: KeyKind,
        metadata: ManagedBuffer,
        uris: MultiValueEncoded<ManagedBuffer>,
    ) {
        self.key_display(kind).set(KeyDisplay {
            uris: uris.to_vec(),
            metadata,
        });
    }

    /// Sets the EGLD fee charged per vesting created, at most
    /// `MAX_FEE_PER_VESTING`. A creation must pay exactly the current fee, so
    /// a change between preview and signing makes it fail, never overcharge.
    #[only_owner]
    #[endpoint(setFee)]
    fn set_fee(&self, fee_per_vesting: BigUint) {
        require!(fee_per_vesting <= MAX_FEE_PER_VESTING, ERR_FEE_ABOVE_CAP);
        self.fee_per_vesting().set(&fee_per_vesting);
        self.fee_set_event(&fee_per_vesting);
    }

    /// Sets the token fee, in basis points of each vesting's total (100 =
    /// 1%), at most `MAX_TOKEN_FEE_BPS`. It is paid on top of the total, in
    /// the vested token, and goes to the owner at once. Like the EGLD fee, a
    /// creation must pay exactly the current one.
    #[only_owner]
    #[endpoint(setTokenFee)]
    fn set_token_fee(&self, bps: u32) {
        require!(bps <= MAX_TOKEN_FEE_BPS, ERR_TOKEN_FEE_ABOVE_CAP);
        self.token_fee_bps().set(bps);
        self.token_fee_set_event(bps);
    }

    /// Stops new vestings. Claims and cancels keep working.
    #[only_owner]
    #[endpoint(pauseCreation)]
    fn pause_creation(&self) {
        self.creation_paused().set(true);
        self.creation_paused_event(true);
    }

    #[only_owner]
    #[endpoint(unpauseCreation)]
    fn unpause_creation(&self) {
        self.creation_paused().clear();
        self.creation_paused_event(false);
    }

    /// Turns the stamping of claim keys at claim on or off (version 3); on
    /// unless the owner turned it off. It changes only what a returned key
    /// shows, never what a claim pays: it exists so that a change of the
    /// protocol's metadata update can never stop claims until an upgrade.
    #[only_owner]
    #[endpoint(setKeyStamping)]
    fn set_key_stamping(&self, on: bool) {
        if on {
            self.key_stamping_off().clear();
        } else {
            self.key_stamping_off().set(true);
        }
        self.key_stamping_set_event(on);
    }

    /// Sends the accrued EGLD fees to the owner.
    #[only_owner]
    #[endpoint(claimFees)]
    fn claim_fees(&self) {
        let fees = self.fees_accrued().take();
        require!(fees > 0u32, ERR_NO_FEES);
        let owner = self.blockchain().get_caller();
        self.fees_claimed_event(&owner, &fees);
        self.tx().to(&owner).egld(fees).transfer();
    }
}
