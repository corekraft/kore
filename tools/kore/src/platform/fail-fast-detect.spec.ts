// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { expect, test } from "vitest";
import { CommandError } from "../runtime/index.js";
import { findings } from "./fail-fast-detect.js";
import { runnerFake } from "./gate-unit-support.js";

const base = ["--context", "k3d-kore-local", "--namespace", "registry-ns"];
const SANDBOX_HINT =
  "Check resources.limits, runtime class, CNI, or volume mounts (a too-low memory limit OOM-kills the sandbox).";

/** A scheduled pod whose one container reports `containerStatuses`. */
function podOf(name: string, containerStatuses: unknown[], extra = {}) {
  return {
    metadata: { name, labels: { "app.kubernetes.io/instance": "registry" } },
    spec: { nodeName: "node-1" },
    status: { phase: "Running", containerStatuses, ...extra },
  };
}

const waitingIn = (reason: string, message = "", restartCount = 0) => ({
  name: "registry",
  restartCount,
  state: { waiting: { reason, message } },
});

/** A cluster that lists `pods` for `get pods` and `events` for `get events`. */
function cluster(pods: unknown[], events: unknown[] = []) {
  return runnerFake((_command, args) => ({
    stdout: JSON.stringify({ items: args.includes("pods") ? pods : events }),
    stderr: "",
    code: 0,
  }));
}

function sandboxEvent(name: string, message: string, count = 1) {
  return {
    reason: "FailedCreatePodSandBox",
    message,
    count,
    lastTimestamp: "2026-11-14T00:00:01Z",
    involvedObject: { kind: "Pod", name },
  };
}

test("a container that crash-loops twice is named with its restart count, and asks for its previous logs", async () => {
  const { runner } = cluster([
    podOf("registry-1", [
      {
        ...waitingIn("CrashLoopBackOff", "", 2),
        lastState: {
          terminated: { reason: "Error", exitCode: 1, message: "boom" },
        },
      },
    ]),
  ]);

  const [found] = await findings(runner, base, "registry");

  expect(found).toEqual({
    key: "registry-1/registry/CrashLoopBackOff",
    pod: "registry-1",
    subject: "container registry",
    state: "CrashLoopBackOff (2 restarts)",
    detail: 'last exit: Error, exit 1 "boom"',
    logs: { container: "registry" },
    hint: "Check the container's ports and env, then its args and mounts.",
    persists: false,
  });
});

test("a single crash is not yet a finding, so a restart that recovers is never fatal", async () => {
  const { runner } = cluster([
    podOf("registry-1", [waitingIn("CrashLoopBackOff", "", 1)]),
  ]);

  await expect(findings(runner, base, "registry")).resolves.toEqual([]);
});

test("an image pull or config error persists, quotes the kubelet's message, and gives the fix", async () => {
  const { runner } = cluster([
    podOf("registry-1", [
      waitingIn("CreateContainerConfigError", "secret registry-tls not found"),
    ]),
  ]);

  const [found] = await findings(runner, base, "registry");

  expect(found).toMatchObject({
    state: "CreateContainerConfigError",
    detail: "secret registry-tls not found",
    persists: true,
    hint: "Check the referenced Secrets, ConfigMaps, and env keys exist.",
  });
});

test("an init container's fatal state is named as an init container", async () => {
  const { runner } = cluster([
    {
      ...podOf("registry-1", []),
      status: {
        phase: "Pending",
        initContainerStatuses: [waitingIn("ErrImagePull", "not found")],
      },
    },
  ]);

  const [found] = await findings(runner, base, "registry");

  expect(found?.subject).toBe("init container registry");
});

test("a pod stuck in ContainerCreating with a sandbox failure is named with its event and the repeat count", async () => {
  const pod = podOf("registry-1", [waitingIn("ContainerCreating")]);
  const { runner } = cluster(
    [pod],
    [sandboxEvent("registry-1", "failed to create sandbox", 3)],
  );

  const [found] = await findings(runner, base, "registry");

  expect(found).toEqual({
    key: "registry-1/FailedCreatePodSandBox",
    pod: "registry-1",
    subject: "creating",
    where: "pod registry-1 is stuck in ContainerCreating",
    state: "FailedCreatePodSandBox (x3)",
    detail: '"failed to create sandbox"',
    hint: SANDBOX_HINT,
    persists: true,
    slow: false,
  });
});

test("a lone sandbox failure is a slow finding, given 1.5 times the grace period", async () => {
  const { runner } = cluster(
    [podOf("registry-1", [waitingIn("ContainerCreating")])],
    [sandboxEvent("registry-1", "failed to create sandbox")],
  );

  const [found] = await findings(runner, base, "registry");

  expect(found).toMatchObject({ state: "FailedCreatePodSandBox", slow: true });
});

