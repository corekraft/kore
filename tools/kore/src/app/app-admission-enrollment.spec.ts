import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  healthyReadinessOutput,
  readPassword,
  pushPassword,
} from "./app-fixtures.js";
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
      if (
        args.includes("oci-registry-credentials") ||
        args.includes("oci-registry-tls")
      ) {
        return {
          stdout: healthyReadinessOutput(args) ?? "",
          stderr: "",
          code: 0,
        };
      }
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

test("enrollment gives the namespace only the read-only registry identity, as the signature credential Policy Controller reads from it", async () => {
  const repository = await loadRepository("local");
  const { calls, runner } = fakeRunner("true");

  await enrollNamespace(repository, runner, "reference");

  const applies = calls.filter((c) => c.args.includes("apply"));
  const pull = applies.at(-1)!;
  expect(pull.args).toContain(repository.environment.kubeContext);
  expect(pull.args).toContain("--filename=-");
  const items = (JSON.parse(pull.input ?? "{}") as { items: unknown[] }).items;
  const text = JSON.stringify(items);
  expect(text).toContain("kubernetes.io/dockerconfigjson");
  expect(items).toHaveLength(1);
  expect(text).not.toContain("ServiceAccount");
  expect(text).not.toContain("imagePullSecrets");
  const config = Buffer.from(
    (items[0] as { data: Record<string, string> }).data[".dockerconfigjson"]!,
    "base64",
  ).toString("utf8");
  expect(config).toContain(readPassword);
  expect(config).not.toContain(pushPassword);
  expect(JSON.stringify(calls.map((c) => c.args))).not.toContain(readPassword);
});

test("a refused enrollment never distributes the registry credential", async () => {
  const repository = await loadRepository("local");
  const { calls, runner } = fakeRunner("");

  await expect(
    enrollNamespace(repository, runner, "reference"),
  ).rejects.toThrow(/not enrolled/);
  expect(calls.filter((c) => c.args.includes("apply"))).toHaveLength(1);
});

test("an external registry address gets no in-cluster pull Secret", async () => {
  const repository = await loadRepository("local");
  const external = {
    ...repository,
    environment: {
      ...repository.environment,
      registry: { address: "registry.example.com" },
    },
  };
  const { calls, runner } = fakeRunner("true");

  await enrollNamespace(external, runner, "reference");

  expect(calls.filter((c) => c.args.includes("apply"))).toHaveLength(1);
});
