import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { localRegistryReference, stopRegistryForward } from "./registry.js";

// Docs: AGENTS.md "One owner per resource."

vi.mock("./registry-tls.js", () => ({ loadRegistryCa: async () => "ca-pem" }));

const context = "k3d-kore-local";
const forwardCommand = `kubectl --context ${context} --namespace kore-registry port-forward service/oci-registry 30500:5000`;
const roots: string[] = [];

afterEach(async () => {
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
