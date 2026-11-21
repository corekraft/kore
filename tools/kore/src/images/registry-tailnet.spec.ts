// Docs: docs/decisions/0143-the-controller-reaches-a-managed-registry-through-a-forward-over-the-tailnet.md
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { featureEnabled, registryPlan } from "../config/index.js";
import { fakeRepository, fakeRunner } from "./images-support.js";
import {
  readForwardOwner,
  recordForwardOwner,
} from "./registry-forward-owner.js";
import { hostRegistryAddress } from "./registry-name.js";
import {
  localRegistryReference,
  reachedThroughForward,
  tailnetForwardApplies,
} from "./registry.js";
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

test("with the tailnet forward on, an open forward with no recorded owner is used and reported as unowned", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(registryPlan).mockReturnValue(inCluster);
  vi.mocked(readForwardOwner).mockResolvedValue(undefined);
  const lines: string[] = [];

  await expect(
    localRegistryReference(
      vpsRepository,
      fakeRunner().runner,
      "10.43.0.50:5000/reference:dev",
      {
        isPortOpen: async () => true,
        report: (line) => void lines.push(line),
      },
    ),
  ).resolves.toBe("127.0.0.1:30500/reference:dev");

  expect(readForwardOwner).toHaveBeenCalledWith("kore-vps");
  expect(lines).toEqual([
    "registry port-forward on 127.0.0.1:30500 for context kore-vps is already running with no owner recorded, so this run uses it but does not own it; any worktree's stop can end it mid-build",
  ]);
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

const mirrorReference = "ghcr.io/corekraft/kore/mirror/app@sha256:abc";

test("a reference outside the in-cluster registry, such as a release mirror image, is returned unchanged and starts no forward even with the flag on", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(registryPlan).mockReturnValue(inCluster);
  const spawnPortForward = vi.fn(() => 1234);
  const isPortOpen = vi.fn(async () => true);

  await expect(
    localRegistryReference(
      vpsRepository,
      fakeRunner().runner,
      mirrorReference,
      {
        isPortOpen,
        spawnPortForward,
      },
    ),
  ).resolves.toBe(mirrorReference);

  expect(spawnPortForward).not.toHaveBeenCalled();
  expect(isPortOpen).not.toHaveBeenCalled();
});

test("only a reference in the in-cluster registry is reached through the forward, and only with the flag on", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(registryPlan).mockReturnValue(inCluster);
  expect(
    reachedThroughForward(vpsRepository, "10.43.0.50:5000/reference:dev"),
  ).toBe(true);
  expect(reachedThroughForward(vpsRepository, mirrorReference)).toBe(false);

  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(
    reachedThroughForward(vpsRepository, "10.43.0.50:5000/reference:dev"),
  ).toBe(false);
});
