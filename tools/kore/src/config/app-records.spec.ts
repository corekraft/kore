import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { immutabilityReport } from "./app-record-base.js";
import {
  componentCrossErrors,
  duplicateNameErrors,
  rejectedDigestErrors,
  releaseFileErrors,
  specFileErrors,
} from "./app-record-rules.js";
import { checkAppRecords } from "./app-records.js";
import { registrationPaths } from "./service-registrations.js";

vi.mock("node:fs/promises");
vi.mock("./app-record-base.js");
vi.mock("./app-record-rules.js");
vi.mock("./service-registrations.js");

const root = "/repo";
const dir = `${root}/infra/environments/local/services`;
const xrdSpec = { type: "object", required: ["organization"] };

/** The files of the repository, by absolute path. */
let files: Record<string, string> = {};
let yqStdout: string;

function enoent(): Error {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

/** A path argument as the key of the files map; the mocks only ever receive strings. */
const pathKey = (path: unknown): string =>
  typeof path === "string" ? path : "";

const run = vi.fn(async (command: string) => {
  if (command !== "yq") {
    throw new Error(`unexpected command ${command}`);
  }
  return { stdout: yqStdout, stderr: "", code: 0 };
});
const runner = { run } as unknown as Runner;

beforeEach(() => {
  files = {};
  yqStdout = JSON.stringify(xrdSpec);
  vi.mocked(readdir).mockImplementation(async (path) => {
    const names = Object.keys(files)
      .filter((file) => file.startsWith(`${pathKey(path)}/`))
      .map((file) => basename(file));
    if (names.length === 0) {
      throw enoent();
    }
    return names as never;
  });
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = files[pathKey(path)];
    if (text === undefined) {
      throw enoent();
    }
    return text as never;
  });
  vi.mocked(specFileErrors).mockReturnValue([]);
  vi.mocked(releaseFileErrors).mockReturnValue([]);
  vi.mocked(componentCrossErrors).mockReturnValue([]);
  vi.mocked(rejectedDigestErrors).mockReturnValue([]);
  vi.mocked(duplicateNameErrors).mockReturnValue([]);
  vi.mocked(registrationPaths).mockResolvedValue(new Map());
  vi.mocked(immutabilityReport).mockResolvedValue({ errors: [], warnings: [] });
});

function check(extra: { recordBase?: string } = {}) {
  return checkAppRecords({
    root,
    environment: "local",
    runner,
    yqVersion: "4.54.2",
    ...extra,
  });
}

const spec = JSON.stringify({
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "Service",
  metadata: { name: "leads" },
  spec: { organization: "platform", environments: ["local"], components: {} },
});
const release = JSON.stringify({
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "ServiceRelease",
  metadata: { name: "leads" },
  spec: { commit: "a".repeat(40), components: {} },
});

test("an environment with no services directory has nothing to check, reads no schema and no base", async () => {
  expect(await check()).toEqual({ errors: [], warnings: [] });
  expect(run).not.toHaveBeenCalled();
  expect(immutabilityReport).not.toHaveBeenCalled();
});

test("each spec file is checked against the Service schema that yq reads from the chart", async () => {
  files = { [`${dir}/leads.json`]: spec };
  await check();
  expect(run).toHaveBeenCalledWith(
    "yq",
    expect.arrayContaining([
      `${root}/infra/charts/platform-apis/templates/service-xrd.yaml`,
    ]),
    expect.objectContaining({ cwd: root }),
  );
  expect(specFileErrors).toHaveBeenCalledWith({
    file: "infra/environments/local/services/leads.json",
    stem: "leads",
    manifest: JSON.parse(spec),
    xrdSpec,
  });
});

test("a missing yq names the pinned version and the mise command that installs it", async () => {
  files = { [`${dir}/leads.json`]: spec };
  vi.mocked(run).mockRejectedValueOnce(enoent());
  await expect(check()).rejects.toThrow(
    "install yq 4.54.2 with mise (mise install yq@4.54.2)",
  );
});

test("a Service XRD with no v1alpha1 spec schema is refused by name", async () => {
  files = { [`${dir}/leads.json`]: spec };
  yqStdout = "null";
  await expect(check()).rejects.toThrow("has no v1alpha1 spec schema");
});

test("a file that is neither a spec nor a release is named as not a record", async () => {
  files = { [`${dir}/notes.txt`]: "hi" };
  expect((await check()).errors).toEqual([
    "infra/environments/local/services/notes.txt: the services directory holds <service>.json (the spec file) and <service>.release.json (the release file) only",
  ]);
});

