import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { prepareProofRoot } from "./external-dns-proof-root.js";

const root = "/work/kore";
const dest = "/work/kore/.claude/worktrees/external-dns-proof";
const environmentPath = join(dest, "infra/environments/local/environment.yaml");

const overlay = {
  name: "local",
  provider: "k3d",
  features: {
    "platform-shared-gateway": true,
    "service-listener-sets": false,
    "external-gateway": false,
    "external-dns": false,
  },
  platform: { domain: "kore.internal", organizationId: "platform" },
};

function runnerReturning(code: number, stderr = ""): Runner {
  return {
    run: vi.fn(async () => ({ stdout: "", stderr, code })),
  };
}

describe("the throwaway proof root", () => {
  it("adds a detached worktree of HEAD at the destination and writes the throwaway environment into it", async () => {
    const run = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }));
    const runner: Runner = { run };
    const write = vi.fn(async () => undefined);
    const files = {
      read: vi.fn(async () => JSON.stringify(overlay)),
      write,
    };

    const made = await prepareProofRoot({ root, dest, runner, files });

    expect(made).toBe(dest);
    expect(run).toHaveBeenCalledWith(
      "git",
      ["worktree", "add", "--detach", dest, "HEAD"],
      expect.objectContaining({ cwd: root }),
    );
    expect(files.read).toHaveBeenCalledWith(environmentPath);
    expect(write).toHaveBeenCalledTimes(1);
    const [path, text] = write.mock.calls[0] as unknown as [string, string];
    expect(path).toBe(environmentPath);
    const written = JSON.parse(text) as {
      features: Record<string, boolean>;
      platform: { domain: string };
    };
    expect(written.features["external-dns"]).toBe(true);
    expect(written.features["external-gateway"]).toBe(true);
    expect(written.features["service-listener-sets"]).toBe(true);
    expect(written.platform.domain).toBe("example.com");
  });

  it("writes only inside the throwaway copy, never into the checkout it was started from", async () => {
    const write = vi.fn(async () => undefined);
    const files = {
      read: vi.fn(async () => JSON.stringify(overlay)),
      write,
    };

    await prepareProofRoot({
      root,
      dest,
      runner: runnerReturning(0),
      files,
    });

    for (const call of write.mock.calls as unknown as [string, string][]) {
      expect(call[0].startsWith(dest)).toBe(true);
      expect(call[0].startsWith(root + "/infra")).toBe(false);
    }
  });

  it("writes nothing and names the fix when git cannot add the worktree", async () => {
    const write = vi.fn(async () => undefined);
    const files = {
      read: vi.fn(async () => JSON.stringify(overlay)),
      write,
    };

    await expect(
      prepareProofRoot({
        root,
        dest,
        runner: runnerReturning(128, "already exists"),
        files,
      }),
    ).rejects.toThrow(/already exists.*git worktree remove/s);
    expect(write).not.toHaveBeenCalled();
  });
});
