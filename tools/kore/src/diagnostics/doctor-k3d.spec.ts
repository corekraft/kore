import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { doctor, doctorFailed } from "./doctor.js";
import type { Runner } from "../runtime/index.js";

interface Cluster {
  serversCount: number;
  serversRunning: number;
  agentsCount: number;
  agentsRunning: number;
}
const running: Cluster = {
  serversCount: 1,
  serversRunning: 1,
  agentsCount: 0,
  agentsRunning: 0,
};

async function fixture(
  options: {
    missing?: string[];
    clusters?: ({ name: string } & Cluster)[];
    commands?: string[];
  } = {},
) {
  const repository = await loadRepository("local");
  const commands = options.commands ?? [];
  const runner: Runner = {
    async run(command, args) {
      commands.push(`${command} ${args.join(" ")}`);
      if (options.missing?.includes(command)) {
        throw Object.assign(new Error(`spawn ${command} ENOENT`), {
          code: "ENOENT",
        });
      }
      if (command === "k3d" && args[0] === "cluster") {
        return {
          stdout: JSON.stringify(options.clusters ?? []),
          stderr: "",
          code: 0,
        };
      }
      const pinned = repository.versions.tools[command] ?? "0.0.0";
      return { stdout: `${command} version v${pinned}`, stderr: "", code: 0 };
    },
  };
  return { repository, runner, commands };
}

const byName = (checks: Awaited<ReturnType<typeof doctor>>, name: string) =>
  checks.find((check) => check.name === name);

test("doctor names a missing k3d binary as a required failure with the install remedy", async () => {
  const { repository, runner } = await fixture({ missing: ["k3d"] });
  const checks = await doctor(repository, runner);
  const check = byName(checks, "tool:k3d");
  assert.equal(check?.status, "fail");
  assert.equal(check?.required, true);
  assert.match(check?.message ?? "", /k3d.*mise install/s);
  assert.equal(doctorFailed(checks), true);
});

test("doctor names a missing docker binary as a required failure", async () => {
  const { repository, runner } = await fixture({ missing: ["docker"] });
  const checks = await doctor(repository, runner);
  assert.equal(byName(checks, "tool:docker")?.status, "fail");
  assert.equal(byName(checks, "container-runtime")?.status, "fail");
  assert.equal(doctorFailed(checks), true);
});

test("doctor reports an absent k3d cluster as not yet created, with kore local up as the fix", async () => {
  const { repository, runner } = await fixture({ clusters: [] });
  const checks = await doctor(repository, runner);
  const check = byName(checks, "k3d-cluster");
  assert.equal(check?.status, "warn");
  assert.equal(check?.required, false);
  assert.match(check?.message ?? "", /kore-local.*absent.*kore local up/s);
  assert.equal(doctorFailed(checks), false);
});

test("doctor reports a running k3d cluster as passing and a stopped one as a warning", async () => {
  const live = await fixture({
    clusters: [{ name: "kore-local", ...running }],
  });
  assert.equal(
    byName(await doctor(live.repository, live.runner), "k3d-cluster")?.status,
    "pass",
  );
  const stopped = await fixture({
    clusters: [{ name: "kore-local", ...running, serversRunning: 0 }],
  });
  const check = byName(
    await doctor(stopped.repository, stopped.runner),
    "k3d-cluster",
  );
  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /stopped/);
});

/** Exactly the tools a k3d overlay checks; a pinned tool with no provider must not appear. */
const EXPECTED = [
  "tool:node",
  "tool:npm",
  "tool:k3d",
  "tool:kubectl",
  "tool:helm",
  "tool:yq",
  "tool:sops",
  "tool:age",
  "tool:mkcert",
  "tool:tofu",
  "tool:opa",
  "tool:cosign",
  "tool:docker",
];

test("doctor on k3d checks the pinned k3d and docker and no host sizing", async () => {
  const commands: string[] = [];
  const { repository, runner } = await fixture({ commands });
  const checks = await doctor(repository, runner);
  assert.equal(byName(checks, "tool:k3d")?.status, "pass");
  assert.equal(byName(checks, "tool:docker")?.status, "pass");
  assert.equal(byName(checks, "host:cpu"), undefined);
  const tools = checks
    .map(({ name }) => name)
    .filter((name) => name.startsWith("tool:"));
  assert.deepEqual(tools, EXPECTED);
});

test("doctor only reads: it never creates, starts, stops or deletes a cluster", async () => {
  const commands: string[] = [];
  const { repository, runner } = await fixture({ commands });
  await doctor(repository, runner);
  assert.deepEqual(
    commands.filter((command) =>
      /k3d cluster (create|start|stop|delete)/.test(command),
    ),
    [],
  );
});
