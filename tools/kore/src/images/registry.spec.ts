// Docs: docs/decisions/0058-registry-transport-tls.md
import { spawn } from "node:child_process";
import { connect } from "node:tls";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { registryByName } from "../config/index.js";
import { listHostProcesses, terminateMatching } from "../runtime/index.js";
import {
  connectTo,
  fakeRepository,
  fakeRunner,
  fakeSocket,
} from "./images-support.js";
import {
  clearForwardOwner,
  ownershipConflict,
  readForwardOwner,
  recordForwardOwner,
} from "./registry-forward-owner.js";
import { ensureRegistryName, hostRegistryAddress } from "./registry-name.js";
import {
  ensureRegistryForward,
  forwardResponds,
  localRegistryReference,
  stopRegistryForward,
} from "./registry.js";
import { loadRegistryCa } from "./registry-tls.js";

vi.mock("node:child_process");
vi.mock("node:tls");
vi.mock("../config/index.js");
vi.mock("./registry-name.js");
vi.mock("./registry-forward-owner.js");
vi.mock("./registry-tls.js");
vi.mock("../runtime/index.js");

const reference = "registry.kore.local:30500/reference:dev";
const owner = { pid: 4242, root: "/worktrees/a", starter: 7 };

beforeEach(() => {
  vi.mocked(registryByName).mockReturnValue(false);
  vi.mocked(hostRegistryAddress).mockReturnValue(
    "registry.platform.kore.local",
  );
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

const name = "registry.platform.kore.local";

test("with registry-by-name on, a k3d reference is rewritten to the registry's name, and no port forward is probed or started", async () => {
  vi.mocked(registryByName).mockReturnValue(true);
  vi.mocked(hostRegistryAddress).mockReturnValue(name);
  const { runner } = fakeRunner();
  const isPortOpen = vi.fn(async () => true);

  await expect(
    localRegistryReference(fakeRepository(), runner, reference, { isPortOpen }),
  ).resolves.toBe(`${name}/reference:dev`);

  expect(ensureRegistryName).toHaveBeenCalledExactlyOnceWith(
    fakeRepository(),
    runner,
  );
  expect(isPortOpen).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
  expect(recordForwardOwner).not.toHaveBeenCalled();
});

test("with registry-by-name off, a k3d environment is refused naming the flag, and starts no port forward", async () => {
  vi.mocked(registryByName).mockReturnValue(false);
  const { runner } = fakeRunner();
  const isPortOpen = vi.fn(async () => true);

  await expect(
    localRegistryReference(fakeRepository(), runner, reference, {
      isPortOpen,
      spawnPortForward: () => 1234,
    }),
  ).rejects.toThrow(
    "environment local reaches the local registry only by name, and registry-by-name is off; turn registry-by-name on in the environment's overlay, then run `kore local up`",
  );
  expect(loadRegistryCa).not.toHaveBeenCalled();
  expect(isPortOpen).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
  expect(recordForwardOwner).not.toHaveBeenCalled();
});

test("with registry-by-name on, a name that cannot be reached fails with its cause instead of starting a forward", async () => {
  vi.mocked(registryByName).mockReturnValue(true);
  vi.mocked(ensureRegistryName).mockRejectedValue(
    new Error(`${name} does not resolve (ENOTFOUND)`),
  );

  await expect(
    ensureRegistryForward(fakeRepository(), fakeRunner().runner, {
      isPortOpen: async () => true,
    }),
  ).rejects.toThrow(`${name} does not resolve (ENOTFOUND)`);
  expect(spawn).not.toHaveBeenCalled();
});
