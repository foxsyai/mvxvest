//! mvxvest: token vesting on MultiversX.
//!
//! A creator locks EGLD or a fungible ESDT in a vesting. The beneficiary gets
//! an NFT, the claim key: whoever holds it claims what has vested. A
//! cancelable vesting also gives the creator a cancel key: sending it back
//! stops the vesting, refunds what has not vested, and leaves what has vested
//! claimable. One contract holds every vesting.
//!
//! docs/CONTRACT_SPEC.md describes the rules; the tests check each of them.

#![no_std]

use multiversx_sc::imports::*;

pub mod admin;
pub mod claim;
pub mod create;
pub mod errors;
pub mod events;
pub mod keys;
#[rustfmt::skip]
pub mod proxy;
pub mod schedule;
pub mod storage;
pub mod views;

#[multiversx_sc::contract]
pub trait Mvxvest:
    storage::StorageModule
    + events::EventsModule
    + keys::KeysModule
    + admin::AdminModule
    + create::CreateModule
    + claim::ClaimModule
    + views::ViewsModule
    + multiversx_sc_modules::default_issue_callbacks::DefaultIssueCallbacksModule
{
    // Deploy and upgrade it neither payable nor payable by smart contracts
    // (scripts/src/deploy.ts does), so stray transfers bounce. This cannot be
    // checked here: on the real chain `init` and `upgrade` run before the new
    // metadata is written.
    #[init]
    fn init(&self) {}

    #[upgrade]
    fn upgrade(&self) {}
}