test("a sandbox message keeps its head and tail, drops per-attempt IDs, and collapses whitespace", async () => {
  const id = "a".repeat(64);
  const long = `sandbox ${id}  ${"x".repeat(500)} END`;
  const { runner } = cluster(
    [podOf("registry-1", [waitingIn("ContainerCreating")])],
    [sandboxEvent("registry-1", long)],
  );

  const [found] = await findings(runner, base, "registry");

  expect(found?.detail).toMatch(/^"sandbox <id> x+ … x+ END"$/);
  expect(found?.detail).not.toContain(id);
});

test("an unscheduled pod with a FailedScheduling event persists as a scheduling finding", async () => {
  const pending = {
    metadata: { name: "registry-2", labels: {} },
    status: { phase: "Pending" },
  };
  const { runner } = cluster(
    [pending],
    [
      {
        reason: "FailedScheduling",
        message: "0/1 nodes are available",
        involvedObject: { kind: "Pod", name: "registry-2" },
      },
    ],
  );

  const [found] = await findings(runner, base, "registry");

  expect(found).toEqual({
    key: "registry-2/FailedScheduling",
    pod: "registry-2",
    subject: "scheduling",
    state: "FailedScheduling",
    detail: "0/1 nodes are available",
    hint: "Check the pod's resource requests, affinity, taints, and node capacity.",
    persists: true,
  });
});

test("pods labelled for another release are ignored, and unlabelled pods count", async () => {
  const pod = (name: string, instance?: string) => ({
    metadata: {
      name,
      labels:
        instance === undefined
          ? {}
          : { "app.kubernetes.io/instance": instance },
    },
    spec: { nodeName: "node-1" },
    status: {
      phase: "Running",
      containerStatuses: [waitingIn("ErrImagePull")],
    },
  });
  const { runner } = cluster([pod("other-1", "ingress"), pod("registry-3")]);

  const found = await findings(runner, base, "registry");

  expect(found.map((f) => f.pod)).toEqual(["registry-3"]);
});

test("events are read only when a pod is unscheduled or creating, never for a healthy namespace", async () => {
  const { run, runner } = cluster([podOf("registry-1", [])]);

  await expect(findings(runner, base, "registry")).resolves.toEqual([]);
  expect(run.mock.calls.map(([, args]) => args.at(-3))).toEqual(["pods"]);
});

test("a namespace that does not exist yet, or a passing API error, reads as no pods, not a failure", async () => {
  const absent = runnerFake(() => {
    throw new CommandError("kubectl", ["get"], {
      stdout: "",
      stderr: "namespaces not found",
      code: 1,
    });
  });

  await expect(findings(absent.runner, base, "registry")).resolves.toEqual([]);
});

test("any other failure to list the pods is rethrown, never read as a healthy namespace", async () => {
  const denied = new Error("cluster unreachable");
  const { runner } = runnerFake(() => {
    throw denied;
  });

  await expect(findings(runner, base, "registry")).rejects.toBe(denied);
});

test("every look is read-only: each call is a get that names the release's namespace", async () => {
  const { run, runner } = cluster([podOf("registry-1", [])]);

  await findings(runner, base, "registry");

  for (const [command, args] of run.mock.calls) {
    expect(command).toBe("kubectl");
    expect(args).toContain("get");
    expect(args.slice(0, 4)).toEqual(base);
  }
});

test("a crash loop with no recorded last exit has an empty detail, and a running container is no finding", async () => {
  const crashing = podOf("registry-1", [waitingIn("CrashLoopBackOff", "", 2)]);
  const running = podOf("registry-2", [
    { name: "registry", state: { running: {} } },
  ]);
  const { runner } = cluster([crashing, running]);

  const found = await findings(runner, base, "registry");

  expect(found.map((f) => [f.pod, f.detail])).toEqual([["registry-1", ""]]);
});

test("a pod stuck creating with no create-failure event is not yet a finding", async () => {
  const pulled = {
    reason: "Pulled",
    message: "ok",
    involvedObject: { kind: "Pod", name: "registry-1" },
  };
  const { runner } = cluster(
    [podOf("registry-1", [waitingIn("ContainerCreating")])],
    [pulled],
  );

  await expect(findings(runner, base, "registry")).resolves.toEqual([]);
});

test("the latest sandbox event is judged by its eventTime when it has no lastTimestamp", async () => {
  const newer = {
    reason: "FailedCreatePodSandBox",
    message: "new message",
    count: 1,
    eventTime: "2026-11-14T00:00:09Z",
    involvedObject: { kind: "Pod", name: "registry-1" },
  };
  const { runner } = cluster(
    [podOf("registry-1", [waitingIn("ContainerCreating")])],
    [sandboxEvent("registry-1", "old message"), newer],
  );

  const [found] = await findings(runner, base, "registry");

  expect(found?.detail).toBe('"new message"');
});
