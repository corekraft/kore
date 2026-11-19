// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { k3dClusterInfo } from "../cluster/index.js";
import { isLocalProvider, platformPlan } from "../config/index.js";
import { resolverChecks } from "./checks.js";
import {
  environment,
  errno,
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

test("adds no resolver finding for a managed environment, which has no local resolver file", async () => {
  vi.mocked(isLocalProvider).mockReturnValue(false);
  const { runner, run } = fakeRunner();
  const host = fakeHost(undefined);

  await expect(resolverChecks(environment, runner, host)).resolves.toEqual([]);
  expect(host.read).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("warns with the path and error code when the resolver file cannot be read, and still runs the other checks", async () => {
  const { runner } = fakeRunner();

  const findings = await resolverChecks(
    environment,
    runner,
    fakeHost(errno("EACCES")),
  );

  expect(findings[0]).toEqual({
    name: "host:resolver",
    status: "warn",
    required: false,
    message:
      "/etc/resolver/kore.internal could not be read (EACCES); check its permissions",
  });
  expect(findings).toContainEqual(
    expect.objectContaining({ name: "host:platform-domain" }),
  );
});

test("rethrows a read failure that carries no error code, since it is not an expected unreadable file", async () => {
  const { runner } = fakeRunner();

  await expect(
    resolverChecks(environment, runner, fakeHost(new Error("disk on fire"))),
  ).rejects.toThrow("disk on fire");
});
