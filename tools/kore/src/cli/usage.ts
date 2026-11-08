export const usage = `Kore local platform orchestration

Usage:
  kore doctor [--environment local] [--json]
  kore validate [--environment local] [--json]
  kore cluster up|stop|destroy --environment <name> [--yes] [--purge-data]
  kore cluster status [--environment <name>] [--json]
  kore platform bootstrap|up|stop|destroy --environment <name> [--yes] [--purge-data]
  kore platform status|render [--environment <name>] [--output <directory>] [--json]
  kore app up <name> --environment <name>
  kore app down <name> --environment <name> [--json]
  kore app status <name> [--environment <name>] [--json]
  kore local up|down --environment local [--prune [--purge-data]]
  kore tunnel start|stop --environment local
  kore tunnel status [--environment local] [--json]
  kore secrets sync --environment local
  kore trust install --environment local
  kore journal [--environment <name>] [--limit <n>] [--json]

"cluster destroy" refuses while data labeled platform.kore.dev/retention=Retain
(databases and the oci-registry image store) exists; --purge-data deletes it.

"app down" uninstalls only the workload release and reports the retained data
(claims and volumes) that remains; with --json it always prints
{ name, retained: [...], warnings? }.

"trust install" runs "mkcert -install" (which may prompt for your password)
only when the mkcert CA is not already trusted on the host; on macOS it skips
the install when the CA files exist and "security verify-cert" accepts the
root, and on other hosts it always runs it.

Every mutation requires --environment and is recorded in
.kore/state/journal/<environment>.jsonl. Status, doctor, validate, render, and
journal are read-only and default to local.`;
