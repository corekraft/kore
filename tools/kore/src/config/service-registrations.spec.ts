import { readdir, readFile } from "node:fs/promises";
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled } from "./features.js";
import {
  loadServiceRegistrations,
  registeredServiceHelmArgs,
} from "./service-registrations.js";

vi.mock("node:fs/promises");
// featureEnabled is a helper of this domain, so it is mocked; the flag constant stays real.
vi.mock("./features.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./features.js")>()),
  featureEnabled: vi.fn(),
}));

/** The text of each registration file, keyed by its path under the repository root. */
let files: Record<string, string> = {};

function registration(name: string, kind = "Service"): string {
  return JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind,
    metadata: { name },
    spec: { organization: "platform", environments: ["local"] },
  });
}

beforeEach(() => {
  files = {};
  vi.mocked(featureEnabled).mockClear();
  vi.mocked(readdir).mockImplementation(async () => {
    const error = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    if (Object.keys(files).length === 0) {
      throw error;
    }
    return Object.keys(files).map((path) => path.split("/").at(-1)!) as never;
  });
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = files[path as string];
    if (text === undefined) {
      throw Object.assign(new Error(`ENOENT ${path as string}`), {
        code: "ENOENT",
      });
    }
    return text;
  });
});

test("the derived names are exactly the registered Service names, sorted, with no name from a file that is not a registration", async () => {
  files = {
    "/repo/infra/services/shop.yaml": registration("shop"),
    "/repo/infra/services/blog.yaml": registration("blog"),
    "/repo/infra/services/notes.txt": "not a registration",
  };
  expect(await loadServiceRegistrations("/repo")).toEqual(["blog", "shop"]);
});

test("with no registrations directory the derived list is empty, so the profile still converges", async () => {
  expect(await loadServiceRegistrations("/repo")).toEqual([]);
});

test("a registration whose name is not a DNS label fails, naming the file", async () => {
  files = { "/repo/infra/services/Shop_1.yaml": registration("Shop_1") };
  await expect(loadServiceRegistrations("/repo")).rejects.toThrow(
    "infra/services/Shop_1.yaml: the registered Service name Shop_1 must be a DNS label of 61 characters or fewer, lowercase letters, digits and single hyphens",
  );
});

test("a registration whose name holds a double hyphen fails, naming the file", async () => {
  files = { "/repo/infra/services/a--b.yaml": registration("a--b") };
  await expect(loadServiceRegistrations("/repo")).rejects.toThrow(
    "infra/services/a--b.yaml: the registered Service name a--b must be a DNS label",
  );
});

test("two registrations with the same name fail, naming both files", async () => {
  files = {
    "/repo/infra/services/shop.yaml": registration("shop"),
    "/repo/infra/services/shop-copy.yaml": registration("shop"),
  };
  await expect(loadServiceRegistrations("/repo")).rejects.toThrow(
    "infra/services/shop.yaml: the registered Service name shop is already registered in infra/services/shop-copy.yaml",
  );
});

test("a registration that is not a Service manifest fails, naming the file", async () => {
  files = { "/repo/infra/services/shop.yaml": registration("shop", "Bucket") };
  await expect(loadServiceRegistrations("/repo")).rejects.toThrow(
    "infra/services/shop.yaml: a registration must be a Service manifest (kind Service)",
  );
});

test("a registration that is not JSON-compatible YAML fails, naming the file", async () => {
  files = { "/repo/infra/services/shop.yaml": "kind: Service" };
  await expect(loadServiceRegistrations("/repo")).rejects.toThrow(
    "infra/services/shop.yaml: registrations must use JSON-compatible YAML",
  );
});

test("with platform-portal on, the observability chart is handed the names, asking the flag of the environment", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  const environment = { features: { "platform-portal": true } };
  expect(
    registeredServiceHelmArgs(environment, "kore-service-observability", [
      "blog",
      "shop",
    ]),
  ).toEqual(["--set-json", 'services=["blog","shop"]']);
  expect(
    registeredServiceHelmArgs(environment, "kore-service-observability", []),
  ).toEqual(["--set-json", "services=[]"]);
  expect(vi.mocked(featureEnabled).mock.calls).toEqual([
    [environment, "platform-portal"],
    [environment, "platform-portal"],
  ]);
});

test("with platform-portal off, the observability chart is handed no names", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  const environment = { features: { "platform-portal": false } };
  expect(
    registeredServiceHelmArgs(environment, "kore-service-observability", [
      "shop",
    ]),
  ).toEqual([]);
  expect(vi.mocked(featureEnabled).mock.calls).toEqual([
    [environment, "platform-portal"],
  ]);
});

test("any other component gets no names, and the flag is never consulted for it", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(
    registeredServiceHelmArgs(
      { features: { "platform-portal": true } },
      "grafana",
      ["shop"],
    ),
  ).toEqual([]);
  expect(vi.mocked(featureEnabled)).not.toHaveBeenCalled();
});
