// Docs: docs/decisions/0058-registry-transport-tls.md
import { expect, test, vi } from "vitest";
import { registryPlan } from "../config/index.js";
import { fakeRepository, fakeRunner } from "./images-support.js";
import { verifiedRegistryAddress } from "./registry-service.js";

vi.mock("../config/index.js");

const kubectlLookup = [
  "--context",
  "k3d-kore-local",
  "--namespace",
  "kore-registry",
  "get",
  "service",
  "oci-registry",
  "--output=jsonpath={.spec.clusterIP}",
];

test("an external registry address is returned without asking the cluster", async () => {
  vi.mocked(registryPlan).mockReturnValue({
    address: "registry.example.com:443",
  } as never);
  const { runner, run } = fakeRunner();

  await expect(verifiedRegistryAddress(fakeRepository(), runner)).resolves.toBe(
    "registry.example.com:443",
  );
  expect(run).not.toHaveBeenCalled();
});

test("a Service that answers at the pinned clusterIP returns the configured address", async () => {
  vi.mocked(registryPlan).mockReturnValue({
    address: "10.96.0.50:5000",
    clusterIP: "10.96.0.50",
  } as never);
  const { runner, run } = fakeRunner(() => "10.96.0.50\n");

  await expect(verifiedRegistryAddress(fakeRepository(), runner)).resolves.toBe(
    "10.96.0.50:5000",
  );
  expect(run.mock.calls).toEqual([
    ["kubectl", kubectlLookup, { capture: true }],
  ]);
});

test("an absent Service is reported with the platform command that creates it", async () => {
  vi.mocked(registryPlan).mockReturnValue({
    address: "10.96.0.50:5000",
    clusterIP: "10.96.0.50",
  } as never);
  const { runner } = fakeRunner(() => "");

  await expect(
    verifiedRegistryAddress(fakeRepository(), runner),
  ).rejects.toThrow(
    "local OCI registry Service oci-registry has no ClusterIP in kore-registry; run `kore platform up --env local` to create it at registry.address 10.96.0.50:5000",
  );
});

test("a Service on another clusterIP names the delete that recreates it, and the address it expects", async () => {
  vi.mocked(registryPlan).mockReturnValue({
    address: "10.96.0.50:5000",
    clusterIP: "10.96.0.50",
  } as never);
  const { runner } = fakeRunner(() => "10.99.1.2");

  const message = await verifiedRegistryAddress(fakeRepository(), runner).then(
    () => "",
    (caught: unknown) => (caught instanceof Error ? caught.message : ""),
  );

  expect(message).toBe(
    "local OCI registry Service answers at 10.99.1.2 but registry.address 10.96.0.50:5000 in environment local expects 10.96.0.50; a Service's clusterIP cannot change in place, so delete it with `kubectl --context k3d-kore-local --namespace kore-registry delete service oci-registry` (the Deployment and stored images are kept), then run `kore platform up --env local` to recreate it at the configured address",
  );
});
