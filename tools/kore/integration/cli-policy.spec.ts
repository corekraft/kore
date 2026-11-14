import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadRepository } from "../src/config/index.js";
import { main } from "../src/cli/cli.js";
import { COMMANDS, isMutating } from "../src/cli/commands.js";
import { policyCommand } from "../src/cli/commands-policy.js";
import { parseArgs } from "../src/cli/flags.js";
import type { CommandContext } from "../src/cli/context.js";

// Docs: docs/decisions/0072-constraint-promotion-procedure.md
const roots: string[] = [];

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true })));
});

async function context(
  args: string[],
): Promise<{ context: CommandContext; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "kore-cli-policy-"));
  roots.push(root);
  await mkdir(join(root, "infra/policies/gatekeeper/constraints"), {
    recursive: true,
  });
  await writeFile(
    join(root, "infra/policies/gatekeeper/constraints/rbac.yaml"),
    "kind: KoreRbac\nmetadata: {name: kore-rbac}\nspec:\n  enforcementAction: dryrun\n",
  );
  const parsed = parseArgs(args);
  const mutate = vi.fn();
  return {
    root,
    context: {
      command: "policy",
      action: parsed.positional[0],
      parsed: { ...parsed, positional: parsed.positional.slice(1) },
      repository: { ...(await loadRepository("local")), root },
      environmentName: "local",
      runner: vi.fn() as never,
      json: false,
      mutate,
    },
  };
}

test("policy edits the repository only: no action is a cluster mutation", () => {
  const spec = COMMANDS.get("policy")!;
  expect(spec.mutations).toEqual([]);
  expect(isMutating(spec, "promote")).toBe(false);
});

test("policy promote and rollback require --environment so the evidence is the named environment's", async () => {
  for (const action of ["record", "promote", "rollback"]) {
    await expect(main(["policy", action, "kore-rbac"])).rejects.toThrow(
      /--environment is required/,
    );
  }
});

test("an unknown policy action fails with the supported actions", async () => {
  await expect(
    main(["policy", "nope", "x", "--environment", "local"]),
  ).rejects.toThrow(/use record, promote, or rollback/);
});

test("policy record reads the audit from a file, and promote then rollback move one constraint", async () => {
  const { context: c, root } = await context([
    "record",
    "kore-rbac",
    "--environment",
    "local",
    "--audit",
    "audit.json",
  ]);
  const auditPath = join(root, "audit.json");
  await writeFile(
    auditPath,
    JSON.stringify({
      metadata: { name: "kore-rbac" },
      status: { auditTimestamp: new Date().toISOString(), totalViolations: 0 },
    }),
  );
  c.parsed.flags.set("audit", auditPath);
  expect(await policyCommand(c)).toBe(0);
  const constraint = join(
    root,
    "infra/policies/gatekeeper/constraints/rbac.yaml",
  );

  c.action = "promote";
  expect(await policyCommand(c)).toBe(0);
  expect(await readFile(constraint, "utf8")).toMatch(/enforcementAction: deny/);

  c.action = "rollback";
  expect(await policyCommand(c)).toBe(0);
  expect(await readFile(constraint, "utf8")).toMatch(
    /enforcementAction: dryrun/,
  );
  expect(c.mutate).not.toHaveBeenCalled();
});

test("policy record without --audit says how to supply the audit", async () => {
  const { context: c } = await context([
    "record",
    "kore-rbac",
    "--environment",
    "local",
  ]);
  await expect(policyCommand(c)).rejects.toThrow(/--audit/);
});

test("policy promote without a constraint name says which argument is missing", async () => {
  const { context: c } = await context(["promote", "--environment", "local"]);
  await expect(policyCommand(c)).rejects.toThrow(/constraint name/);
});
