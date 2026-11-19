// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { k3dClusterInfo } from "../cluster/index.js";
import { isLocalProvider, platformPlan } from "../config/index.js";
import type { Environment } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { resolverChecks } from "./checks.js";
import {
  isPrivateUseDomain,
  resolverState,
  resolverTarget,
  type ResolverHost,
  type ResolverTarget,
} from "./resolver.js";

// Each collaborator has behaviour of its own, so the unit takes its answers.
vi.mock("../cluster/index.js", () => ({ k3dClusterInfo: vi.fn() }));
vi.mock("../config/index.js", () => ({
  platformPlan: vi.fn(),
  isLocalProvider: vi.fn(),
}));
vi.mock("./resolver.js", () => ({
  resolverTarget: vi.fn(),
  resolverState: vi.fn(),
  isPrivateUseDomain: vi.fn(),
}));

const environment = { name: "local" } as unknown as Environment;
const target: ResolverTarget = {
  path: "/etc/resolver/kore.internal",
  zone: "kore.internal",
  nameserver: "127.0.0.1",
  port: 1053,
  content: "# Managed by kore dns install\nnameserver 127.0.0.1\nport 1053\n",
};

function fakeRunner() {
  const run = vi.fn<Runner["run"]>(async () => ({
    stdout: "",
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

function fakeHost(
  file: string | undefined,
  answer: string[] | Error = ["127.0.0.1"],
): ResolverHost & {
  read: ReturnType<typeof vi.fn>;
  probe: ReturnType<typeof vi.fn>;
} {
  return {
    read: vi.fn(async () => file),
    probe: vi.fn(async () => {
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    }),
  };
}

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

test("passes the file check when the resolver file is current, and only reads it", async () => {
  const { runner, run } = fakeRunner();
  const host = fakeHost(target.content);

  const findings = await resolverChecks(environment, runner, host);

  expect(findings[0]).toEqual({
    name: "host:resolver",
    status: "pass",
    required: false,
    message:
      "/etc/resolver/kore.internal sends kore.internal to 127.0.0.1:1053",
  });
  expect(host.read).toHaveBeenCalledWith("/etc/resolver/kore.internal");
  expect(run).not.toHaveBeenCalled();
});

test("warns that a missing resolver file needs kore dns install for this environment", async () => {
  vi.mocked(resolverState).mockReturnValue("absent");
  const { runner } = fakeRunner();

  const findings = await resolverChecks(
    environment,
    runner,
    fakeHost(undefined),
  );

  expect(findings[0]).toEqual({
    name: "host:resolver",
    status: "warn",
    required: false,
    message:
      "/etc/resolver/kore.internal is missing; run kore dns install --environment local",
  });
});

test("warns that an out-of-date resolver file differs from what the environment expects", async () => {
  vi.mocked(resolverState).mockReturnValue("outdated");
  const { runner } = fakeRunner();

  const findings = await resolverChecks(environment, runner, fakeHost("old"));

  expect(findings[0]).toEqual({
    name: "host:resolver",
    status: "warn",
    required: false,
    message:
      "/etc/resolver/kore.internal differs from what environment local expects; run kore dns install --environment local",
  });
});

test("warns about a file kore did not write and leaves it alone, naming the move-aside step", async () => {
  vi.mocked(resolverState).mockReturnValue("foreign");
  const { runner } = fakeRunner();

  const findings = await resolverChecks(
    environment,
    runner,
    fakeHost("nameserver 10.0.0.53\n"),
  );

  expect(findings[0]).toEqual({
    name: "host:resolver",
    status: "warn",
    required: false,
    message:
      "/etc/resolver/kore.internal was not written by kore; move it aside, then run kore dns install --environment local",
  });
});

test("reports an overlay without a platform-dns mapping as a warning instead of failing doctor", async () => {
  vi.mocked(resolverTarget).mockImplementation(() => {
    throw new Error("environment local declares no platform-dns UDP port");
  });
  const { runner } = fakeRunner();
  const host = fakeHost(undefined);

  const findings = await resolverChecks(environment, runner, host);

  expect(findings[0]).toEqual({
    name: "host:resolver",
    status: "warn",
    required: false,
    message: "environment local declares no platform-dns UDP port",
  });
  expect(host.read).not.toHaveBeenCalled();
});

test("warns that a private-use domain's names resolve only on this host", async () => {
  const { runner } = fakeRunner();

  const findings = await resolverChecks(
    environment,
    runner,
    fakeHost(target.content),
  );

  expect(findings).toContainEqual({
    name: "host:platform-domain",
    status: "warn",
    required: false,
    message:
      "kore.internal is not registered in public DNS, so its names resolve only on this host",
  });
});

test("passes the domain check for a name that is not private-use", async () => {
  vi.mocked(isPrivateUseDomain).mockReturnValue(false);
  const { runner } = fakeRunner();

  const findings = await resolverChecks(
    environment,
    runner,
    fakeHost(target.content),
  );

  expect(findings).toContainEqual({
    name: "host:platform-domain",
    status: "pass",
    required: false,
    message: "kore.internal is not a private-use name",
  });
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

test("adds no resolver finding for a managed environment, which has no local resolver file", async () => {
  vi.mocked(isLocalProvider).mockReturnValue(false);
  const { runner, run } = fakeRunner();
  const host = fakeHost(undefined);

  await expect(resolverChecks(environment, runner, host)).resolves.toEqual([]);
  expect(host.read).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("rethrows a cluster listing failure that is not a command failure", async () => {
  vi.mocked(k3dClusterInfo).mockRejectedValue(new TypeError("bad overlay"));
  const { runner } = fakeRunner();

  await expect(
    resolverChecks(environment, runner, fakeHost(target.content)),
  ).rejects.toThrow("bad overlay");
});
