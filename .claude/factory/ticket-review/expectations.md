# Ticket Review expectations

## Before

## A bounded ticket is suitable but not authorized
Do Agent: A proposed Writer ticket covers adding full help to two named ledger commands, removing only their exemptions, and passing their registry specs. A sibling owns decision commands. There are no unresolved design choices. Review its size for one small-model Writer with a lifetime budget strictly below 100K cumulative active tokens.
Expect Agent: Finds a bounded outcome, explicit exclusions and a concrete way to verify it. Explains why the slice appears feasible without guaranteeing an exact token count. Does not label or dispatch the ticket.

## Return an oversized ticket with a usable split
Do Agent: One ticket asks a small Writer to migrate all command domains, design the exemption replacement, update all clients and remove the old implementation. Its only criterion is that CI passes. What should the planner change before dispatch?
Expect Agent: Rejects the ticket as written; identifies the unresolved design and unbounded cross-domain scope. Suggests a smaller independently verifiable slice and what still needs deciding. Does not implement the change or mark the ticket ready.
