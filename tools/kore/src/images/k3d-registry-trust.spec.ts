import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import {
  k3dTrustDirectory,
  k3dTrustVolumeArgs,
  k3sRegistriesYaml,
  writeK3dRegistriesConfig,
  writeK3dRegistryCa,
} from "./k3d-registry-trust.js";

vi.mock("node:fs/promises");
vi.mock("node:os");
vi.mock("node:path");

beforeEach(() => {
  // The unit builds path segments; a join that keeps its slashes lets the
  // assertions read the path the unit asked for.
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

test("the trust directory sits under the user's kore home, one per cluster", () => {
  expect(k3dTrustDirectory("kore-local", "/home/dev")).toBe(
    "/home/dev/.kore/k3d/kore-local/registry-trust",
  );
});

test("the trust directory defaults to the home directory of the user", () => {
  vi.mocked(homedir).mockReturnValue("/home/dev");

  expect(k3dTrustDirectory("kore-local")).toBe(
    "/home/dev/.kore/k3d/kore-local/registry-trust",
  );
  expect(homedir).toHaveBeenCalledOnce();
});

test("the node registry configuration verifies TLS against the mounted CA and never skips it", () => {
  const yaml = k3sRegistriesYaml("10.96.0.50:5000");

  expect(yaml).toBe(
    [
      "configs:",
      `  "10.96.0.50:5000":`,
      "    tls:",
      "      ca_file: /etc/kore/registry-ca/ca.crt",
      "",
    ].join("\n"),
  );
  expect(yaml).not.toMatch(/insecure_skip_verify|mirrors:/);
});

test("the registries file is written into the trust directory after the directory exists", async () => {
  await writeK3dRegistriesConfig("/trust", "10.96.0.50:5000");

  expect(mkdir).toHaveBeenCalledWith("/trust", { recursive: true });
  expect(writeFile).toHaveBeenCalledWith(
    "/trust/registries.yaml",
    k3sRegistriesYaml("10.96.0.50:5000"),
  );
  expect(vi.mocked(mkdir).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(writeFile).mock.invocationCallOrder[0] ?? 0,
  );
});

test("the CA is written beside a temporary name and renamed into place, so a node never reads half of it", async () => {
  await writeK3dRegistryCa("/trust", "PEM");

  expect(writeFile).toHaveBeenCalledWith("/trust/ca.crt.tmp", "PEM");
  expect(rename).toHaveBeenCalledWith("/trust/ca.crt.tmp", "/trust/ca.crt");
  expect(vi.mocked(writeFile).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(rename).mock.invocationCallOrder[0] ?? 0,
  );
});

test("cluster creation mounts the trust directory as the node CA directory and the registries file as k3s's", () => {
  expect(k3dTrustVolumeArgs("/trust")).toEqual([
    "--volume",
    "/trust:/etc/kore/registry-ca@all",
    "--volume",
    "/trust/registries.yaml:/etc/rancher/k3s/registries.yaml@all",
  ]);
});
