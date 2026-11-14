// Docs: docs/decisions/0066-opa-receives-peer-identity-via-xfcc.md (exemption by name)
import { beforeEach, expect, test, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { FileExemptionSource } from "./exemption-source.js";

vi.mock("node:fs/promises", () => ({ readdir: vi.fn(), readFile: vi.fn() }));

const files = new Map<string, string>();

beforeEach(() => {
  files.clear();
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = files.get(path as string);
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

test("static-pass namespaces are read from the image-policy chart values", async () => {
  files.set(
    "/r/infra/charts/image-policy/values.yaml",
    "trust: {}\nstaticPassNamespaces: [cnpg-system, istio-system]\nupstreamImages:\n  - x\n",
  );
  expect(await new FileExemptionSource("/r").staticPassNamespaces()).toEqual([
    "cnpg-system",
    "istio-system",
  ]);
});

test("no staticPassNamespaces key means no static-pass namespace", async () => {
  files.set("/r/infra/charts/image-policy/values.yaml", "trust: {}\n");
  expect(await new FileExemptionSource("/r").staticPassNamespaces()).toEqual(
    [],
  );
});

test("gate writers are the gate names the admission-gate role may update", async () => {
  files.set(
    "/r/infra/charts/admission-gate/templates/rbac.yaml",
    "rules:\n  - resources: [koreapplicationadmission]\n    verbs: [create]\n  - apiGroups: [constraints.gatekeeper.sh]\n    resources: [koreapplicationadmission]\n    resourceNames: [kore-application-admission]\n    verbs: [get]\n",
  );
  expect(await new FileExemptionSource("/r").gateWriters()).toEqual([
    "kore-application-admission",
  ]);
});

const enoent = () =>
  Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });

test.each([
  [
    "constraints",
    "infra/policies/gatekeeper/constraints",
    (s: FileExemptionSource) => s.constraints(),
  ],
  ["adrStatus", "docs/decisions", (s: FileExemptionSource) => s.adrStatus(66)],
  [
    "applicationNamespaces",
    "apps",
    (s: FileExemptionSource) => s.applicationNamespaces(),
  ],
])(
  "a missing directory under %s names the path and the fix",
  async (_name, path, run) => {
    vi.mocked(readdir).mockRejectedValue(enoent());
    await expect(run(new FileExemptionSource("/r"))).rejects.toThrow(
      `exemption check: /r/${path} does not exist; run kore from a full repository checkout`,
    );
  },
);

test.each([
  [
    "infra/charts/image-policy/values.yaml",
    (s: FileExemptionSource) => s.staticPassNamespaces(),
  ],
  [
    "infra/charts/admission-gate/templates/rbac.yaml",
    (s: FileExemptionSource) => s.gateWriters(),
  ],
])("a missing %s names the path and the fix", async (path, run) => {
  await expect(run(new FileExemptionSource("/r"))).rejects.toThrow(
    `exemption check: /r/${path} does not exist; run kore from a full repository checkout`,
  );
});

test("a missing exemptions catalog file names the path and the fix", async () => {
  await expect(new FileExemptionSource("/r").listed()).rejects.toThrow(
    "exemption check: /r/infra/catalog/gatekeeper-exemptions.yaml does not exist; run kore from a full repository checkout",
  );
});

test("an error that is not a missing path is rethrown unchanged", async () => {
  const denied = Object.assign(new Error("EACCES"), { code: "EACCES" });
  vi.mocked(readdir).mockRejectedValue(denied);
  await expect(new FileExemptionSource("/r").constraints()).rejects.toBe(
    denied,
  );
});
