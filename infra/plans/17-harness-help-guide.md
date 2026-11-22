---
status: done
summary: Give every harness command a layered --help guide (root, domain, command), enforced by specs, and shrink summaries and hints to point at it. Split from plan 16, which no longer depends on it.
last-verified: 2026-11-22
---

# Harness Help Guide Plan

## Purpose

The harness has about 77 commands, and a person or an agent learns them from
paragraph-long summaries, skills and session-start hints that restate usage.
This plan makes every command explain itself in three layers. It was Step 3
of [plan 16](16-hc-native-sessions.md) and is independent of the Terminals
port: it touches `Command`, `cli.ts` and kb-check, not `terminal/`, `session/`
or `ledger/`.

## Steps

### Step 1: Help guide

- [x] Extend `Command` (`runtime/command.ts`) with a `help` record:
      `purpose`, `when`, a description for every declared flag and operand,
      `examples` (each a command and what it shows), `exits`, `effects`
      (`read-only` or `mutates`, and what), and `seeAlso`. Each domain gets
      a short guide too: its purpose and its usual flow.
- [x] `cli.ts` renders three levels, always to stdout, exit 0, with no root,
      no ledger write and no side effect:
  - `harness --help`: what the harness is, the domains in one line each, the
    common flows (spawn → wait → close; pr open → checks; flag audit →
    activate), and how to go deeper.
  - `harness <domain> --help`: the domain guide and its commands.
  - `harness <domain> <command> --help`: usage, purpose, flags, examples, exit
    codes, effects and related commands.

  `--help --json` gives the same content as one object for agents. A usage
  error prints the closest level's guide, not all the commands.

- [x] Specs fail a command with no help, with a declared flag that has no
      description, or with no example. Flags therefore cannot drift from their
      help.
- [x] Shrink each `summary` to one line, moving today's paragraph-long
      summaries into `help`. Point skills, session-start hints and
      `hook/context.ts` at `harness <domain> --help` instead of restating
      usage. kb-check fails a doc that names a command or flag that does not
      exist.

## Next

**Done (2026-11-22).** The help record is required on every command, each domain has its guide, the three levels render as text and JSON, the registry specs and kb-check read the real command table, and the exemption list is gone. #1807 verified the guide on the merged bundle and recorded it on #1789, which the owner closes.

## Done When

`harness --help`, `harness <domain> --help` and `harness <domain> <command>
--help` guide a person or an agent from where they ran it, and every flag is
documented.
