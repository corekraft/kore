import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { enrollNamespace } from "./install.js";

const label = "policy.sigstore.dev/include";

function fakeRunner(readBack: string) {
  const calls: {
    command: string;
    args: readonly string[];
    input?: string | undefined;
  }[] = [];
  const runner: Runner = {
    async run(command, args, options) {
      calls.push({ command, args, input: options?.input });
      const isRead = args.includes("get");
      return { stdout: isRead ? readBack : "", stderr: "", code: 0 };
    },
  };
  return { calls, runner };
}

test("enrollment labels the application namespace for Sigstore admission as well as the mesh", async () => {
  const repository = await loadRepository("local");
  const { calls, runner } = fakeRunner("true");

  await enrollNamespace(repository, runner, "reference");

  const apply = calls.find((c) => c.args.includes("apply"))!;
  expect(apply.args).toContain(repository.environment.kubeContext);
  expect(apply.input).toContain(`${label}: "true"`);
  expect(apply.input).toContain("istio.io/dataplane-mode: ambient");
});

test("enrollment reads the label back from the configured context before returning", async () => {
  const repository = await loadRepository("local");
  const { calls, runner } = fakeRunner("true");

  await enrollNamespace(repository, runner, "reference");

  const applyAt = calls.findIndex((c) => c.args.includes("apply"));
  const readAt = calls.findIndex((c) => c.args.includes("get"));
  expect(readAt).toBeGreaterThan(applyAt);
  expect(calls[readAt]!.args).toContain(repository.environment.kubeContext);
  expect(calls[readAt]!.args.join(" ")).toContain("namespace reference");
  expect(calls[readAt]!.args.join(" ")).toContain(
    "policy\\.sigstore\\.dev/include",
  );
});

test("a namespace that is not enrolled refuses the release with the fix", async () => {
  const repository = await loadRepository("local");
  const { runner } = fakeRunner("");

  await expect(
    enrollNamespace(repository, runner, "reference"),
  ).rejects.toThrow(
    /reference.*not enrolled.*policy\.sigstore\.dev\/include.*kore app up/is,
  );
});

test("enrollment has no opt-out: the label is always applied", async () => {
  const repository = await loadRepository("managed-example");
  const { calls, runner } = fakeRunner("true");
  await enrollNamespace(repository, runner, "other");
  expect(calls.find((c) => c.args.includes("apply"))!.input).toContain(
    `${label}: "true"`,
  );
});
