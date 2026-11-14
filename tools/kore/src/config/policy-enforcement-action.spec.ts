// Docs: docs/decisions/0059-identity-policy-evidence.md
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { fakeRepository } from "./config-support.js";
import { policyPromotionErrors } from "./policy-promotion.js";

vi.mock("node:fs/promises");
vi.mock("node:path");

const NOW = new Date("2026-11-08T12:00:00Z");
const FRESH = "2026-11-07T10:00:00Z";
const CONSTRAINTS = "/repo/infra/policies/gatekeeper/constraints";
const PROMOTIONS = "/repo/infra/policies/gatekeeper/promotions";
// readdir is overloaded; the typed view is the one the policy code calls.
const listDir = vi.mocked<(path: string) => Promise<string[]>>(readdir);

const refusal = (file: string): string =>
  `policy promotion: infra/policies/gatekeeper/constraints/${file} has no spec.enforcementAction; set enforcementAction to deny, warn or dryrun explicitly`;

const record = JSON.stringify({
  constraint: "kore-rbac",
  from: "dryrun",
  to: "deny",
  environments: { local: { observedAt: FRESH, totalViolations: 0 } },
});

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

function policies(
  constraints: Record<string, string>,
  promotions: Record<string, string> = {},
): void {
  const texts = new Map<string, string>([
    ...Object.entries(constraints).map(
      ([file, text]) => [`${CONSTRAINTS}/${file}`, text] as const,
    ),
    ...Object.entries(promotions).map(
      ([file, text]) => [`${PROMOTIONS}/${file}`, text] as const,
    ),
  ]);
  const listing: Record<string, string[]> = {
    [CONSTRAINTS]: Object.keys(constraints),
    [PROMOTIONS]: Object.keys(promotions),
  };
  listDir.mockImplementation(async (dir) => listing[dir] ?? []);
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = typeof path === "string" ? texts.get(path) : undefined;
    if (text === undefined) {
      throw new Error("ENOENT");
    }
    return text;
  });
}

const repository = () => fakeRepository({ root: "/repo" });

const noAction = "metadata: {name: kore-rbac}\nspec: {}\n";

test("a constraint with no enforcementAction is refused, naming its file and the three explicit actions", async () => {
  policies({ "rbac.yaml": noAction });
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([
    refusal("rbac.yaml"),
  ]);
});

test("a deny promotion record does not stand in for a missing enforcementAction", async () => {
  policies({ "rbac.yaml": noAction }, { "kore-rbac.json": record });
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([
    refusal("rbac.yaml"),
  ]);
});

test("an explicit dryrun, warn or deny action is not refused for its action", async () => {
  policies(
    {
      "dry.yaml":
        "metadata: {name: kore-dry}\nspec:\n  enforcementAction: dryrun\n",
      "deny.yaml":
        "metadata: {name: kore-rbac}\nspec:\n  enforcementAction: deny\n",
    },
    { "kore-rbac.json": record },
  );
  expect(await policyPromotionErrors(repository(), NOW)).toEqual([]);
});
