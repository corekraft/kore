// Docs: docs/decisions/0035-fail-fast-readiness-diagnosis.md
import { beforeEach, expect, test, vi } from "vitest";
import { CommandError, withSignal } from "../runtime/index.js";
import { findings, type Finding } from "./fail-fast-detect.js";
import { FailFastError, withFailFast, type WatchClock } from "./fail-fast.js";
import {
  componentOf,
  repositoryOf,
  runnerFake,
  watchClock,
} from "./gate-unit-support.js";

vi.mock("./fail-fast-detect.js");
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  withSignal: vi.fn(),
}));

const repository = repositoryOf({ kubeContext: "k3d-kore-local" });
const component = componentOf("registry", { namespace: "registry-ns" });
const base = ["--context", "k3d-kore-local", "--namespace", "registry-ns"];

const pullFailure: Finding = {
  key: "registry-1/registry/ErrImagePull",
  pod: "registry-1",
  subject: "container registry",
  state: "ErrImagePull",
  detail: "not found",
  hint: "Check the image reference.",
  persists: true,
};

let watchSignal: AbortSignal | undefined;

beforeEach(() => {
  watchSignal = undefined;
  vi.mocked(withSignal).mockImplementation((inner, signal) => {
    watchSignal = signal;
    return inner;
  });
  vi.mocked(findings).mockResolvedValue([]);
});

/** Watches the test component on a fake clock, one look per 1 s, grace 5 s. */
function watch<T>(
  clock: WatchClock,
  command: () => Promise<T>,
  runner = runnerFake().runner,
) {
  return withFailFast(repository, runner, component, command, {
    clock,
    intervalMs: 1000,
    graceMs: 5000,
  });
}

/** Settles once the command is cancelled, the way a command aborts on its signal. */
function untilCancelled(): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    watchSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
      once: true,
    });
  });
}

test("a healthy rollout is not interrupted, and the command's value comes back", async () => {
  const { clock, looked } = watchClock();

  const value = await watch(clock, async () => {
    await looked(3);
    return "installed";
  });

  expect(value).toBe("installed");
  expect(watchSignal?.aborted).toBe(false);
});

test("a persisting fatal state past the grace period cancels the command and names the pod", async () => {
  const { clock } = watchClock();
  vi.mocked(findings).mockResolvedValue([pullFailure]);

  const failing = watch(clock, () => untilCancelled());

  await expect(failing).rejects.toBeInstanceOf(FailFastError);
  await expect(failing).rejects.toThrow(
    "component registry failed: pod registry-1 container registry ErrImagePull: not found\nCheck the image reference.",
  );
  expect(watchSignal?.aborted).toBe(true);
});

test("a state that persists only inside the grace period never cancels the command", async () => {
  const { clock, looked } = watchClock();
  vi.mocked(findings).mockImplementation(async () =>
    vi.mocked(findings).mock.calls.length <= 2 ? [pullFailure] : [],
  );

  const value = await watch(clock, async () => {
    await looked(8);
    return "done";
  });

  expect(value).toBe("done");
});

test("a non-persisting fatal state, such as a crash loop, is fatal at the first look", async () => {
  const { clock } = watchClock();
  vi.mocked(findings).mockResolvedValue([
    { ...pullFailure, state: "CrashLoopBackOff (2 restarts)", persists: false },
  ]);

  await expect(watch(clock, () => untilCancelled())).rejects.toThrow(
    "component registry failed: pod registry-1 container registry CrashLoopBackOff (2 restarts)",
  );
});

test("a command that fails on its own keeps its error type and gets what the watch last saw appended", async () => {
  const { clock, looked } = watchClock();
  vi.mocked(findings).mockResolvedValue([pullFailure]);
  const helmFailure = new CommandError("helm", ["upgrade"], {
    stdout: "",
    stderr: "UPGRADE FAILED: context deadline exceeded",
    code: 1,
  });

  const failing = watch(clock, async () => {
    await looked(2);
    throw helmFailure;
  });

  await expect(failing).rejects.toBeInstanceOf(CommandError);
  await expect(failing).rejects.toThrow(
    "The watch of registry-ns last saw:\npod registry-1 container registry ErrImagePull: not found",
  );
});

test("a command that fails before the watch saw anything is rethrown unchanged", async () => {
  const { clock, looked } = watchClock();
  const failure = new Error("helm exited 1");

  const failing = watch(clock, async () => {
    await looked(1);
    throw failure;
  });

  await expect(failing).rejects.toBe(failure);
  expect(failure.message).toBe("helm exited 1");
});

test("a watch that cannot read the namespace cancels the command and rethrows that failure", async () => {
  const { clock } = watchClock();
  const unreadable = new Error("kubectl exploded");
  vi.mocked(findings).mockRejectedValue(unreadable);

  await expect(watch(clock, () => untilCancelled())).rejects.toBe(unreadable);
  expect(watchSignal?.aborted).toBe(true);
});

test("every look is scoped to the component's namespace and its kube context", async () => {
  const { clock, looked } = watchClock();
  const { runner } = runnerFake();

  await watch(
    clock,
    async () => {
      await looked(2);
    },
    runner,
  );

  expect(findings).toHaveBeenCalledWith(runner, base, "registry");
});

test("the diagnosis quotes the container's previous logs when they can be read", async () => {
  const { clock } = watchClock();
  vi.mocked(findings).mockResolvedValue([
    { ...pullFailure, logs: { container: "registry" }, persists: false },
  ]);
  const { runner } = runnerFake((_command, args) => ({
    stdout: args.includes("logs") ? "listen tcp :5001: address in use" : "",
    stderr: "",
    code: 0,
  }));

  await expect(watch(clock, () => untilCancelled(), runner)).rejects.toThrow(
    "Previous logs (last 20 lines):\nlisten tcp :5001: address in use",
  );
});

test("previous logs that cannot be read are left out of the diagnosis, which still names the pod", async () => {
  const { clock } = watchClock();
  vi.mocked(findings).mockResolvedValue([
    { ...pullFailure, logs: { container: "registry" }, persists: false },
  ]);
  const { runner } = runnerFake((_command, args) => {
    if (args.includes("logs")) {
      throw new CommandError("kubectl", args, {
        stdout: "",
        stderr: "previous terminated container not found",
        code: 1,
      });
    }
    return { stdout: "", stderr: "", code: 0 };
  });

  const failing = watch(clock, () => untilCancelled(), runner);

  await expect(failing).rejects.toThrow("pod registry-1 container registry");
  expect(String(await failing.catch((error: unknown) => error))).not.toContain(
    "Previous logs",
  );
});

test("without an injected clock the watch looks on real timers, which advance with fake time", async () => {
  vi.useFakeTimers();
  try {
    const { runner } = runnerFake();
    const finished = withFailFast(
      repository,
      runner,
      component,
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("ok"), 5000);
        }),
      { intervalMs: 1000 },
    );

    await vi.advanceTimersByTimeAsync(5000);

    await expect(finished).resolves.toBe("ok");
    expect(findings).toHaveBeenCalledTimes(4);
  } finally {
    vi.useRealTimers();
  }
});
