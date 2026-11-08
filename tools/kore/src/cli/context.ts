import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { ParsedArgs } from "./flags.js";

/** Runs mutating work under the environment lock and journal. */
export type Mutate = (
  label: string,
  work: (runner: Runner) => Promise<number>,
) => Promise<number>;

/** Everything a command handler needs, resolved once by `main`. */
export interface CommandContext {
  command: string;
  action: string | undefined;
  parsed: ParsedArgs;
  repository: Repository;
  environmentName: string;
  runner: Runner;
  json: boolean;
  mutate: Mutate;
}

export interface CommandSpec {
  /** Actions that mutate the environment. */
  mutations: readonly string[];
  /** Whether the command takes its arguments after the command name only. */
  noAction?: boolean;
  /** Whether every invocation mutates, whatever its action. */
  alwaysMutates?: boolean;
  run(context: CommandContext): Promise<number>;
}

export type ActionHandler = (
  context: CommandContext,
  runner: Runner,
) => Promise<void>;

/** Runs the handler named by the action inside the lock and journal. */
export async function mutateAction(
  context: CommandContext,
  actions: Record<string, ActionHandler>,
  label: string = `${context.command} ${context.action ?? ""}`,
): Promise<number> {
  return await context.mutate(label, async (runner) => {
    await actions[context.action ?? ""]?.(context, runner);
    return 0;
  });
}
