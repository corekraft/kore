export const usage = `Kore local platform orchestration

Usage:
  kore doctor [--environment local] [--json]
  kore validate [--environment local] [--json]
  kore cluster up|stop|destroy --environment <name> [--yes] [--purge-data]
  kore cluster status [--environment <name>] [--json]
  kore platform bootstrap|up|stop|destroy --environment <name> [--yes] [--purge-data]
  kore platform status|render [--environment <name>] [--output <directory>] [--json]
  kore app up|down <name> --environment <name>
  kore app status <name> [--environment <name>] [--json]
  kore local up|down --environment local [--prune [--purge-data]]
  kore tunnel start|stop --environment local
  kore tunnel status [--environment local] [--json]
  kore secrets sync --environment local
  kore trust install --environment local
  kore journal [--environment <name>] [--limit <n>] [--json]

Every mutation requires --environment and is recorded in
.kore/state/journal/<environment>.jsonl. Status, doctor, validate, render, and
journal are read-only and default to local.`;
