import { expect, test } from "vitest";
import { ProcessRunner } from "../../src/runtime/index.js";

// A kubeconfig held in memory reaches a real child as KUBECONFIG through a pipe:
// the child reads the descriptor, and the output is its own.

test("a kubeconfig reaches the child as KUBECONFIG through a pipe, and the child reads it", async () => {
  const result = await new ProcessRunner().run(
    "sh",
    ["-c", 'cat "$KUBECONFIG"'],
    { kubeconfig: "apiVersion: v1" },
  );

  expect(result).toEqual({ stdout: "apiVersion: v1", stderr: "", code: 0 });
});
