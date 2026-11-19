// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { ClusterUnavailableError, k3dClusterInfo } from "../cluster/index.js";
import { isLocalProvider, platformPlan } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { resolverChecks } from "./checks.js";
import {
  environment,
  fakeHost,
  fakeRunner,
  target,
} from "./resolver-support.js";
import {
  isPrivateUseDomain,
  resolverState,
  resolverTarget,
} from "./resolver.js";

vi.mock("../cluster/index.js", () => ({
  k3dClusterInfo: vi.fn(),
  ClusterUnavailableError: class extends Error {},
}));
vi.mock("../config/index.js", () => ({
  platformPlan: vi.fn(),
  isLocalProvider: vi.fn(),
}));
vi.mock("./resolver.js", () => ({
  resolverTarget: vi.fn(),
  resolverState: vi.fn(),
  isPrivateUseDomain: vi.fn(),
}));

function clusterState(state: "running" | "stopped" | "absent") {
  vi.mocked(k3dClusterInfo).mockResolvedValue({
    state,
  } as unknown as Awaited<ReturnType<typeof k3dClusterInfo>>);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isLocalProvider).mockReturnValue(true);
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.internal",
    organizationId: "platform",
  });
  vi.mocked(resolverTarget).mockReturnValue(target);
  vi.mocked(resolverState).mockReturnValue("current");
  vi.mocked(isPrivateUseDomain).mockReturnValue(true);
  clusterState("absent");
});

test("probes the platform DNS for the organization's name while the cluster runs", async () => {
  clusterState("running");
  const { runner } = fakeRunner();
  const host = fakeHost(target.content, ["127.0.0.1"]);

  const findings = await resolverChecks(environment, runner, host);

  expect(host.probe).toHaveBeenCalledTimes(1);
  expect(host.probe).toHaveBeenCalledWith("platform.kore.internal", {
    address: "127.0.0.1",
    port: 1053,
  });
  expect(findings).toContainEqual({
    name: "host:platform-dns",
    status: "pass",
    required: false,
    message: "kore.internal answers on 127.0.0.1:1053",
  });
});

test("does not probe the platform DNS while the cluster is stopped, and reports no DNS finding", async () => {
  clusterState("stopped");
  const { runner } = fakeRunner();
  const host = fakeHost(target.content);

  const findings = await resolverChecks(environment, runner, host);

  expect(host.probe).not.toHaveBeenCalled();
  expect(findings.map((finding) => finding.name)).not.toContain(
    "host:platform-dns",
  );
});

test("reports an unreachable platform DNS with the error code as the named cause", async () => {
  clusterState("running");
  const { runner } = fakeRunner();
  const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });

  const findings = await resolverChecks(
    environment,
    runner,
    fakeHost(target.content, timeout),
  );

  expect(findings).toContainEqual({
    name: "host:platform-dns",
    status: "warn",
    required: false,
    message:
      "platform DNS on 127.0.0.1:1053 did not answer (ETIMEDOUT); run kore local up",
  });
});

test("reports a platform DNS that answers without the loopback address", async () => {
  clusterState("running");
  const { runner } = fakeRunner();

  const findings = await resolverChecks(
    environment,
    runner,
    fakeHost(target.content, ["10.0.0.9"]),
  );

  expect(findings).toContainEqual({
    name: "host:platform-dns",
    status: "warn",
    required: false,
    message:
      "platform DNS on 127.0.0.1:1053 answered platform.kore.internal with 10.0.0.9, not 127.0.0.1",
  });
});

test("treats a cluster the listing cannot reach as not running, so no probe is sent", async () => {
  vi.mocked(k3dClusterInfo).mockRejectedValue(
    new CommandError("k3d", ["node", "list"], {
      stdout: "",
      stderr: "k3d unavailable",
      code: 1,
    }),
  );
  const { runner } = fakeRunner();
  const host = fakeHost(target.content);

  const findings = await resolverChecks(environment, runner, host);

  expect(host.probe).not.toHaveBeenCalled();
  expect(findings.map((finding) => finding.name)).not.toContain(
    "host:platform-dns",
  );
});

test("rethrows a cluster listing failure that is not a command failure", async () => {
  vi.mocked(k3dClusterInfo).mockRejectedValue(new TypeError("bad overlay"));
  const { runner } = fakeRunner();

  await expect(
    resolverChecks(environment, runner, fakeHost(target.content)),
  ).rejects.toThrow("bad overlay");
});

test("treats a cluster whose k3d is missing as not running, so no probe is sent and doctor's tool check names the cause", async () => {
  vi.mocked(k3dClusterInfo).mockRejectedValue(
    new ClusterUnavailableError("k3d is not available"),
  );
  const { runner } = fakeRunner();
  const host = fakeHost(target.content);

  const findings = await resolverChecks(environment, runner, host);

  expect(host.probe).not.toHaveBeenCalled();
  expect(findings.map((finding) => finding.name)).not.toContain(
    "host:platform-dns",
  );
});
