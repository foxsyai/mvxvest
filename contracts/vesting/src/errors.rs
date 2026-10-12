//! Every error the contract can return, in one place so the tests and the
//! dApp can match them exactly.

// Creating
pub const ERR_CREATION_PAUSED: &str = "creation is paused";
pub const ERR_CLAIM_KEY_NOT_ISSUED: &str = "claim key collection not issued";
pub const ERR_CANCEL_KEY_NOT_ISSUED: &str = "cancel key collection not issued";
pub const ERR_NO_PAYMENT: &str = "no payment";
pub const ERR_NOT_FUNGIBLE: &str = "only fungible tokens can be vested";
pub const ERR_ONE_TOKEN: &str = "only one token per transaction";
pub const ERR_WRONG_FEE: &str = "EGLD sent must equal the fee";
pub const ERR_WRONG_DEPOSIT: &str = "payment must equal the vested total plus the fee";
pub const ERR_BAD_BENEFICIARY: &str = "beneficiary cannot be the zero address or this contract";
pub const ERR_LABEL_TOO_LONG: &str = "label too long";
pub const ERR_BATCH_SIZE: &str = "batch size out of range";
pub const ERR_TOO_FAR: &str = "schedule ends too far in the future";

// Schedule
pub const ERR_ZERO_TOTAL: &str = "total must be more than zero";
pub const ERR_TIME_ORDER: &str = "times must be start <= cliff <= end";
pub const ERR_CLIFF_ABOVE_TOTAL: &str = "cliff amount above total";
pub const ERR_ZERO_INTERVAL: &str = "interval must be more than zero";
pub const ERR_INTERVAL_TOO_LONG: &str = "interval longer than the schedule";
pub const ERR_TRANCHE_COUNT: &str = "tranche count out of range";
pub const ERR_ZERO_TRANCHE: &str = "tranche amount must be more than zero";
pub const ERR_TRANCHE_BEFORE_START: &str = "tranche before start";
pub const ERR_TRANCHE_ORDER: &str = "tranche times must strictly increase";
pub const ERR_LAST_TRANCHE_NOT_END: &str = "last tranche must be at the end";
pub const ERR_TRANCHE_SUM: &str = "tranches plus cliff amount must equal the total";

// Claiming and cancelling
pub const ERR_NOT_CLAIM_KEY: &str = "only claim keys can be sent";
pub const ERR_NOT_CANCEL_KEY: &str = "only cancel keys can be sent";
pub const ERR_UNKNOWN_KEY: &str = "unknown key";
pub const ERR_NOTHING_TO_CLAIM: &str = "nothing to claim yet";
pub const ERR_ALREADY_CANCELLED: &str = "already cancelled";

// Deploying
pub const ERR_PAYABLE_DEPLOY: &str =
    "deploy the contract neither payable nor payable by smart contracts";

// Owner and recovery
pub const ERR_FEE_ABOVE_CAP: &str = "fee above the cap";
pub const ERR_NO_FEES: &str = "no fees to claim";
pub const ERR_NO_SURPLUS: &str = "no surplus";
pub const ERR_NO_HELD_KEY: &str = "no key of this vesting is held by the contract";
pub const ERR_NOT_ALLOWED: &str = "not allowed";
pub const ERR_BAD_RECIPIENT: &str = "recipient cannot be the zero address or this contract";

// Views
pub const ERR_UNKNOWN_VESTING: &str = "unknown vesting";
pub const ERR_PAGE_TOO_LARGE: &str = "page too large";
