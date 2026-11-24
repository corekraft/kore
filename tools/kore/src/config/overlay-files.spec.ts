import { readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { exists } from "./files.js";
import { suborgNames } from "./organization-records.js";
import {
  loadImageTrustValues,
  loadJSON,
  loadRegistryComponentValues,
  loadSuborgNames,
} from "./overlay-files.js";
import type { Environment } from "./types.js";

vi.mock("node:fs/promises");
vi.mock("node:path", () => ({
  join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
}));
vi.mock("./files.js", () => ({ exists: vi.fn() }));
vi.mock("./organization-records.js", () => ({ suborgNames: vi.fn() }));
vi.mock("./registry-address.js", () => ({
  registryConsumers: ["oci-registry", "kore-image-policy"],
}));

/** The text of each file read in a test; a missing path is absent. */
let files: Record<string, string> = {};
/** The paths that exist. */
let present: string[] = [];

beforeEach(() => {
  files = {};
  present = [];
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = files[path as string];
    if (text === undefined) {
      throw Object.assign(new Error(`ENOENT ${path as string}`), {
        code: "ENOENT",
      });
    }
    return text;
  });
  vi.mocked(exists).mockImplementation(async (path) => present.includes(path));
});

const environmentWith = (
  componentValues: Record<string, string[]>,
): Environment => ({ componentValues }) as Environment;

test("a JSON-compatible file is parsed, and an unreadable one fails naming the file and the format rule", async () => {
  files["/repo/infra/catalog/seeds.yaml"] = '{"seeds":[]}';
  expect(await loadJSON("/repo/infra/catalog/seeds.yaml")).toEqual({
    seeds: [],
  });
  files["/repo/infra/catalog/bad.yaml"] = "seeds: [unclosed";
  await expect(loadJSON("/repo/infra/catalog/bad.yaml")).rejects.toThrow(
    /^validate \/repo\/infra\/catalog\/bad\.yaml: files must use JSON-compatible YAML/,
  );
});

test("the image trust overlay is read only when the environment names an existing file", async () => {
  files["/repo/infra/trust/local.json"] = '{"trust":{"type":"key"}}';
  present = ["/repo/infra/trust/local.json"];
  expect(
    await loadImageTrustValues(
      "/repo",
      environmentWith({ "kore-image-policy": ["infra/trust/local.json"] }),
    ),
  ).toEqual({ trust: { type: "key" } });
  expect(
    await loadImageTrustValues("/repo", environmentWith({})),
  ).toBeUndefined();
});

test("a missing image trust overlay is left to validation, not read", async () => {
  expect(
    await loadImageTrustValues(
      "/repo",
      environmentWith({ "kore-image-policy": ["infra/trust/gone.json"] }),
    ),
  ).toBeUndefined();
  expect(vi.mocked(readFile)).not.toHaveBeenCalled();
});

test("a registry consumer's existing overlays are merged in order, later files winning, and only consumers are read", async () => {
  files["/repo/infra/a.json"] = '{"port":5000,"host":"a"}';
  files["/repo/infra/b.json"] = '{"host":"b"}';
  files["/repo/infra/other.json"] = '{"x":1}';
  present = ["/repo/infra/a.json", "/repo/infra/b.json"];
  expect(
    await loadRegistryComponentValues(
      "/repo",
      environmentWith({
        "oci-registry": ["infra/a.json", "infra/missing.json", "infra/b.json"],
        "not-a-consumer": ["infra/other.json"],
      }),
    ),
  ).toEqual({ "oci-registry": { port: 5000, host: "b" } });
});

test("loadSuborgNames hands the root, the environment and the catalog's namespaces to the record reader, and returns the names it gives", async () => {
  vi.mocked(suborgNames).mockResolvedValue(["reference"]);
  const environment = environmentWith({});
  expect(await loadSuborgNames("/repo", environment, ["kore-system"])).toEqual([
    "reference",
  ]);
  expect(vi.mocked(suborgNames).mock.calls).toEqual([
    [
      {
        root: "/repo",
        environment,
        catalogNamespaces: ["kore-system"],
      },
    ],
  ]);
});
