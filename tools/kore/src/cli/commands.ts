import {
  clusterCommand,
  platformCommand,
  appCommand,
  dataCommand,
} from "./commands-infra.js";
import {
  localCommand,
  secretsCommand,
  trustCommand,
  tunnelCommand,
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
  ["cluster", { mutations: ["up", "stop", "destroy"], run: clusterCommand }],
  [
    "platform",
    { mutations: ["bootstrap", "up", "stop", "destroy"], run: platformCommand },
  ],
  ["data", { mutations: ["export", "restore"], run: dataCommand }],
  ["app", { mutations: ["up", "down"], run: appCommand }],
  ["local", { mutations: ["up", "down"], run: localCommand }],
  ["tunnel", { mutations: ["start", "stop"], run: tunnelCommand }],
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
