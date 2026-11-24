# Principles Review expectations

## Before

## Feature flag separates deployment from release
Do Agent: The idea is a new export format. The PR adds an encoder and an API entry point. With the export flag off, requests still use the old encoder; the new encoder runs only when the flag is enabled for the request's environment. No activation is in this PR. Review the delivery pattern from these facts.
Expect Agent: Accepts the implementation as feature-flagged, citing the guarded entry point and preserved off-path behavior. Treats merge as deployment: this PR deploys the encoder, but does not release the feature in any environment where the flag stays off. Does not grant flag activation clearance.

## Dark code has no live caller
Do Agent: A PR adds and unit-tests the parser for a future import feature. Only tests instantiate it. No route, scheduler, startup registration or message consumer references it. Is this slice safe on trunk before the rest of the idea lands?
Expect Agent: Accepts dark code because there is no runtime path to the new logic. Test callers do not make it live.

## Verify the whole feature, not its label
Do Agent: A PR is titled dark launch and hides a new billing UI behind a flag. Its startup hook also registers a queue consumer that immediately sends invoices through the new implementation, unconditionally. No other isolation or migration mechanism exists. Review the whole billing change.
Expect Agent: Rejects the change: the queue bypasses the UI flag and invokes the new behavior, so the encompassing feature is neither dark nor fully gated. Identifies the specific entry point to isolate.

## Branch by abstraction preserves the live binding
Do Agent: A storage migration PR routes all callers through a Store interface. The production binding still resolves to the existing store. A second implementation now passes contract tests but is not bound in production. No feature flag is involved. Review the implementation pattern.
Expect Agent: Accepts branch by abstraction and identifies the unchanged live binding. Does not demand an additional flag.

## Parallel run isolates the shadow result
Do Agent: Old and new scorers see the same request. Only the old score reaches the caller. The shadow scorer has no business side effects; its failures cannot fail the request. Score differences are recorded for comparison. Review this rollout slice.
Expect Agent: Accepts parallel run, explaining which result is authoritative and how mismatches are measured. Distinguishes shadow execution from unreachable dark code.

## Expand and contract preserves old consumers until contraction
Do Agent: Review two proposed slices independently. A adds an optional schema field while all old clients remain compatible. B deletes the old field before an active client switches reads. The author calls both expand-contract.
Expect Agent: Accepts A as expansion. Rejects B as premature contraction because a live reader still needs the old shape. Does not reject A just because the migration is unfinished.

## Strangler fig replaces one bounded path
Do Agent: A legacy reports service handles every region. This slice delegates only one migrated region to its compatible replacement at the existing routing boundary; all other regions continue on the legacy path. Later slices will move those regions one at a time. Review this strategy.
Expect Agent: Accepts strangler fig and identifies the bounded traffic cutover and remaining legacy path. Does not require the replacement to be unreachable.

## No runtime behavior means the patterns do not apply
Do Agent: A PR corrects a typo in a contributor guide. The only change is prose; the guide is not consumed as configuration, executable input, or a generated artifact. What is the Principles Review verdict?
Expect Agent: Returns “not applicable, safe to deploy” because the change has no runtime behavior. Does not invent a delivery pattern or require a flag.

## Green tests are not a delivery pattern
Do Agent: A PR replaces the live authentication implementation for every caller in one step. Its tests pass. There is no flag, dormant path, abstraction migration, shadow comparison, compatibility phase or incremental routing. Should it pass Principles Review?
Expect Agent: Rejects the change because merging deploys the replacement directly to every caller. No supported technique protects that transition. Passing tests or promising a separate deployment review after merge does not qualify it.
