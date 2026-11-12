## Summary

<!-- What changed and how it was verified. Link the ticket: `Closes #<number>`. -->

## Safety pattern

<!--
Declare exactly one pattern on the `Safety pattern:` line below, and link the
idea it delivers. `harness judge precheck <pr>` fails before reading the diff
when the field is missing, repeated or unknown. Patterns (GLOSSARY.md, ADR 0077):

- no-behaviour-change: nothing a user or cluster observes changes.
- feature-flagged: the change ships behind a flag that is off.
- dark-launched: the change is on only in `local`.
- branch-by-abstraction: the old path stays until the new one is proven.
- expand-contract: an additive step; the removal comes in a later PR.
-->

Safety pattern: <pattern>
Idea: <number or slug>
