import {
  clusterCommand,
  platformCommand,
  appCommand,
  dataCommand,
} from "./commands-infra.js";
import { opsCommand } from "./commands-ops.js";
import { policyCommand } from "./commands-policy.js";
import {
  localCommand,
  registryCommand,
  signerCommand,
  secretsCommand,
  trustCommand,
} from "./commands-local.js";
import {
  doctorCommand,
  journalCommand,
  validateCommand,
} from "./commands-read.js";
import type { CommandSpec } from "./context.js";

export { usage } from "./usage.js";

/**
 * The command table. `mutations` lists the actions that mutate an environment;
 * keep it in step with the usage text.
 */
export const COMMANDS: ReadonlyMap<string, CommandSpec> = new Map<
  string,
  CommandSpec
>([
  ["doctor", { mutations: [], noAction: true, run: doctorCommand }],
  ["validate", { mutations: [], noAction: true, run: validateCommand }],
  ["journal", { mutations: [], noAction: true, run: journalCommand }],
  ["ops", { mutations: [], run: opsCommand }],
  // Edits the repository (desired state) only; the cluster follows `platform up`.
  ["policy", { mutations: [], run: policyCommand }],
  ["cluster", { mutations: ["up", "stop", "destroy"], run: clusterCommand }],
  [
    "platform",
    {
      mutations: ["bootstrap", "up", "gate-check", "stop", "destroy"],
      run: platformCommand,
    },
  ],
  ["data", { mutations: ["export", "restore"], run: dataCommand }],
  ["app", { mutations: ["up", "down"], run: appCommand }],
  ["local", { mutations: ["up", "down"], run: localCommand }],
  ["signer", { mutations: ["swap-key"], run: signerCommand }],
  ["registry", { mutations: ["rotate-credentials"], run: registryCommand }],
  // Every secrets and trust action mutates, so each one needs --environment.
  [
    "secrets",
    { mutations: ["sync"], alwaysMutates: true, run: secretsCommand },
  ],
  ["trust", { mutations: ["install"], alwaysMutates: true, run: trustCommand }],
]);

export function isMutating(
  spec: CommandSpec,
  action: string | undefined,
): boolean {
  return (
    spec.mutations.length > 0 &&
    (spec.mutations.includes(action ?? "") || spec.alwaysMutates === true)
  );
}
