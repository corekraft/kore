import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { readForwardOwner } from "../../src/images/registry-forward-owner.js";
import {
  localRegistryReference,
  stopRegistryForward,
} from "../../src/images/registry.js";

// Docs: AGENTS.md "One owner per resource."

vi.mock("../../src/images/registry-tls.js", () => ({
  loadRegistryCa: async () => "ca-pem",
}));

const context = "k3d-kore-local";
const forwardCommand = `kubectl --context ${context} --namespace kore-registry port-forward service/oci-registry 30500:5000`;
const roots: string[] = [];

beforeEach(async () => {
  // Ownership records are host-wide; give every test a host of its own.
  const host = await mkdtemp(join(tmpdir(), "kore-forward-host-"));
  roots.push(host);
  vi.stubEnv("KORE_HOST_ROOT", host);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function worktree(): Promise<Repository> {
  const root = await mkdtemp(join(tmpdir(), "kore-forward-owner-"));
  roots.push(root);
  return {
    root,
    environment: { provider: "k3d", kubeContext: context },
  } as unknown as Repository;
}

/** `repository` starts the forward (pid 4242), as `kore local up` does. */
async function start(repository: Repository): Promise<void> {
  let ready = false;
  await localRegistryReference(
    repository,
    {
      run: async () => ({ stdout: "", stderr: "", code: 0 }),
    } as unknown as Runner,
    "registry.kore.local:30500/reference:dev",
    {
      isPortOpen: async () => {
        const open = ready;
        ready = true;
        return open;
      },
      spawnPortForward: () => 4242,
    },
  );
}

function stopControl() {
  const signalled: number[] = [];
  const lines: string[] = [];
  return {
    signalled,
    lines,
    control: {
      listProcesses: async () => [{ pid: 4242, command: forwardCommand }],
      signalProcess: (pid: number) => void signalled.push(pid),
      report: (line: string) => void lines.push(line),
    },
  };
}

test("a worktree that did not start the forward leaves it running, naming its owner", async () => {
  const owner = await worktree();
  const other = await worktree();
  await start(owner);
  const { signalled, lines, control } = stopControl();

  const stopped = await stopRegistryForward(other, control);

  expect(stopped).toEqual([]);
  expect(signalled).toEqual([]);
  expect(lines.join("\n")).toContain(owner.root);
});

test("the worktree that started the forward stops it, and the next stop is a no-op", async () => {
  const owner = await worktree();
  await start(owner);
  const first = stopControl();

  expect(await stopRegistryForward(owner, first.control)).toEqual([4242]);
  expect(first.signalled).toEqual([4242]);

  const again = stopControl();
  await stopRegistryForward(await worktree(), {
    ...again.control,
    listProcesses: async () => [],
  });
  expect(again.signalled).toEqual([]);
});

test("a forward whose owning worktree is gone can be stopped by anyone", async () => {
  const owner = await worktree();
  const other = await worktree();
  await start(owner);
  await rm(owner.root, { recursive: true, force: true });
  const { signalled, control } = stopControl();

  expect(await stopRegistryForward(other, control)).toEqual([4242]);
  expect(signalled).toEqual([4242]);
});

test("a forward nobody recorded, such as one from an older kore, is still stopped", async () => {
  const { signalled, control } = stopControl();

  expect(await stopRegistryForward(await worktree(), control)).toEqual([4242]);
  expect(signalled).toEqual([4242]);
});

test("the owner record names the starting process as well as the worktree", async () => {
  const owner = await worktree();
  await start(owner);

  expect(await readForwardOwner(context)).toEqual({
    pid: 4242,
    root: owner.root,
    starter: process.pid,
  });
});

/** Reaches the registry through a forward that is already answering. */
async function useOpenForward(repository: Repository) {
  const lines: string[] = [];
  await localRegistryReference(
    repository,
    {
      run: async () => ({ stdout: "", stderr: "", code: 0 }),
    } as unknown as Runner,
    "registry.kore.local:30500/reference:dev",
    { isPortOpen: async () => true, report: (line) => void lines.push(line) },
  );
  return lines;
}

test("a forward found already open with no recorded owner is reported, never silently adopted", async () => {
  const lines = await useOpenForward(await worktree());

  expect(lines.join("\n")).toMatch(/no owner recorded/);
  expect(lines.join("\n")).toContain("30500");
});

test("a forward found open that a worktree recorded is used without a warning", async () => {
  const owner = await worktree();
  await start(owner);

  expect(await useOpenForward(await worktree())).toEqual([]);
});

/** A forward `repository`'s worktree started from another kore process, `starter`. */
async function startedByAnotherProcess(
  repository: Repository,
  starter: number,
): Promise<void> {
  const directory = join(
    process.env.KORE_HOST_ROOT ?? "",
    ".kore",
    "registry-forward",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${context}.json`),
    JSON.stringify({ pid: 4242, root: repository.root, starter }),
  );
}

test("another process in the owning worktree leaves the forward running, naming the starter", async () => {
  const owner = await worktree();
  await startedByAnotherProcess(owner, process.ppid);
  const { signalled, lines, control } = stopControl();

  expect(await stopRegistryForward(owner, control)).toEqual([]);

  expect(signalled).toEqual([]);
  expect(lines.join("\n")).toContain(`process ${process.ppid}`);
  expect(lines.join("\n")).toContain("--force");
});

test("--force stops a forward another process or another worktree owns", async () => {
  const owner = await worktree();
  const other = await worktree();
  await startedByAnotherProcess(owner, process.ppid);

  const sameWorktree = stopControl();
  expect(
    await stopRegistryForward(owner, sameWorktree.control, { force: true }),
  ).toEqual([4242]);

  await startedByAnotherProcess(owner, process.ppid);
  const otherWorktree = stopControl();
  expect(
    await stopRegistryForward(other, otherWorktree.control, { force: true }),
  ).toEqual([4242]);
});

test("a forward whose starting process has exited can be stopped by its worktree", async () => {
  const owner = await worktree();
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  await startedByAnotherProcess(owner, gone);
  const { signalled, control } = stopControl();

  expect(await stopRegistryForward(owner, control)).toEqual([4242]);
  expect(signalled).toEqual([4242]);
});
