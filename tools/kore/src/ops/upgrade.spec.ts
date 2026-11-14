import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { serveFiles, type Run } from "./ops-support.js";
import { schemaProblems } from "./schema-compat.js";
import {
  previousRelease,
  snapshotAt,
  upgradeCheck,
  upgradeProblems,
  type Snapshot,
} from "./upgrade.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("./schema-compat.js");

const GIT = "git";
const VERSIONS = "infra/catalog/versions.yaml";
const COMPONENTS = "infra/catalog/components.yaml";
const CONTRACT = "infra/apis/postgresql/definitions/postgresqlinstance.yaml";

const previous: Snapshot = {
  kubernetes: "1.36.0",
  components: { crossplane: "2.4.0", istio: "1.31.0" },
  owns: { crossplane: ["a.crossplane.io"] },
};

const xrd = (version: string) => ({
  spec: {
    versions: [
      { name: version, schema: { openAPIV3Schema: { type: "object" } } },
    ],
  },
});

/** The three catalog files as text, as a release tag or the working tree serves them. */
function filesOf(snapshot: Snapshot): Record<string, string> {
  return {
    [VERSIONS]: JSON.stringify({
      kubernetes: snapshot.kubernetes,
      components: snapshot.components,
    }),
    [COMPONENTS]: JSON.stringify({
      components: Object.keys(snapshot.components).map((name) => ({
        name,
        version: name,
        ownsCRDs: snapshot.owns?.[name] ?? [],
      })),
    }),
    [CONTRACT]: JSON.stringify(snapshot.xrd ?? xrd("v1alpha1")),
  };
}

/**
 * A fake CLI: `git show <ref>:<path>` serves the files of the ref, `git tag`
 * lists the tags, and `yq` passes its input through unchanged (JSON in, JSON out).
 */
function cli(
  refs: Record<string, Record<string, string>>,
  tags: string[] = [],
) {
  const run = vi.fn<Run>(async (command, args, options) => {
    if (command === "git" && args[0] === "tag") {
      return { stdout: tags.join("\n"), stderr: "", code: 0 };
    }
    if (command === "git" && args[0] === "show") {
      const [ref, path] = String(args[1]).split(":") as [string, string];
      const content = refs[ref]?.[path];
      if (content === undefined) {
        throw new Error(`fatal: path '${path}' does not exist in '${ref}'`);
      }
      return { stdout: content, stderr: "", code: 0 };
    }
    if (command === "yq") {
      return { stdout: options?.input ?? "", stderr: "", code: 0 };
    }
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  });
  return { runner: { run } as Runner, run };
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(schemaProblems).mockReturnValue([]);
});

test("the previous catalog is read from the release tag, one git show and one yq per file", async () => {
  const { runner, run } = cli({ "v0.4.0": filesOf(previous) });
  const snapshot = await snapshotAt(runner, "/repo", "v0.4.0");
  expect(snapshot.components).toEqual(previous.components);
  expect(run.mock.calls).toEqual([
    ["git", ["show", `v0.4.0:${VERSIONS}`], { capture: true, cwd: "/repo" }],
    ["git", ["show", `v0.4.0:${COMPONENTS}`], { capture: true, cwd: "/repo" }],
    ["git", ["show", `v0.4.0:${CONTRACT}`], { capture: true, cwd: "/repo" }],
    [
      "yq",
      ["--output-format=json", "."],
      { capture: true, input: filesOf(previous)[CONTRACT] },
    ],
  ]);
});

test("a release tag that lacks a catalog file fails with the fix", async () => {
  const { runner } = cli({});
  await expect(snapshotAt(runner, "/repo", "v9.9.9")).rejects.toThrow(
    `cannot read ${VERSIONS} at v9.9.9: fatal: path '${VERSIONS}' does not exist in 'v9.9.9'; fetch the tag (git fetch --tags) or pass --from <tag>`,
  );
});

