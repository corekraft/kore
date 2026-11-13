import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { RecordingRunner } from "../runtime/index.js";
import { verifiedRegistryAddress } from "./registry-service.js";

const lookup = (stdout: string) => ({ stdout, stderr: "", code: 0 });

test("a registry Service on another clusterIP names the Service delete that works on k3d", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([lookup("10.99.1.2")]);

  const message = await verifiedRegistryAddress(repository, runner).then(
    () => "",
    (caught: unknown) => (caught instanceof Error ? caught.message : ""),
  );

  expect(message).toContain("10.99.1.2");
  expect(message).toContain("10.96.0.50:5000");
  expect(message).toContain(
    "kubectl --context k3d-kore-local --namespace kore-registry delete service oci-registry",
  );
  expect(message).toContain("kore platform up");
  expect(runner.calls).toHaveLength(1);
});

test("a registry Service on the pinned clusterIP answers with the address", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([lookup("10.96.0.50")]);

  await expect(verifiedRegistryAddress(repository, runner)).resolves.toBe(
    "10.96.0.50:5000",
  );
});

test("an absent registry Service is reported with the command that creates it", async () => {
  const repository = await loadRepository("local");
  const runner = new RecordingRunner([lookup("")]);

  await expect(verifiedRegistryAddress(repository, runner)).rejects.toThrow(
    /kore platform up --env local/,
  );
});

test("an external registry address is never checked against a Service", async () => {
  const repository = await loadRepository("managed-example");
  const runner = new RecordingRunner();

  await verifiedRegistryAddress(repository, runner);

  expect(runner.calls).toHaveLength(0);
});
