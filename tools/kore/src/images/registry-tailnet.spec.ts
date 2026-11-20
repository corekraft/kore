// Docs: docs/decisions/0143-the-controller-reaches-a-managed-registry-through-a-forward-over-the-tailnet.md
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, registryPlan } from "../config/index.js";
import { fakeRepository, fakeRunner } from "./images-support.js";
import { recordForwardOwner } from "./registry-forward-owner.js";
import { hostRegistryAddress } from "./registry-name.js";
import { localRegistryReference, tailnetForwardApplies } from "./registry.js";
import { loadRegistryCa } from "./registry-tls.js";

vi.mock("../config/index.js");
vi.mock("./registry-name.js");
vi.mock("./registry-forward-owner.js");
vi.mock("./registry-tls.js");

const vpsRepository = fakeRepository({
  name: "vps",
  provider: "managed",
  kubeContext: "kore-vps",
  registry: { address: "10.43.0.50:5000" },
});
const inCluster = {
  address: "10.43.0.50:5000",
  host: "10.43.0.50",
  port: "5000",
  clusterIP: "10.43.0.50",
};

beforeEach(() => {
  vi.mocked(hostRegistryAddress).mockReturnValue("127.0.0.1:30500");
  vi.mocked(loadRegistryCa).mockResolvedValue("ca-pem");
});

afterEach(() => {
  vi.useRealTimers();
});

test("with registry-tailnet-forward on, a managed in-cluster registry is reached through a forward on its own context and the reference points at the forward", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(registryPlan).mockReturnValue(inCluster);
  const spawnPortForward = vi.fn(() => 1234);
  const answers = [false, true];

  await expect(
    localRegistryReference(
      vpsRepository,
      fakeRunner().runner,
      "10.43.0.50:5000/reference:dev",
      {
        isPortOpen: async () => answers.shift() ?? true,
        spawnPortForward,
      },
    ),
  ).resolves.toBe("127.0.0.1:30500/reference:dev");

  expect(spawnPortForward).toHaveBeenCalledExactlyOnceWith(vpsRepository);
  expect(recordForwardOwner).toHaveBeenCalledExactlyOnceWith(
    vpsRepository,
    1234,
  );
});

test("with registry-tailnet-forward off, a managed in-cluster registry keeps its reference and starts no forward", async () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  vi.mocked(registryPlan).mockReturnValue(inCluster);
  const spawnPortForward = vi.fn(() => 1234);
  const isPortOpen = vi.fn(async () => false);

  await expect(
    localRegistryReference(
      vpsRepository,
      fakeRunner().runner,
      "10.43.0.50:5000/reference:dev",
      { isPortOpen, spawnPortForward },
    ),
  ).resolves.toBe("10.43.0.50:5000/reference:dev");

  expect(spawnPortForward).not.toHaveBeenCalled();
  expect(isPortOpen).not.toHaveBeenCalled();
});

test("with registry-tailnet-forward on, an external registry at a hostname starts no forward and keeps its reference", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(registryPlan).mockReturnValue({
    address: "registry.example.internal",
    host: "registry.example.internal",
  });
  const spawnPortForward = vi.fn(() => 1234);

  await expect(
    localRegistryReference(
      vpsRepository,
      fakeRunner().runner,
      "registry.example.internal/reference:dev",
      { isPortOpen: async () => false, spawnPortForward },
    ),
  ).resolves.toBe("registry.example.internal/reference:dev");

  expect(spawnPortForward).not.toHaveBeenCalled();
});

test("the tailnet forward applies only to a managed environment with an in-cluster registry behind its flag", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(registryPlan).mockReturnValue(inCluster);
  expect(tailnetForwardApplies(vpsRepository)).toBe(true);

  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(tailnetForwardApplies(vpsRepository)).toBe(false);
});
