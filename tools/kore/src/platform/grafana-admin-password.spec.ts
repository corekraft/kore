import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import { reconcileGrafanaAdminPassword } from "./grafana-admin.js";

type Call = { command: string; args: readonly string[]; options?: RunOptions };

function fake(fail = false): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = {
    async run(command, args, options): Promise<RunResult> {
      calls.push({ command, args, ...(options ? { options } : {}) });
      if (fail) {
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "SECRET-CANARY-from-stderr",
          code: 1,
        });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

test("an existing profile's Grafana admin password is set to the Secret's value inside the pod, never through kore", async () => {
  const repository = await loadRepository("local");
  const { runner, calls } = fake();

  await reconcileGrafanaAdminPassword(repository, runner);

  expect(calls).toHaveLength(1);
  const [call] = calls;
  expect(call!.command).toBe("kubectl");
  expect(call!.args.slice(0, 6)).toEqual([
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    "observability",
    "exec",
    "deploy/grafana",
  ]);
  const script = call!.args.at(-1)!;
  expect(script).toContain("$GF_SECURITY_ADMIN_PASSWORD");
  expect(script).toContain("reset-admin-password --password-from-stdin");
  expect(call!.args).toContain("--container=grafana");
  expect(call!.options?.input).toBeUndefined();
});

test("a failed reconcile names the cause and never repeats the command output", async () => {
  const repository = await loadRepository("local");
  const { runner } = fake(true);

  const error = await reconcileGrafanaAdminPassword(repository, runner).catch(
    (e: Error) => e,
  );

  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain("Grafana admin password");
  expect(message).toContain("deploy/grafana");
  expect(message).not.toContain("SECRET-CANARY");
});
