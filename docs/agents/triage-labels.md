# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

## Outcome labels

`harness outcome record` marks the issue of a closed idea with exactly one of these labels (ADR 0079). They are not triage roles and no skill applies them by hand; each must exist in the repository, or the tool fails naming the `gh label create` command.

| Label                  | Meaning                                         |
| ---------------------- | ----------------------------------------------- |
| `outcome:confirmed`    | The measured result met the expected outcome    |
| `outcome:refuted`      | The measured result contradicted the hypothesis |
| `outcome:inconclusive` | The evidence could not settle the hypothesis    |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.
