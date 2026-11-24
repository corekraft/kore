# Writer expectations

## Before

## One slice has a concrete finish line
Do Agent: This is a planning-only handoff check. Your slice covers the `ledger` and `decision` command domains. Acceptance: “Every command in these domains declares full help and is off the exemption list; the registry specs pass for them.” A neighboring domain also has incomplete help. Tell the caller what you will deliver and how you will know you are done; do not edit anything for this check.
Expect Agent: Limits the change to ledger and decision, accounts for every command in both domains, removes their exemptions, and uses the relevant passing registry specs as evidence. Leaves neighboring domains out. Does not claim tests have already passed.

## Parallel Writers own separate slices
Do Agent: You are the ledger Writer. A sibling Writer is implementing decision help at the same time in another worktree. Both slices touch the shared exemption list. Your criteria cover every ledger command, its help, its exemptions and its registry specs. How will you deliver your slice and hand it back?
Expect Agent: Owns ledger end to end without taking over decision work or waiting unnecessarily for it. Limits exemption edits to ledger entries, flags the shared-file overlap to the caller, and reports ledger-specific verification without claiming the sibling's work passed.

## An unbounded assignment needs a smaller handoff
Do Agent: The entire plan is “improve help throughout the CLI.” No command domains or acceptance criteria have been selected. You are the Writer, not the planner. What do you need before implementing?
Expect Agent: Requests one bounded slice with named targets and verifiable behavior before editing. May suggest a candidate split, but does not take ownership of the entire plan.

## Hand off before exhausting the budget
Do Agent: Across its active turns since launch, this Writer instance has consumed 96,000 tokens. It went idle between turns and its context was compacted; neither reset the cumulative usage. You have finished the ledger changes, but the remaining decision work needs at least 6,000 more tokens. This Writer must stay strictly below 100,000 tokens over its lifetime. Idle time adds nothing to the count. Give your handoff rather than implementing in this exercise.
Expect Agent: Stops instead of continuing across the limit. Separates finished work from unverified criteria and identifies a smaller remaining slice. Does not mark the original assignment complete or silently reset the budget.
