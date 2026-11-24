import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { checkCrossFileRules } from "./cross-file-check.js";
import { crossFileRules } from "./cross-file-rules.js";
import type { Environment } from "./types.js";

vi.mock("node:fs/promises");
vi.mock("./cross-file-rules.js");
vi.mock("./app-records.js", () => ({
  servicesDirectory: (environment: string) =>
    `infra/environments/${environment}/services`,
}));
vi.mock("./organization-records.js", () => ({
  organizationsDirectory: (environment: string) =>
    `infra/environments/${environment}/organizations`,
}));

const root = "/repo";
const environment = { name: "local" } as Environment;
const services = join(root, "infra/environments/local/services");
const organizations = join(root, "infra/environments/local/organizations");

/** The text of each file, by absolute path; a path absent here does not exist. */
let files: Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  files = {};
  vi.mocked(readdir).mockImplementation((async (path: string) => {
    const prefix = `${path}/`;
    const names = Object.keys(files)
      .filter(
        (file) =>
          file.startsWith(prefix) && !file.slice(prefix.length).includes("/"),
      )
      .map((file) => file.slice(prefix.length));
    if (names.length === 0 && path !== services && path !== organizations) {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
    return names;
  }) as never);
  vi.mocked(readFile).mockImplementation((async (path: string) => {
    if (!(path in files)) {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
    return files[path];
  }) as never);
  vi.mocked(crossFileRules).mockReturnValue({ errors: [], warnings: [] });
});

test("an environment with no services and no suborgs is checked with nothing, and reports nothing", async () => {
  const report = await checkCrossFileRules({ root, environment });
  expect(crossFileRules).toHaveBeenCalledWith({
    environment,
    organizationsDirectory: "infra/environments/local/organizations",
    services: [],
    suborgs: [],
    sizing: false,
  });
  expect(report).toEqual({ errors: [], warnings: [] });
});

test("each spec file is read as a service: its organization, grants and component requests", async () => {
  files[join(services, "checkout.json")] = JSON.stringify({
    kind: "Service",
    metadata: { name: "checkout" },
    spec: {
      organization: "team-a",
      allowFrom: ["team-a/api", 7],
      components: {
        frontend: { resources: { requests: { cpu: "500m", memory: "512Mi" } } },
        bff: {},
      },
    },
  });
  await checkCrossFileRules({ root, environment });
  expect(crossFileRules).toHaveBeenCalledWith(
    expect.objectContaining({
      services: [
        {
          file: "infra/environments/local/services/checkout.json",
          name: "checkout",
          organization: "team-a",
          allowFrom: ["team-a/api"],
          requests: [
            { component: "frontend", cpu: "500m", memory: "512Mi" },
            { component: "bff", cpu: undefined, memory: undefined },
          ],
        },
      ],
    }),
  );
});

test("release files and files that are not JSON are not services", async () => {
  files[join(services, "checkout.release.json")] = "{}";
  files[join(services, "notes.txt")] = "x";
  files[join(services, "broken.json")] = "{not json";
  files[join(services, "api.json")] = JSON.stringify({
    spec: { organization: "platform" },
  });
  await checkCrossFileRules({ root, environment });
  const read = vi.mocked(crossFileRules).mock.calls[0]?.[0].services ?? [];
  expect(read.map((service) => service.name)).toEqual(["api"]);
});

test("each suborg record is read with its quota, and a record with no quota reads as none", async () => {
  files[join(organizations, "team-a.json")] = JSON.stringify({
    kind: "Organization",
    metadata: { name: "team-a" },
    spec: {
      quota: {
        requests: { cpu: "2", memory: "4Gi" },
        pods: 10,
        storage: "10Gi",
      },
    },
  });
  files[join(organizations, "team-b.json")] = JSON.stringify({
    kind: "Organization",
    metadata: { name: "team-b" },
    spec: {},
  });
  await checkCrossFileRules({ root, environment });
  expect(crossFileRules).toHaveBeenCalledWith(
    expect.objectContaining({
      suborgs: [
        {
          name: "team-a",
          file: "infra/environments/local/organizations/team-a.json",
          quota: { cpu: "2", memory: "4Gi" },
          pods: 10,
          storage: "10Gi",
        },
        {
          name: "team-b",
          file: "infra/environments/local/organizations/team-b.json",
          quota: undefined,
        },
      ],
    }),
  );
});

test("the rules' errors and warnings are the report, unchanged", async () => {
  vi.mocked(crossFileRules).mockReturnValue({
    errors: ["a.json: refused"],
    warnings: ["the capacity is not judged"],
  });
  expect(await checkCrossFileRules({ root, environment })).toEqual({
    errors: ["a.json: refused"],
    warnings: ["the capacity is not judged"],
  });
});

test("a spec that is not valid JSON is not read as a service, and fails validation naming its file", async () => {
  files[join(services, "broken.json")] = "{not json";
  const report = await checkCrossFileRules({ root, environment });
  const read = vi.mocked(crossFileRules).mock.calls[0]?.[0].services ?? [];
  expect(read).toEqual([]);
  expect(report.errors).toEqual([
    expect.stringMatching(
      /^infra\/environments\/local\/services\/broken\.json: .*not valid JSON/,
    ),
  ]);
});

test("a suborg record that is not valid JSON still names its suborg, and fails validation naming its file", async () => {
  files[join(organizations, "team-a.json")] = "{";
  const report = await checkCrossFileRules({ root, environment });
  expect(crossFileRules).toHaveBeenCalledWith(
    expect.objectContaining({
      suborgs: [
        {
          name: "team-a",
          file: "infra/environments/local/organizations/team-a.json",
          quota: undefined,
        },
      ],
    }),
  );
  expect(report.errors).toEqual([
    expect.stringMatching(
      /^infra\/environments\/local\/organizations\/team-a\.json: .*not valid JSON/,
    ),
  ]);
});

test("a spec that cannot be read for a reason other than its absence fails the check, instead of passing unchecked", async () => {
  files[join(services, "checkout.json")] = "{}";
  vi.mocked(readFile).mockRejectedValueOnce(
    Object.assign(new Error("permission denied"), { code: "EACCES" }),
  );
  await expect(checkCrossFileRules({ root, environment })).rejects.toThrow(
    /infra\/environments\/local\/services\/checkout\.json.*permission denied.*check the file's permissions/,
  );
  expect(crossFileRules).not.toHaveBeenCalled();
});

test("a suborg record that cannot be read for an I/O reason fails the check, naming the file and the fix", async () => {
  files[join(organizations, "team-a.json")] = "{}";
  vi.mocked(readFile).mockRejectedValueOnce(
    Object.assign(new Error("input/output error"), { code: "EIO" }),
  );
  await expect(checkCrossFileRules({ root, environment })).rejects.toThrow(
    /infra\/environments\/local\/organizations\/team-a\.json.*check the file's permissions/,
  );
  expect(crossFileRules).not.toHaveBeenCalled();
});

test("a spec that is gone between listing and reading is absent, and is not a failure", async () => {
  files[join(services, "checkout.json")] = "{}";
  vi.mocked(readFile).mockRejectedValueOnce(
    Object.assign(new Error("gone"), { code: "ENOENT" }),
  );
  const report = await checkCrossFileRules({ root, environment });
  expect(crossFileRules).toHaveBeenCalledWith(
    expect.objectContaining({ services: [] }),
  );
  expect(report).toEqual({ errors: [], warnings: [] });
});
