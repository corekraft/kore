// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { platformPlan } from "../config/index.js";
import type { Environment } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  installResolver,
  isPrivateUseDomain,
  resolverState,
  resolverTarget,
  uninstallResolver,
  type ResolverHost,
} from "./resolver.js";

// The platform domain is read through the config domain's one field; the
// unit takes that field as given.
vi.mock("../config/index.js", () => ({ platformPlan: vi.fn() }));

const zonePath = "/etc/resolver/kore.internal";
const marker =
  "# Managed by kore dns install; kore dns uninstall removes this file.";
const koreContent = `${marker}\nnameserver 127.0.0.1\nport 1053\n`;

const environment = {
  name: "local",
  k3d: {
    clusterName: "kore-local",
    ports: [
      { hostAddress: "127.0.0.1", hostPort: 443, loadBalancerPort: 30443 },
      {
        hostAddress: "127.0.0.1",
        hostPort: 1053,
        loadBalancerPort: 31053,
        protocol: "tcp",
        featureFlag: "platform-dns",
      },
      {
        hostAddress: "127.0.0.1",
        hostPort: 1053,
        loadBalancerPort: 31053,
        protocol: "udp",
        featureFlag: "platform-dns",
      },
    ],
  },
} as unknown as Environment;

function fakeRunner() {
  const run = vi.fn<Runner["run"]>(async () => ({
    stdout: "",
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

function fakeHost(file: string | undefined): ResolverHost {
  return {
    read: vi.fn(async () => file),
    probe: vi.fn(async () => []),
  };
}

beforeEach(() => {
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.internal",
    organizationId: "platform",
  });
});

test("resolverTarget names the platform domain's resolver file and the platform-dns UDP port", () => {
  expect(resolverTarget(environment)).toEqual({
    path: zonePath,
    zone: "kore.internal",
    nameserver: "127.0.0.1",
    port: 1053,
    content: koreContent,
  });
});

test("resolverTarget refuses an overlay with no platform-dns UDP mapping, naming the key to add", () => {
  const withoutDns = {
    name: "local",
    k3d: { clusterName: "kore-local", ports: [] },
  } as unknown as Environment;

  expect(() => resolverTarget(withoutDns)).toThrow(
    "environment local declares no platform-dns UDP port in k3d.ports; add the loopback UDP mapping with featureFlag platform-dns (ADR 0132)",
  );
});

test("resolverState reports absent when no file exists", () => {
  const target = resolverTarget(environment);
  expect(resolverState(target, undefined)).toBe("absent");
});

test("resolverState reports current only when the content matches byte for byte", () => {
  const target = resolverTarget(environment);
  expect(resolverState(target, koreContent)).toBe("current");
  expect(resolverState(target, koreContent + "\n")).toBe("outdated");
});

test("resolverState reports outdated for a Kore file whose nameserver or port differs", () => {
  const target = resolverTarget(environment);
  const oldPort = `${marker}\nnameserver 127.0.0.1\nport 5353\n`;
  expect(resolverState(target, oldPort)).toBe("outdated");
});

test("resolverState reports foreign for a file without the Kore marker, so it is never overwritten", () => {
  const target = resolverTarget(environment);
  expect(resolverState(target, "nameserver 10.0.0.53\n")).toBe("foreign");
});

test("installResolver writes nothing and runs no elevated command when the file is already current", async () => {
  const { runner, run } = fakeRunner();
  const confirm = vi.fn(async (_question: string) => true);

  const result = await installResolver(
    environment,
    runner,
    fakeHost(koreContent),
    {
      yes: false,
      confirm,
    },
  );

  expect(result).toEqual({ status: "unchanged", path: zonePath });
  expect(confirm).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("installResolver refuses a foreign file, names its path, and runs no command", async () => {
  const { runner, run } = fakeRunner();

  await expect(
    installResolver(environment, runner, fakeHost("nameserver 10.0.0.53\n"), {
      yes: true,
    }),
  ).rejects.toThrow(
    "/etc/resolver/kore.internal exists and was not written by kore; move it aside, then run kore dns install again",
  );
  expect(run).not.toHaveBeenCalled();
});

test("installResolver shows the one file it will write and asks before any elevated command", async () => {
  const { runner, run } = fakeRunner();
  const confirm = vi.fn(async (_question: string) => true);

  await installResolver(environment, runner, fakeHost(undefined), {
    yes: false,
    confirm,
  });

  expect(confirm).toHaveBeenCalledTimes(1);
  const question = confirm.mock.calls[0]![0];
  expect(question).toContain(zonePath);
  expect(question).toContain(koreContent);
  expect(question).toContain("sudo");
  expect(run.mock.calls[0]?.[0]).toBe("sudo");
});

test("installResolver writes nothing when the confirmation is declined", async () => {
  const { runner, run } = fakeRunner();

  await expect(
    installResolver(environment, runner, fakeHost(undefined), {
      yes: false,
      confirm: async () => false,
    }),
  ).rejects.toThrow(
    "kore dns install was not confirmed; nothing was written to /etc/resolver/kore.internal",
  );
  expect(run).not.toHaveBeenCalled();
});

test("installResolver with no confirmation and no --yes refuses before any elevated command", async () => {
  const { runner, run } = fakeRunner();

  await expect(
    installResolver(environment, runner, fakeHost(undefined), { yes: false }),
  ).rejects.toThrow(
    "kore dns install needs a terminal to confirm sudo use; run it in a terminal or pass --yes",
  );
  expect(run).not.toHaveBeenCalled();
});

test("installResolver with --yes writes the file through sudo tee, creating the directory first", async () => {
  const { runner, run } = fakeRunner();

  const result = await installResolver(
    environment,
    runner,
    fakeHost(undefined),
    { yes: true },
  );

  expect(result).toEqual({ status: "installed", path: zonePath });
  expect(run.mock.calls).toEqual([
    ["sudo", ["mkdir", "-p", "/etc/resolver"], { capture: true }],
    ["sudo", ["tee", zonePath], { capture: true, input: koreContent }],
  ]);
});

test("installResolver replaces an outdated Kore file and reports it as updated", async () => {
  const { runner, run } = fakeRunner();

  const result = await installResolver(
    environment,
    runner,
    fakeHost(`${marker}\nnameserver 127.0.0.1\nport 5353\n`),
    { yes: true },
  );

  expect(result).toEqual({ status: "updated", path: zonePath });
  expect(run).toHaveBeenLastCalledWith("sudo", ["tee", zonePath], {
    capture: true,
    input: koreContent,
  });
});

test("uninstallResolver removes a Kore file through sudo rm after confirmation", async () => {
  const { runner, run } = fakeRunner();

  const result = await uninstallResolver(
    environment,
    runner,
    fakeHost(koreContent),
    { yes: true },
  );

  expect(result).toEqual({ status: "removed", path: zonePath });
  expect(run).toHaveBeenCalledWith("sudo", ["rm", "-f", "--", zonePath], {
    capture: true,
  });
});

test("uninstallResolver removes nothing from a file without the Kore marker", async () => {
  const { runner, run } = fakeRunner();

  await expect(
    uninstallResolver(environment, runner, fakeHost("nameserver 10.0.0.53\n"), {
      yes: true,
    }),
  ).rejects.toThrow(
    "/etc/resolver/kore.internal exists and was not written by kore; it is left in place",
  );
  expect(run).not.toHaveBeenCalled();
});

test("uninstallResolver does nothing when no file exists", async () => {
  const { runner, run } = fakeRunner();

  const result = await uninstallResolver(
    environment,
    runner,
    fakeHost(undefined),
    { yes: true },
  );

  expect(result).toEqual({ status: "absent", path: zonePath });
  expect(run).not.toHaveBeenCalled();
});

test("uninstallResolver removes nothing when the confirmation is declined", async () => {
  const { runner, run } = fakeRunner();

  await expect(
    uninstallResolver(environment, runner, fakeHost(koreContent), {
      yes: false,
      confirm: async () => false,
    }),
  ).rejects.toThrow(
    "kore dns uninstall was not confirmed; /etc/resolver/kore.internal is left in place",
  );
  expect(run).not.toHaveBeenCalled();
});

test("isPrivateUseDomain flags a domain under a reserved suffix as unregistered", () => {
  expect(isPrivateUseDomain("kore.internal")).toBe(true);
  expect(isPrivateUseDomain("kore.internal")).toBe(true);
  expect(isPrivateUseDomain("example.com")).toBe(false);
});

test("resolverState reports foreign when the marker is only on a later line, so a hand-written file that quotes it is never treated as Kore's", () => {
  const target = resolverTarget(environment);
  const quoted = `nameserver 10.0.0.53\n${marker}\nport 1053\n`;
  expect(resolverState(target, quoted)).toBe("foreign");
});

test("uninstallResolver removes nothing from a hand-written file whose marker is on a later line", async () => {
  const { runner, run } = fakeRunner();
  const quoted = `nameserver 10.0.0.53\n${marker}\nport 1053\n`;

  await expect(
    uninstallResolver(environment, runner, fakeHost(quoted), { yes: true }),
  ).rejects.toThrow(
    "/etc/resolver/kore.internal exists and was not written by kore; it is left in place",
  );
  expect(run).not.toHaveBeenCalled();
});