test("a dotfile in the services directory is ignored", async () => {
  files = { [`${dir}/.gitkeep`]: "" };
  expect(await check()).toEqual({ errors: [], warnings: [] });
});

test("a spec file that is not strict JSON is named, and is not checked further", async () => {
  files = { [`${dir}/leads.json`]: "{ organization: platform" };
  const report = await check();
  expect(report.errors).toEqual([
    expect.stringMatching(
      /^infra\/environments\/local\/services\/leads\.json: the record must be strict JSON/,
    ),
  ]);
  expect(specFileErrors).not.toHaveBeenCalled();
});

test("a release file is checked against the ServiceRelease schema read from the catalog", async () => {
  files = {
    [`${dir}/leads.json`]: spec,
    [`${dir}/leads.release.json`]: release,
    [`${root}/infra/catalog/schemas/service-release.schema.json`]: "{}",
  };
  await check();
  expect(readFile).toHaveBeenCalledWith(
    `${root}/infra/catalog/schemas/service-release.schema.json`,
    "utf8",
  );
  expect(releaseFileErrors).toHaveBeenCalledWith(
    expect.objectContaining({
      file: "infra/environments/local/services/leads.release.json",
      stem: "leads",
      releaseSchema: {},
    }),
  );
});

test("a release file with no spec file beside it is named, with the services directory", async () => {
  files = {
    [`${dir}/leads.release.json`]: release,
    [`${root}/infra/catalog/schemas/service-release.schema.json`]: "{}",
  };
  expect((await check()).errors).toEqual([
    "infra/environments/local/services/leads.release.json: a release file needs its spec file leads.json beside it in infra/environments/local/services",
  ]);
});

test("a release whose spec did not parse is not told it has no spec: the spec's own error stands", async () => {
  files = {
    [`${dir}/leads.json`]: "not json",
    [`${dir}/leads.release.json`]: release,
    [`${root}/infra/catalog/schemas/service-release.schema.json`]: "{}",
  };
  expect(
    (await check()).errors.some((error) =>
      error.includes("needs its spec file"),
    ),
  ).toBe(false);
});

test("a release is checked against the components its spec declares", async () => {
  files = {
    [`${dir}/leads.json`]: spec,
    [`${dir}/leads.release.json`]: release,
    [`${root}/infra/catalog/schemas/service-release.schema.json`]: "{}",
  };
  await check();
  expect(componentCrossErrors).toHaveBeenCalledWith({
    releaseFile: "infra/environments/local/services/leads.release.json",
    specFile: "infra/environments/local/services/leads.json",
    release: {},
    spec: {},
  });
});

test("a release's rejected lists are checked against the components of its own release", async () => {
  files = {
    [`${dir}/leads.json`]: spec,
    [`${dir}/leads.release.json`]: release,
    [`${root}/infra/catalog/schemas/service-release.schema.json`]: "{}",
  };
  await check();
  expect(rejectedDigestErrors).toHaveBeenCalledWith({
    file: "infra/environments/local/services/leads.release.json",
    components: {},
  });
});

test("names are unique across this environment's specs and the legacy registrations", async () => {
  files = { [`${dir}/leads.json`]: spec };
  vi.mocked(registrationPaths).mockResolvedValue(
    new Map([["checkout", "infra/services/checkout.yaml"]]),
  );
  await check();
  expect(duplicateNameErrors).toHaveBeenCalledWith([
    { name: "leads", file: "infra/environments/local/services/leads.json" },
    { name: "checkout", file: "infra/services/checkout.yaml" },
  ]);
});

test("the immutability check compares each spec file that declares an organization", async () => {
  files = { [`${dir}/leads.json`]: spec };
  await check();
  expect(immutabilityReport).toHaveBeenCalledWith({
    root,
    runner,
    recordBase: undefined,
    records: [
      {
        stem: "leads",
        file: "infra/environments/local/services/leads.json",
        organization: "platform",
      },
    ],
  });
});

test("an explicit --record-base runs the immutability check even with no spec file", async () => {
  await check({ recordBase: "release/1" });
  expect(immutabilityReport).toHaveBeenCalledWith(
    expect.objectContaining({ recordBase: "release/1", records: [] }),
  );
});

test("the immutability report's errors and warnings are returned with the record errors, de-duplicated", async () => {
  files = { [`${dir}/leads.json`]: spec };
  vi.mocked(specFileErrors).mockReturnValue(["same", "same"]);
  vi.mocked(immutabilityReport).mockResolvedValue({
    errors: ["changed"],
    warnings: ["skipped", "skipped"],
  });
  expect(await check()).toEqual({
    errors: ["same", "changed"],
    warnings: ["skipped"],
  });
});