test("upgradeCheck compares the release with the working tree and lists each change", async () => {
  const next: Snapshot = {
    ...previous,
    kubernetes: "1.37.2",
    components: { crossplane: "2.4.3", istio: "1.31.0", gatekeeper: "3.23.1" },
  };
  const { runner } = cli({ "v0.4.0": filesOf(previous) });
  const working = Object.fromEntries(
    Object.entries(filesOf(next)).map(([path, text]) => [
      `/repo/${path}`,
      text,
    ]),
  );
  serveFiles(working);
  expect(await upgradeCheck(runner, "/repo", "v0.4.0")).toEqual({
    from: "v0.4.0",
    changes: [
      { name: "crossplane", from: "2.4.0", to: "2.4.3" },
      { name: "gatekeeper", from: undefined, to: "3.23.1" },
      { name: "kubernetes", from: "1.36.0", to: "1.37.2" },
    ],
    problems: [],
  });
});

test("previousRelease is the first v-tag git lists, skipping blank lines", async () => {
  const { runner, run } = cli({}, ["", "v0.4.0", "v0.3.2"]);
  expect(await previousRelease(runner, "/repo")).toBe("v0.4.0");
  expect(run).toHaveBeenCalledWith(
    GIT,
    ["tag", "--list", "v*", "--sort=-v:refname"],
    { capture: true, cwd: "/repo" },
  );
});

test("previousRelease fails with the fix when no release tag exists", async () => {
  const { runner } = cli({}, []);
  await expect(previousRelease(runner, "/repo")).rejects.toThrow(
    "no release tag found; fetch tags (git fetch --tags) or pass --from <tag>",
  );
});

test("a component downgrade is reported", () => {
  expect(
    upgradeProblems(previous, {
      ...previous,
      components: { crossplane: "2.3.9", istio: "1.31.0" },
    }),
  ).toEqual([
    "crossplane: 2.3.9 is older than the supported 2.4.0; upgrades only move forward",
  ]);
});

test("versions compare numerically, so 2.4.10 is not a downgrade from 2.4.9", () => {
  expect(
    upgradeProblems(
      { ...previous, components: { crossplane: "2.4.9" } },
      { ...previous, components: { crossplane: "2.4.10" } },
    ),
  ).toEqual([]);
});

test("skipping a Kubernetes minor version is reported, and an older Kubernetes is too", () => {
  expect(
    upgradeProblems(previous, { ...previous, kubernetes: "1.38.0" }),
  ).toEqual([
    "kubernetes: 1.36.0 to 1.38.0 skips a minor version; upgrade one minor at a time",
  ]);
  expect(
    upgradeProblems(previous, { ...previous, kubernetes: "1.35.0" }),
  ).toEqual(["kubernetes: 1.35.0 is older than the supported 1.36.0"]);
});

test("removing a component that owns CRDs is reported, and so is dropping one of its CRDs", () => {
  expect(
    upgradeProblems(previous, {
      ...previous,
      components: { istio: "1.31.0" },
      owns: {},
    }),
  ).toEqual([
    "crossplane: removed while it owns CRDs a.crossplane.io; removing a CRD deletes its custom resources",
  ]);
  expect(
    upgradeProblems(previous, { ...previous, owns: { crossplane: [] } }),
  ).toEqual([
    "crossplane: no longer owns CRD a.crossplane.io; hand it to another owner first",
  ]);
});

test("a component that owned no CRDs can be removed without a problem", () => {
  expect(
    upgradeProblems(
      {
        ...previous,
        components: { crossplane: "2.4.0", istio: "1.31.0" },
        owns: { istio: [] },
      },
      {
        ...previous,
        components: { crossplane: "2.4.0" },
        owns: { crossplane: ["a.crossplane.io"] },
      },
    ),
  ).toEqual([]);
});

test("an application contract problem is reported with the contract and version it breaks", () => {
  vi.mocked(schemaProblems).mockReturnValue([
    "spec: field tier became required",
  ]);
  const after: Snapshot = { ...previous, xrd: xrd("v1alpha1") };
  expect(upgradeProblems({ ...previous, xrd: xrd("v1alpha1") }, after)).toEqual(
    [
      "application contract postgresqlinstance v1alpha1: spec: field tier became required",
    ],
  );
  expect(schemaProblems).toHaveBeenCalledWith(
    { type: "object" },
    { type: "object" },
  );
});

test("removing a served application contract version is reported, and its schema is not compared", () => {
  expect(
    upgradeProblems(
      { ...previous, xrd: xrd("v1alpha1") },
      { ...previous, xrd: xrd("v1beta1") },
    ),
  ).toEqual([
    "application contract postgresqlinstance: version v1alpha1 was removed; applications still claim it",
  ]);
  expect(schemaProblems).not.toHaveBeenCalled();
});
