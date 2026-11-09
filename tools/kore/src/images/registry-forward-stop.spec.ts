import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { stopRegistryForward } from "./registry.js";

test("stops the kore registry port-forward for this context only, idempotently", async () => {
  const repository = await loadRepository("local");
  const ctx = repository.environment.kubeContext;
  const forward = (context: string) =>
    `kubectl --context ${context} --namespace kore-registry port-forward service/oci-registry 30500:5000`;
  const signalled: number[] = [];
  const lines: string[] = [];
  const dependencies = {
    listProcesses: async () => [
      { pid: 7, command: forward(ctx) },
      { pid: 8, command: forward("other-context") },
      {
        pid: 9,
        command: `kubectl --context ${ctx} --namespace app port-forward service/web 8080:80`,
      },
    ],
    signalProcess: (pid: number) => void signalled.push(pid),
    report: (line: string) => void lines.push(line),
  };
  await stopRegistryForward(repository, dependencies);
  expect(signalled).toEqual([7]);
  expect(lines).toHaveLength(1);

  signalled.length = 0;
  await stopRegistryForward(repository, {
    ...dependencies,
    listProcesses: async () => [],
  });
  expect(signalled).toEqual([]);
});
