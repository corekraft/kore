# hc Pin: herdr-core 0.1.21

Operational facts about the pinned `hc` binary, the terminal core that the
harness's session tools are moving to ([plan 16](../../infra/plans/16-hc-native-sessions.md),
Step 1). The herdr pin is separate and unchanged: `herdr 0.9.5` stays in
`.mise.toml` until the flip PR.

## The pin

| Pin                  | Value                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hc` version         | `0.1.21` (exact)                                                                                                                                   |
| Where it is checked  | `hc --version` prints `hc 0.1.21`. `HcTerminals` compares it once per process (plan 16, Step 2) and fails closed on a mismatch or a missing binary |
| Hosts                | Both: the Linux agents VM (kore-agents) and the developer's macOS machine                                                                          |
| Same version on both | Required. The core protocol differs between versions                                                                                               |

## Why there is no mise pin

`hc` is not in the mise registry, so `.mise.toml` cannot pin it. The mise
pin for the other tools does not apply here. The exact `hc --version` check
above is the pin, and a host-setup note (below) installs it. mise also cannot
pin the macOS app bundle, so the macOS install is checked by version only.

## How a host installs it

- **Floor:** `hc update --version 0.1.21`. This is a floor, not an exact
  pin: `hc update` downloads "the latest release" from a source it does not
  print, so a later release can satisfy the floor. Run `hc --version` after
  the update and confirm `hc 0.1.21`.
- **Exact binary:** `hc update --from <file>`, with a file that is the 0.1.21
  binary (or the signed app on macOS). Use this when the floor would install a
  newer release. Confirm with `hc --version`.
- **Mismatch:** a host that prints another version must be fixed before the
  session tools switch to hc. The check is planned to name this pin and the
  install command.

## Compatibility evidence

Recorded per the [pin-upgrade skill](../../skills/pin-upgrade/SKILL.md):

- The contract this plan depends on is the hc principles that `hc --skill`
  documents at 0.1.21. Plan 16 lists them: terminals with parents,
  `hc wait`, reported status, labels, `hc send` to a parent, and structured
  errors. Those are the 0.1.21 facts the plan relies on.
- Step 2 settled against the real core under a scratch `HC_SESSION` (`tools/harness/integration/terminal/`): a parent's exit ends its child (confirmed); a holder crash ends a live terminal as `finished` with reason `holder_lost` and no exit code (confirmed); `hc server stop` ends a live terminal with reason `server_stop`. **Not settled:** a core restart keeps the terminals (the brief barred `hc server restart`, so it was not run), a reboot, and the notes and agent status that need a real claude parent. Plan 16's Step 2 findings list each.
- The recorded replies to each method, named with `hc 0.1.21`, are `tools/harness/src/terminal/hc-0.1.21.fixtures.ts`.
- **Not done:** the upstream release notes for 0.1.21 were not read, because
  the release source is not settled (below). Compatibility rests on the
  documented 0.1.21 contract, not on release notes.
- **Row:** the hc 0.1.21 row in [`infra/catalog/compatibility.md`](../../infra/catalog/compatibility.md) records the date, the contract, and the same two gaps.

## Open

- **Where hc releases are published, and whether checksums exist.** Owed to
  the hc vendor. The pin is enforced by the exact version check, so this does
  not block Step 1. It must be settled before a release is trusted by
  checksum ([plan 16](../../infra/plans/16-hc-native-sessions.md), Open
  Questions).

## Related

- [`infra/plans/16-hc-native-sessions.md`](../../infra/plans/16-hc-native-sessions.md) — the plan that adopts hc's model; Step 1 declares the `hc-sessions` flag, off in every overlay.
- [`infra/environments/local/environment.yaml`](../../infra/environments/local/environment.yaml), [`vps`](../../infra/environments/vps/environment.yaml), [`managed-example`](../../infra/environments/managed-example/environment.yaml) — each lists `hc-sessions: false`.
