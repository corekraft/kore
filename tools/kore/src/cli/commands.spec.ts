import { expect, test, vi } from "vitest";
import * as infra from "./commands-infra.js";
import * as local from "./commands-local.js";
import * as read from "./commands-read.js";
import * as ops from "./commands-ops.js";
import * as policy from "./commands-policy.js";
import { COMMANDS, isMutating, usage as commandsUsage } from "./commands.js";
import { usage } from "./usage.js";

/** A handler read off its module by name, typed as unknown so it is compared, not called. */
function handlerOf(module: object, name: string): unknown {
  return (module as Record<string, unknown>)[name];
}

vi.mock("./commands-infra.js");
vi.mock("./commands-ops.js");
vi.mock("./commands-policy.js");
vi.mock("./commands-local.js");
vi.mock("./commands-read.js");

test("the command table names every command, in dispatch order", () => {
  expect([...COMMANDS.keys()]).toEqual([
    "doctor",
    "validate",
    "journal",
    "ops",
    "policy",
    "cluster",
    "platform",
    "data",
    "app",
    "local",
    "signer",
    "registry",
    "secrets",
    "trust",
  ]);
});

test("each command's mutating actions are exactly the actions that change its environment", () => {
  expect(
    Object.fromEntries(
      [...COMMANDS].map(([name, spec]) => [name, spec.mutations]),
    ),
  ).toEqual({
    doctor: [],
    validate: [],
    journal: [],
    ops: [],
    policy: [],
    cluster: ["up", "stop", "destroy"],
    platform: ["bootstrap", "up", "gate-check", "stop", "destroy"],
    data: ["export", "restore"],
    app: ["up", "down"],
    local: ["up", "down"],
    signer: ["swap-key"],
    registry: ["rotate-credentials"],
    secrets: ["sync"],
    trust: ["install"],
  });
});

/** The handler a command's table entry runs, read as unknown so it is compared, not called. */
function runOf(name: string): unknown {
  return (COMMANDS.get(name) as unknown as Record<string, unknown> | undefined)
    ?.run;
}

test("each command runs its own handler", () => {
  expect(runOf("doctor")).toBe(handlerOf(read, "doctorCommand"));
  expect(runOf("validate")).toBe(handlerOf(read, "validateCommand"));
  expect(runOf("journal")).toBe(handlerOf(read, "journalCommand"));
  expect(runOf("ops")).toBe(handlerOf(ops, "opsCommand"));
  expect(runOf("policy")).toBe(handlerOf(policy, "policyCommand"));
  expect(runOf("cluster")).toBe(handlerOf(infra, "clusterCommand"));
  expect(runOf("platform")).toBe(handlerOf(infra, "platformCommand"));
  expect(runOf("data")).toBe(handlerOf(infra, "dataCommand"));
  expect(runOf("app")).toBe(handlerOf(infra, "appCommand"));
  expect(runOf("local")).toBe(handlerOf(local, "localCommand"));
  expect(runOf("signer")).toBe(handlerOf(local, "signerCommand"));
  expect(runOf("registry")).toBe(handlerOf(local, "registryCommand"));
  expect(runOf("secrets")).toBe(handlerOf(local, "secretsCommand"));
  expect(runOf("trust")).toBe(handlerOf(local, "trustCommand"));
});

test("a read-only command never mutates, whatever action it is given", () => {
  for (const name of ["doctor", "validate", "journal", "ops", "policy"]) {
    expect(isMutating(COMMANDS.get(name)!, "anything")).toBe(false);
  }
  expect(isMutating(COMMANDS.get("ops")!, "inventory")).toBe(false);
});

test("a listed action of a command mutates, and an unlisted action of the same command does not", () => {
  const cluster = COMMANDS.get("cluster")!;
  expect(isMutating(cluster, "up")).toBe(true);
  expect(isMutating(cluster, "status")).toBe(false);
  expect(isMutating(cluster, undefined)).toBe(false);
});

test("secrets and trust mutate on every invocation, since no action of theirs is read-only", () => {
  expect(isMutating(COMMANDS.get("secrets")!, "anything")).toBe(true);
  expect(isMutating(COMMANDS.get("trust")!, undefined)).toBe(true);
});

test("the command table re-exports the usage text the CLI prints", () => {
  expect(commandsUsage).toBe(usage);
});
