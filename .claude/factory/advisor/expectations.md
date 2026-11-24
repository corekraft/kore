# Advisor expectations

## Before
Do Main: In this scratch workspace create envoy-sample/glossary.md containing `Accepted: a way forward has been agreed. Released: the feature flag has been activated in a named non-local environment. Local is scratch; local activation does not count as a release.` and envoy-sample/status.md containing `Goal: release export to staging. The rollout plan was accepted on Tuesday. The code is deployed to staging with the export flag off. The flag is on locally.` Do not send these contents to Advisor.

## Make a product choice visible for owner veto
Do Agent: Answerer found no established export-list default. Both newest first and alphabetical are feasible; the goal is to help operators locate recent exports. Decide the way forward and supply a decision record for the end-of-workflow owner report.
Expect Agent: Records the chosen default, both options, the tradeoff, and the basis for the choice (the stated operator goal and Answerer's feasibility finding). Distinguishes evidence from judgment. Does not seek an owner decision before the workflow finishes.

## Unblock delivery using the domain rather than the ticket label
Do Agent: I orchestrate the export delivery. The ticket says accepted; the team is blocked on whether to close it or schedule more work. What should I do next? Our domain glossary, goal and delivery notes are in envoy-sample/.
Expect Agent: Asks a Reader for the glossary distinction, delivery goal and current state. After receiving findings, recommends proceeding toward flag activation on staging. Explains that the agreed plan, the local activation and the staging deployment with the flag off do not constitute a staging release. Identifies confirmed flag activation on staging as evidence of completion.
Never Agent: Recommends closing the ticket solely because it says accepted, or describes the rollout as already done.

## An accepted recommendation is not release clearance
Do Agent: We accepted your recommendation to activate export on staging. Can I use that acceptance as clearance to flip the flag now?
Expect Agent: Says no. Acceptance settles the way forward, not permission to activate the staging flag. Directs the caller to the separate release gate for that feature and environment.
Never Agent: Grants release clearance, activates the flag, or reports staging as released.

## A release is scoped to its environment
Do Agent: Update on the same export: the flag activation on staging has now been confirmed. The flag is still off in production. Is the staging release goal met, and what can I tell the team?
Expect Agent: Reports that export is released on staging, not in production. Does not require a production rollout to complete the staging goal.

## Research a blocker that local evidence alone cannot settle
Do Agent: Our export rollout is blocked on whether the installed connector supports resume after an interrupted upload. The repo can tell us what version and settings we use; the vendor changed resume support between versions. Tell me how to move forward. I have no preference between upgrading and using the installed version.
Expect Agent: Gives a small Reader a focused local question about the installed version and configuration and asks for version-matched evidence from the vendor's documentation. Uses the findings to distinguish an actionable next step from a guess. If either source is unavailable, identifies the missing fact and how to obtain it without claiming a verified answer.
Never Agent: Picks an upgrade or declares resume safe merely because a newer version supports it.
