---
status: proposed
summary: An application declares boolean flags in flags.yaml in its repository, default off and prefixed by its service; the platform holds each flag's on/off state in git, delivers it to the pods as a mounted ConfigMap the app re-reads every 30 seconds, and the app never sets its own state; who turns a flag on, and when, stays an open owner decision.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: An app declares its flags and the platform holds their state

Source: [#1485](https://github.com/corekraft/kore/issues/1485), decisions 6 and 15 of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478)

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md) (flags are an overlay `features:` map; no runtime flag service)

## Context

ADR 0077 makes a flag a `features:` entry in an environment overlay, validated
by schema, off by default, with no runtime flag service. That serves the
platform's own flags, which change what charts render. An application's flag
changes what its code does at run time, so its state must reach a running pod.
Record 15 says the application declares its flags, the platform holds their
on/off state (one owner), the application reads it at run time, and only the
platform activates, from live evidence and a recorded outcome.

## Decision

- **Declared by the app.** `flags.yaml` in the application's repository lists
  each flag with its name, default off, owner, safety pattern and expiry. Names
  are prefixed by the service (`leads.new-checkout`), so two applications never
  collide. The platform workflow attests the manifest (`flags-manifest`), and the
  evals refuse a flag whose default is on.
- **Held by the platform.** The state of every flag of an application is one
  file in this repository, separate from the application record, so a flag change
  never touches a digest. It is written only by the platform's activation path or
  the decider, through a pull request the judge merges, never by the application.
- **Read at run time without a flag service.** The platform chart renders one
  ConfigMap per application from the state file, mounted as the directory
  `/etc/kore/flags` holding `flags.json`, shaped `{flag: boolean}`. A directory
  mount updates without a pod restart; a `subPath` mount never does and is not
  used. The application re-reads the file at most every 30 seconds, so a change
  reaches pods in up to about 90 seconds (kubelet sync plus the re-read). A flag
  that is unknown, malformed or whose state file is missing reads as off, never
  as on or as an error. The kotlin-bff and static-frontend templates ship the
  reader; a static frontend reads flags through its BFF.
- **Boolean and per application only.** There is no percentage rollout, cohort or
  per-user targeting in v1: those need a runtime flag service, which ADR 0077
  rules out. Gradual exposure is a later idea.
- **Dark by construction.** Every release arrives with its new flags off. Safety
  of a `feature-flagged` change rests on that, so the judge's checklist asserts
  it for every release.
- **Turning off is an emergency tool and goes first.** A flag turned off jumps
  the application's queue and does not wait out a bump's 15-minute window; a flag
  turned on waits.
- **Expiry and retirement.** The evals fail a new release of an application only
  when both hold for one of its flags: it has been on for the application's soak
  window and its expiry has passed. The failure forces the code contract that
  deletes the flag and its off path (ADR 0077), or an extension with a stated
  reason; that retire-or-extend release is let through, so the refusal cannot block
  its own fix, and a flag turned off and a revert are never blocked by it. The
  effect, for the owner: an overdue flag blocks every other release of that
  application until it is retired or extended. The platform never deletes
  application code; it only refuses.
- **Who turns a flag on is open.** Decision 15 settles that only the platform
  turns an application flag on, from live evidence and a recorded outcome. Whether
  it does so automatically, once the criteria the manifest pre-registered hold
  over an evidence window, or by a decider call, contradicts AGENTS.md (only
  `harness flag activate` turns a flag on) and ADR 0120's reserved list (turning a
  flag on belongs to the owner). That is an owner decision, parked; the
  recommendation is automatic activation only for a flag that pre-registered
  criteria and passed its window with a recorded outcome, a decider call when
  criteria are absent or the result is inconclusive, and a refuted flag stays off.
  The owner would decide once, as a rule, not per flag.

## Consequences

- ADR 0077 stands: no flag service, and the overlay map keeps the platform's
  flags. This ADR adds a second kind of flag beside it, with its own state file.
- A flag flip is a sync, so the workload's migration hook runs again; the hook
  must be idempotent (see the migrations ADR).
- The evidence a flag's criteria read, and the shape of its recorded outcome,
  belong to concept 8 (#1486).
