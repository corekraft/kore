import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import {
  promoteConstraint,
  recordPromotionEvidence,
  rollbackConstraint,
} from "../config/index.js";
import { policyCommand } from "./commands-policy.js";
import { requireEnvironment, stringFlag } from "./flags.js";
import { print } from "./output.js";
import { fakeContext, fakeRepository, parsedArgs } from "./cli-support.js";

vi.mock("node:fs/promises");
vi.mock("../config/index.js");
vi.mock("./flags.js");
vi.mock("./output.js");

const repository = fakeRepository({ name: "local" });

beforeEach(() => {
  vi.mocked(requireEnvironment).mockReturnValue("local");
  vi.mocked(stringFlag).mockReturnValue(undefined);
  vi.mocked(promoteConstraint).mockResolvedValue({
    constraint: "kore-rbac",
    to: "deny",
  } as never);
  vi.mocked(rollbackConstraint).mockResolvedValue({
    constraint: "kore-rbac",
    to: "dryrun",
  } as never);
  vi.mocked(recordPromotionEvidence).mockResolvedValue({
    environments: { local: { evidence: "ok" } },
  } as never);
});

function context(
  action: string,
  positional: string[] = ["kore-rbac"],
  json = false,
) {
  return fakeContext({
    command: "policy",
    action,
    repository,
    environmentName: "local",
    parsed: parsedArgs({ environment: "local" }, positional),
    json,
  });
}

test("a policy action other than record, promote or rollback is refused, and no constraint changes", async () => {
  await expect(policyCommand(context("nope"))).rejects.toThrow(
    'unknown policy action "nope"; use record, promote, or rollback',
  );
  expect(promoteConstraint).not.toHaveBeenCalled();
  expect(rollbackConstraint).not.toHaveBeenCalled();
});

test("a policy edit refuses to run without --environment, so no constraint changes without one", async () => {
  vi.mocked(requireEnvironment).mockImplementation(() => {
    throw new Error("--environment is required for mutating commands");
  });
  await expect(policyCommand(context("promote"))).rejects.toThrow(
    "--environment is required for mutating commands",
  );
  expect(promoteConstraint).not.toHaveBeenCalled();
});

test("a policy action with no constraint name says which name is missing", async () => {
  await expect(policyCommand(context("promote", []))).rejects.toThrow(
    "policy promote needs the constraint name, for example kore-workload-identity",
  );
});

test("promote moves the named constraint, prints the change, and never rolls back", async () => {
  expect(await policyCommand(context("promote", ["kore-rbac"], true))).toBe(0);
  expect(promoteConstraint).toHaveBeenCalledWith(repository, "kore-rbac");
  expect(print).toHaveBeenCalledWith(
    { constraint: "kore-rbac", to: "deny" },
    true,
  );
  expect(rollbackConstraint).not.toHaveBeenCalled();
});

test("rollback moves the named constraint back, prints the change, and never promotes", async () => {
  expect(await policyCommand(context("rollback"))).toBe(0);
  expect(rollbackConstraint).toHaveBeenCalledWith(repository, "kore-rbac");
  expect(print).toHaveBeenCalledWith(
    { constraint: "kore-rbac", to: "dryrun" },
    false,
  );
  expect(promoteConstraint).not.toHaveBeenCalled();
});

test("record reads the audit from the named file and records it for the named environment", async () => {
  vi.mocked(stringFlag).mockReturnValue("audit.json");
  vi.mocked(readFile).mockResolvedValue('{"status":{"totalViolations":0}}');
  expect(await policyCommand(context("record"))).toBe(0);
  expect(readFile).toHaveBeenCalledWith("audit.json", "utf8");
  expect(recordPromotionEvidence).toHaveBeenCalledWith(
    repository,
    "kore-rbac",
    {
      status: { totalViolations: 0 },
    },
  );
  expect(print).toHaveBeenCalledWith(
    { constraint: "kore-rbac", environment: "local", evidence: "ok" },
    false,
  );
});

test("record reads the audit from stdin when --audit is -", async () => {
  vi.mocked(stringFlag).mockReturnValue("-");
  vi.mocked(readFile).mockResolvedValue("{}");
  await policyCommand(context("record"));
  expect(readFile).toHaveBeenCalledWith("/dev/stdin", "utf8");
});

test("record refuses an audit that is not JSON, naming the file and the kubectl command to use", async () => {
  vi.mocked(stringFlag).mockReturnValue("audit.json");
  vi.mocked(readFile).mockResolvedValue("not json");
  await expect(policyCommand(context("record"))).rejects.toThrow(
    "policy record: --audit audit.json is not JSON; use kubectl get --output json",
  );
  expect(recordPromotionEvidence).not.toHaveBeenCalled();
});

test("record without --audit says how to supply the audit", async () => {
  await expect(policyCommand(context("record"))).rejects.toThrow(
    "policy record needs --audit <file> (or - for stdin)",
  );
  expect(readFile).not.toHaveBeenCalled();
});
