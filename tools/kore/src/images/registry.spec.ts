// Docs: docs/decisions/0058-registry-transport-tls.md
import { spawn } from "node:child_process";
import { connect } from "node:tls";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { listHostProcesses, terminateMatching } from "../runtime/index.js";
import {
  asFake,
  connectTo,
  fakeRepository,
  fakeRunner,
  fakeSocket,
  forwardArgs,
} from "./images-support.js";
import {
  clearForwardOwner,
  ownershipConflict,
  readForwardOwner,
  recordForwardOwner,
} from "./registry-forward-owner.js";
import {
  forwardResponds,
  localRegistryReference,
  stopRegistryForward,
} from "./registry.js";
import { loadRegistryCa } from "./registry-tls.js";

vi.mock("node:child_process");
vi.mock("node:tls");
vi.mock("./registry-forward-owner.js");
vi.mock("./registry-tls.js");
vi.mock("../runtime/index.js");

const reference = "registry.kore.local:30500/reference:dev";
const owner = { pid: 4242, root: "/worktrees/a", starter: 7 };

beforeEach(() => {
  vi.mocked(loadRegistryCa).mockResolvedValue("ca-pem");
  vi.mocked(readForwardOwner).mockResolvedValue(undefined);
  vi.mocked(ownershipConflict).mockReturnValue(undefined);
  vi.mocked(terminateMatching).mockResolvedValue([]);
  vi.mocked(listHostProcesses).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

test("a non-k3d environment keeps the reference and starts no port forward", async () => {
  const { runner } = fakeRunner();

  await expect(
    localRegistryReference(
      fakeRepository({ provider: "managed" }),
      runner,
      "registry.example.com/reference:dev",
    ),
  ).resolves.toBe("registry.example.com/reference:dev");
  expect(loadRegistryCa).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

test("an open forward with no recorded owner is used, and reported as unowned", async () => {
  const { runner } = fakeRunner();
  const lines: string[] = [];

  await expect(
    localRegistryReference(fakeRepository(), runner, reference, {
      isPortOpen: async () => true,
      report: (line) => void lines.push(line),
    }),
  ).resolves.toBe("127.0.0.1:30500/reference:dev");
  expect(loadRegistryCa).toHaveBeenCalledWith(fakeRepository(), runner);
  expect(recordForwardOwner).not.toHaveBeenCalled();
  expect(lines).toEqual([
    "registry port-forward on 127.0.0.1:30500 for context k3d-kore-local is already running with no owner recorded, so this run uses it but does not own it; any worktree's stop can end it mid-build",
  ]);
});

test("an open forward with a recorded owner is used without a warning", async () => {
  vi.mocked(readForwardOwner).mockResolvedValue(owner);
  const lines: string[] = [];

  await localRegistryReference(
    fakeRepository(),
    fakeRunner().runner,
    reference,
    {
      isPortOpen: async () => true,
      report: (line) => void lines.push(line),
    },
  );

  expect(readForwardOwner).toHaveBeenCalledWith("k3d-kore-local");
  expect(lines).toEqual([]);
});

test("a closed port starts the forward, records its owner, and waits until it answers", async () => {
  vi.useFakeTimers();
  const spawnPortForward = vi.fn(() => 1234);
  const answers = [false, false, true];

  const pending = localRegistryReference(
    fakeRepository(),
    fakeRunner().runner,
    reference,
    {
      isPortOpen: async () => answers.shift() ?? true,
      spawnPortForward,
    },
  );
  await vi.advanceTimersByTimeAsync(1000);

  await expect(pending).resolves.toBe("127.0.0.1:30500/reference:dev");
  expect(spawnPortForward).toHaveBeenCalledExactlyOnceWith(fakeRepository());
  expect(recordForwardOwner).toHaveBeenCalledExactlyOnceWith(
    fakeRepository(),
    1234,
  );
  expect(answers).toEqual([]);
});

test("a forward that never answers fails after fifteen seconds, naming the port", async () => {
  vi.useFakeTimers();
  const outcome = localRegistryReference(
    fakeRepository(),
    fakeRunner().runner,
    reference,
    { isPortOpen: async () => false, spawnPortForward: () => 1234 },
  ).then(
    () => "ready",
    (caught: Error) => caught.message,
  );

  await vi.advanceTimersByTimeAsync(20_000);

  expect(await outcome).toBe(
    "local OCI registry port-forward did not become ready on 127.0.0.1:30500",
  );
});

test("the default start runs kubectl detached with its output ignored, and records the forward it started", async () => {
  vi.useFakeTimers();
  const child = { pid: 1234, unref: vi.fn() };
  vi.mocked(spawn).mockReturnValue(asFake(child));
  connectTo(
    fakeSocket({ error: new Error("connection refused") }),
    fakeSocket({ data: "HTTP/1.1 401 Unauthorized" }),
  );

  const pending = localRegistryReference(
    fakeRepository(),
    fakeRunner().runner,
    reference,
  );
  await vi.advanceTimersByTimeAsync(1000);

  await expect(pending).resolves.toBe("127.0.0.1:30500/reference:dev");
  expect(spawn).toHaveBeenCalledWith("kubectl", forwardArgs, {
    detached: true,
    stdio: "ignore",
  });
  expect(child.unref).toHaveBeenCalledOnce();
  expect(recordForwardOwner).toHaveBeenCalledWith(fakeRepository(), 1234);
});

test("a kubectl that starts without a process id fails with the start error", async () => {
  vi.mocked(spawn).mockReturnValue(asFake({ pid: undefined, unref: vi.fn() }));

  await expect(
    localRegistryReference(fakeRepository(), fakeRunner().runner, reference, {
      isPortOpen: async () => false,
    }),
  ).rejects.toThrow("could not start the local OCI registry port-forward");
  expect(recordForwardOwner).not.toHaveBeenCalled();
});

test("the default readiness probe verifies the forward against the registry CA on 127.0.0.1:30500", async () => {
  connectTo(fakeSocket({ data: "HTTP/1.1 401 Unauthorized" }));

  await expect(forwardResponds(30500, "ca-pem")).resolves.toBe(true);
  expect(connect).toHaveBeenCalledWith({
    host: "127.0.0.1",
    port: 30500,
    ca: "ca-pem",
    rejectUnauthorized: true,
  });
});

test("a probe is ready only when the reply begins with HTTP, and the socket is always closed", async () => {
  const socket = fakeSocket({ data: "SSH-2.0-OpenSSH" });
  connectTo(socket);

  await expect(forwardResponds(30500, "ca-pem")).resolves.toBe(false);
  expect(socket.write).toHaveBeenCalledWith(
    "GET /v2/ HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n",
  );
  expect(socket.destroy).toHaveBeenCalledOnce();
});

test("a probe that errors or closes before answering is not ready", async () => {
  const errored = fakeSocket({ error: new Error("reset") });
  const closed = fakeSocket({ close: true });
  connectTo(errored, closed);

  await expect(forwardResponds(30500, "ca-pem")).resolves.toBe(false);
  await expect(forwardResponds(30500, "ca-pem")).resolves.toBe(false);
  expect(errored.destroy).toHaveBeenCalledOnce();
  expect(closed.destroy).toHaveBeenCalledOnce();
});

test("a probe that never answers gives up at its timeout and is not ready", async () => {
  vi.useFakeTimers();
  const socket = fakeSocket({ silent: true });
  connectTo(socket);
  const pending = forwardResponds(30500, "ca-pem", 300);

  await vi.advanceTimersByTimeAsync(300);

  await expect(pending).resolves.toBe(false);
  expect(socket.destroy).toHaveBeenCalledOnce();
});

test("stopping with no recorded owner terminates the matching forward and clears the record", async () => {
  vi.mocked(terminateMatching).mockResolvedValue([4242]);

  await expect(stopRegistryForward(fakeRepository())).resolves.toEqual([4242]);
  expect(clearForwardOwner).toHaveBeenCalledExactlyOnceWith("k3d-kore-local");
});

test("a forward a conflicting owner still runs is left alone, with the reason and the way past it", async () => {
  vi.mocked(readForwardOwner).mockResolvedValue(owner);
  vi.mocked(ownershipConflict).mockReturnValue(
    "it was started from /worktrees/a, so stop it from there",
  );
  vi.mocked(listHostProcesses).mockResolvedValue([
    { pid: 4242, command: "kubectl" },
  ]);
  const lines: string[] = [];

  await expect(
    stopRegistryForward(fakeRepository({}, "/worktrees/b"), {
      report: (line) => void lines.push(line),
    }),
  ).resolves.toEqual([]);

  expect(terminateMatching).not.toHaveBeenCalled();
  expect(clearForwardOwner).not.toHaveBeenCalled();
  expect(lines).toEqual([
    "left registry port-forward 4242 for context k3d-kore-local running: it was started from /worktrees/a, so stop it from there; or pass --force to stop it anyway",
  ]);
});

test("a conflicting owner that has already exited no longer blocks the stop", async () => {
  vi.mocked(readForwardOwner).mockResolvedValue(owner);
  vi.mocked(ownershipConflict).mockReturnValue("some reason");

  await expect(stopRegistryForward(fakeRepository())).resolves.toEqual([]);
  expect(terminateMatching).toHaveBeenCalledOnce();
});

test("force stops a forward another owner holds, without asking whether it conflicts", async () => {
  vi.mocked(readForwardOwner).mockResolvedValue(owner);
  vi.mocked(terminateMatching).mockResolvedValue([4242]);

  await expect(
    stopRegistryForward(fakeRepository(), {}, { force: true }),
  ).resolves.toEqual([4242]);
  expect(ownershipConflict).not.toHaveBeenCalled();
});

test("only a kubectl for this context's registry forward matches the stop, and its describe names the process", async () => {
  await stopRegistryForward(fakeRepository());
  const [matches, describe] = vi.mocked(terminateMatching).mock.calls[0] ?? [];

  const forward = (command: string) => matches?.({ pid: 1, command });
  expect(
    forward(
      "/usr/local/bin/kubectl --context k3d-kore-local --namespace kore-registry port-forward service/oci-registry 30500:5000",
    ),
  ).toBe(true);
  expect(
    forward(
      "kubectl --context k3d-other --namespace kore-registry port-forward service/oci-registry 30500:5000",
    ),
  ).toBe(false);
  expect(
    forward(
      "helm --context k3d-kore-local --namespace kore-registry port-forward service/oci-registry 30500:5000",
    ),
  ).toBe(false);
  expect(describe?.({ pid: 4242, command: "" })).toBe(
    "stopped registry port-forward 4242 for context k3d-kore-local",
  );
});
