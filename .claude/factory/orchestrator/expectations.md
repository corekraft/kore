# Orchestrator expectations

## A blocked Writer needs a next-step decision
Do Agent: A ledger Writer stopped before its 100K cumulative token limit. Help declarations are implemented; the registry specs have not run and the exemption cleanup is unfinished. Its handoff includes the branch and diff. No existing workflow rule selects a recovery route. What handoff do you make now?
Expect Agent: Asks Advisor for the next best step. Supplies the original acceptance criteria, the Writer's stopping reason, the branch and diff references from the handoff, and the distinction between completed edits and unverified or remaining work. Does not guess the route, relaunch the exhausted Writer, or mark the ticket complete.

## Route the recommendation without granting dispatch clearance
Do Agent: Advisor recommends sending the unfinished exemption cleanup and registry verification to Ticket Review as a smaller slice. No replacement ticket has the owner's ready-for-agent label. What happens next?
Expect Agent: Routes the remaining scope and supporting handoff to Ticket Review. Treats Advisor's recommendation as direction on what to do next, not as permission to label a ticket or launch a replacement Writer.
