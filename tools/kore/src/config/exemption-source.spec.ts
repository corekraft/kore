// Docs: docs/decisions/0066-opa-receives-peer-identity-via-xfcc.md (exemption by name)
import { beforeEach, expect, test, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { FileExemptionSource } from "./exemption-source.js";

vi.mock("node:fs/promises", () => ({ readdir: vi.fn(), readFile: vi.fn() }));

const files = new Map<string, string>();

beforeEach(() => {
  files.clear();
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = files.get(String(path));
    if (text === undefined) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    return text;
  });
});

test("reads each constraint's kind, name and exempt namespaces, flow or block style", async () => {
  vi.mocked(readdir).mockResolvedValue(["a.yaml", "b.yaml", "c.txt"] as never);
  files.set(
    "/r/infra/policies/gatekeeper/constraints/a.yaml",
    "kind: KoreA\nmetadata: { name: kore-a }\nspec:\n  parameters:\n    exemptNamespaces: [x, y]\n",
  );
  files.set(
    "/r/infra/policies/gatekeeper/constraints/b.yaml",
    "kind: KoreB\nmetadata: {name: kore-b}\nspec:\n  parameters:\n    exemptNamespaces:\n      [\n        z,\n        w\n      ]\n",
  );
  expect(await new FileExemptionSource("/r").constraints()).toEqual([
    { kind: "KoreA", name: "kore-a", exemptNamespaces: ["x", "y"] },
    { kind: "KoreB", name: "kore-b", exemptNamespaces: ["z", "w"] },
  ]);
});

test("a constraint without exemptNamespaces exempts nothing", async () => {
  vi.mocked(readdir).mockResolvedValue(["a.yaml"] as never);
  files.set(
    "/r/infra/policies/gatekeeper/constraints/a.yaml",
    "kind: KoreA\nmetadata: { name: kore-a }\nspec: {}\n",
  );
  expect(await new FileExemptionSource("/r").constraints()).toEqual([
    { kind: "KoreA", name: "kore-a", exemptNamespaces: [] },
  ]);
});

test("reads the listed exemptions from the catalog file", async () => {
  const entry = {
    kind: "K",
    name: "n",
    namespace: "x",
    component: "c",
    adr: 1,
    reason: "r",
  };
  files.set(
    "/r/infra/catalog/gatekeeper-exemptions.yaml",
    JSON.stringify({ exemptions: [entry] }),
  );
  expect(await new FileExemptionSource("/r").listed()).toEqual([entry]);
});

test("reports an ADR's status from its front matter, and undefined when no ADR has the number", async () => {
  vi.mocked(readdir).mockResolvedValue(["0066-opa.md", "0067-x.md"] as never);
  files.set(
    "/r/docs/decisions/0066-opa.md",
    "---\nstatus: accepted\nsummary: s\n---\n# ADR\n",
  );
  const source = new FileExemptionSource("/r");
  expect(await source.adrStatus(66)).toBe("accepted");
  expect(await source.adrStatus(5)).toBeUndefined();
});

test("application namespaces are the directories under apps/", async () => {
  vi.mocked(readdir).mockResolvedValue([
    { name: "reference", isDirectory: () => true },
    { name: "README.md", isDirectory: () => false },
  ] as never);
  expect(await new FileExemptionSource("/r").applicationNamespaces()).toEqual([
    "reference",
  ]);
});
