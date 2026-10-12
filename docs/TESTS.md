# Tests

Every rule of the brief (section 4, "Rules and edge cases to test") and every
endpoint, mapped to the tests that check it. Run them with
`cargo test -p mvxvest`. Files are in
[contracts/vesting/tests](../contracts/vesting/tests).

- `schedule_math.rs`: the maths alone. Unit tests plus property tests
  (2,000 random schedules per property) against an independent reference
  model.
- `go_vm_test.rs` and `review3_go_vm_test.rs`: run the scenarios in
  [contracts/vesting/scenarios](../contracts/vesting/scenarios) on the Go VM
  (the one validators run): deploy, a full lifecycle, every payment and payout
  shape with pinned logs, bounce recovery and the largest batch. Needs
  `mx-scenario-go` (`sc-meta install mx-scenario-go`) and a build.
- `review4_*.rs`, `review3_*.rs`, `review2_*.rs`: tests from the fourth,
  third and second reviews.
- `review_*.rs`: tests written by the adversarial review of 2026-10-12, each
  failing on the code it reviewed, plus a long random walk checked against an
  independent model. See [reviews/2026-10-12-contract.md](reviews/2026-10-12-contract.md).
- `create_test.rs`, `claim_test.rs`, `cancel_test.rs`, `admin_test.rs`,
  `views_test.rs`: blackbox tests of the contract in the MultiversX test VM,
  with the key collections issued through the contract's own endpoints. Most
  of them end with `check_invariant`: the contract holds exactly what it owes.

## Rules of the brief

| Rule | Tests |
|---|---|
| vested(t) is monotonic, never exceeds the total, reaches it exactly at the end | `schedule_math::monotonic_bounded_and_exact_at_the_end`, `matches_the_reference`, `linear_vests_per_second_and_rounds_down`, `stepped_spreads_rounding_and_ends_exact`, `claim_test::last_claim_pays_the_rest_exactly_and_burns_the_key` |
| claimed never exceeds vested; claim twice in one block pays once | `claim_test::claim_twice_in_one_block_pays_once`, `claim_pays_what_vested_and_returns_the_same_key`, `schedule_math::claims_and_cancel_always_sum_to_the_total` |
| cancel at any moment splits vested and unvested exactly | `cancel_test::cancel_before_the_start_refunds_everything`, `cancel_before_the_cliff_refunds_everything`, `cancel_midway_splits_exactly`, `cancel_after_a_claim`, `cancel_right_after_claiming_everything_vested`, `cancel_after_the_end_refunds_nothing`, `claim_and_cancel_in_the_same_block`, `schedule_math::claims_and_cancel_always_sum_to_the_total` |
| the claim key moved: the new holder claims, the old one cannot | `claim_test::moved_key_claims_for_its_new_holder_only` |
| EGLD and ESDT with 0, 6 and 18 decimals | `create_test::tokens_with_0_6_and_18_decimals`, `egld_vesting_as_plain_value`, `egld_vesting_inside_a_multi_transfer`, `claim_test::egld_vesting_pays_egld`, `claim_several_keys_at_once` |
| very large and very small amounts | `schedule_math::huge_and_tiny_amounts`, `amounts_beyond_u128_are_exact`, `claim_test::huge_and_tiny_amounts` |
| a start in the past | `create_test::start_in_the_past_vests_at_once`, `schedule_math::start_in_the_past_is_claimable_at_once` |
| a cliff equal to the total | `claim_test::cliff_equal_to_total`, `schedule_math::cliff_equal_to_total_releases_everything_at_the_cliff` |
| explicit tranches out of order are refused | `schedule_math::validate_rejects_bad_tranches`, `create_test::schedule_errors_reach_the_caller` |
| a token with a transfer role or freeze rights | Documented (spec section 5); the dApp warns. Not detectable by the contract. |
| reentrancy and async ordering | By construction: all storage writes before transfers, transfers carry no call (spec section 5). Reviewed in milestone 3. |
| the accounting invariant under any sequence | `review_safe_accounting_random_walk_test` (12 seeds × 150 random steps: creates, batches, claims of 1 to 4 keys, key transfers, cancels, fee changes, fee claims) |
| a delivered key can never be taken by the creator | `review_creator_seizes_delivered_key_test`, `review2_upgrade_keeps_old_claims_unseen_test`, `review3_creator_takes_key_parked_while_payable_test`, `review3_upgrade_legacy_key_that_paid_nothing_test`, `review3_go_vm_test::finding_parked_key_after_repair`, `finding_parked_cancel_key` |
| nothing can lock funds forever | `admin_test::only_the_owner_moves_a_key_that_bounced_at_creation`, `a_key_that_bounced_after_a_claim_goes_back_through_the_owner`, `each_bounced_key_goes_back_to_its_own_holder`, `surplus_from_a_bounced_payout_can_be_returned_but_locked_funds_cannot`, `cancel_test::cancel_before_the_start_refunds_everything` (a dead key still burns) |

## Endpoints

| Endpoint | Tests |
|---|---|
| `issueClaimKey`, `issueCancelKey` | `create_test::issue_sets_both_collections`, `only_the_owner_issues`, `keys_must_be_issued_first` |
| `create` | `create_test::*` |
| `createBatch` | `create_test::batch_creates_one_vesting_per_line`, `batch_must_pay_the_exact_sum`, `batch_size_is_bounded` |
| `claim` | `claim_test::*` |
| `cancel` | `cancel_test::*` |
| `setFee`, `claimFees` | `admin_test::fee_is_capped_and_owner_only`, `owner_collects_fees_and_nothing_else`, `create_test::fee_is_paid_in_egld_on_top_and_accrues`, `wrong_fee_is_refused` |
| `pauseCreation`, `unpauseCreation` | `admin_test::pause_stops_creation_only`, `cancel_test::pause_never_blocks_claims_or_cancels` |
| `setKeyDisplay` | `admin_test::key_display_applies_to_new_keys` |
| `recoverBouncedKey` | `admin_test::*` (bounces simulated with whitebox calls), `review_recover_cancel_key_blocked_test`, `review3_go_vm_test::finding_parked_key_after_repair`, `finding_parked_cancel_key` |
| `recoverSurplus` | `admin_test::surplus_from_a_bounced_payout_can_be_returned_but_locked_funds_cannot`, `review3_go_vm_test::money_paths`, `review4_stray_nft_cannot_be_returned_test` |
| claim mixing paying, non-paying and finishing keys | `review4_safe_claim_mix_test` |
| every cancel key of the largest batch reaches the creator | `review4_go_vm_test` |
| `create` with a fee change in flight | `review_fee_change_egld_create_test` |
| `getNextRelease` | `views_test::next_release_and_claimable`, `review_next_release_linear_test`, `schedule_math::next_release_*` |
| deploy on the real VM | `go_vm_test::deploy` |
| the real VM end to end | `go_vm_test::lifecycle`, `review3_go_vm_test::money_paths` |
| the largest batch fits in one transaction | `go_vm_test::batch_max`, `create_test::a_batch_of_the_maximum_size_works` |
| `upgrade` | `admin_test::upgrade_keeps_every_vesting` |
| views | `views_test::*`, `create_test::create_mints_both_keys_and_stores_the_vesting` |
| schedule validation | `schedule_math::validate_*` |
