import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import type { CliDeps } from "../runtime/index.js";
import {
  ProcessRunner,
  type RunOptions,
  type RunResult,
  type Runner,
} from "../runtime/runner.js";
import { handOff } from "./handoff.js";

const TOKEN = "ghs_handoff_secret_value";

/**
 * Real processes, except that `herdr pane run <pane> <command>` runs the
 * command in a local shell, as the pane's shell would, and reports the
 * GH_TOKEN it ended up with.
 */
class PaneStandIn implements Runner {
  readonly calls: { command: string; args: readonly string[] }[] = [];
  readonly inputs: string[] = [];
  /** The GH_TOKEN each stand-in pane shell ended up with. */
  readonly received: string[] = [];
  private readonly real = new ProcessRunner();

  constructor(private readonly reads: boolean) {}

  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args });
    if (options?.input !== undefined) {
      this.inputs.push(options.input);
    }
    if (command === "herdr" && args[1] === "run") {
      if (!this.reads) {
        return { stdout: "", stderr: "", code: 0 };
      }
      const shell = await this.real.run("sh", [
        "-c",
        `${args.slice(3).join(" ")}; printf %s "$GH_TOKEN"`,
      ]);
      this.received.push(shell.stdout);
      return { ...shell, stdout: "" };
    }
    return await this.real.run(command, args, options);
  }
}

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function realDeps(
  runner: Runner,
): Promise<{ deps: CliDeps; state: string }> {
  const state = await mkdtemp(join(tmpdir(), "kore-handoff-"));
  scratch.push(state);
  const { deps } = testHarness();
  return { deps: { ...deps, runner }, state };
}

const opts = (state: string, timeoutMs = 5000) => ({
  dir: join(state, "handoff", "w1"),
  pane: "w3:p9",
  token: TOKEN,
  timeoutMs,
});

describe("handOff with real processes", () => {
  it("delivers the token to the pane's GH_TOKEN and removes the FIFO and its directory after the one read", async () => {
    const runner = new PaneStandIn(true);
    const { deps, state } = await realDeps(runner);
    const o = opts(state);

    expect(await handOff(deps, o)).toBeUndefined();

    expect(runner.received).toEqual([TOKEN]);
    expect(await readdir(join(state, "handoff"))).toEqual([]);
    await expect(stat(o.dir)).rejects.toThrow();
  });

  it("creates the directory at mode 0700 and the FIFO at 0600 before anything is sent", async () => {
    const runner = new PaneStandIn(true);
    const { deps, state } = await realDeps(runner);
    const o = opts(state);
    const modes: string[] = [];
    const spy: Runner = {
      async run(command, args, options) {
        if (command === "sh" && options?.input !== undefined) {
          modes.push(
            `${(await stat(o.dir)).mode & 0o777}`,
            `${(await stat(join(o.dir, "token"))).mode & 0o777}`,
          );
        }
        return await runner.run(command, args, options);
      },
    };
    await handOff({ ...deps, runner: spy }, o);
    expect(modes).toEqual([`${0o700}`, `${0o600}`]);
  });

  it("never leaves the token in a file, in argv or in a spawned child's environment", async () => {
    const runner = new PaneStandIn(true);
    const { deps, state } = await realDeps(runner);
    await handOff(deps, opts(state));
    for (const call of runner.calls) {
      expect(JSON.stringify(call.args)).not.toContain(TOKEN);
    }
    // The token travels on stdin once, to the one process that writes the FIFO.
    expect(runner.inputs).toEqual([TOKEN]);
    expect(await readdir(state, { recursive: true })).toEqual(["handoff"]);
  });

  it("times out when nothing reads the FIFO, still removes it, and says which pane to close", async () => {
    const runner = new PaneStandIn(false);
    const { deps, state } = await realDeps(runner);
    const started = Date.now();
    const error = await handOff(deps, opts(state, 300));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(error).toContain("w3:p9");
    expect(error).toContain("300");
    expect(await readdir(join(state, "handoff"))).toEqual([]);
  });

  it("hands the same pane a second token only through a fresh FIFO", async () => {
    const runner = new PaneStandIn(true);
    const { deps, state } = await realDeps(runner);
    await handOff(deps, opts(state));
    await handOff(deps, { ...opts(state), token: "ghs_second" });
    expect(await readdir(join(state, "handoff"))).toEqual([]);
    expect(runner.received).toEqual([TOKEN, "ghs_second"]);
  });
});

describe("handOff command shapes", () => {
  it("sends the pane only the FIFO path, never the token", async () => {
    const h = testHarness();
    await handOff(h.deps, opts("/state"));
    const run = h.runner.calls.find(
      (c) => c.command === "herdr" && c.args[1] === "run",
    );
    expect(run?.args).toEqual([
      "pane",
      "run",
      "w3:p9",
      `export GH_TOKEN="$(cat '/state/handoff/w1/token')"`,
    ]);
  });

  it("quotes a path with a quote or a space so the pane's shell reads it as one word", async () => {
    const h = testHarness();
    await handOff(h.deps, {
      ...opts("/it's here"),
      dir: "/it's here/w1",
    });
    const run = h.runner.calls.find((c) => c.args[1] === "run");
    expect(run?.args[3]).toBe(
      `export GH_TOKEN="$(cat '/it'\\''s here/w1/token')"`,
    );
  });

  it("unblocks the writer and reports the failure when the pane refuses the command", async () => {
    const h = testHarness({
      responses: [
        {
          match: (c, a) => c === "herdr" && a[1] === "run",
          result: { code: 1, stderr: "pane_not_found" },
        },
      ],
    });
    const error = await handOff(h.deps, opts("/state"));
    expect(error).toContain("pane_not_found");
    const drain = h.runner.calls.find(
      (c) => c.command === "sh" && c.args[1]?.includes("/dev/null"),
    );
    expect(drain?.args.at(-1)).toBe("/state/handoff/w1/token");
  });

  it("removes the directory even when creating the FIFO fails", async () => {
    const h = testHarness({
      responses: [
        {
          match: (c) => c === "mkfifo",
          result: { code: 1, stderr: "mkfifo: Operation not permitted" },
        },
      ],
    });
    const error = await handOff(h.deps, opts("/state"));
    expect(error).toContain("mkfifo");
    expect(
      h.runner.calls.filter((c) => c.command === "rm").length,
    ).toBeGreaterThanOrEqual(2);
    expect(h.runner.calls.some((c) => c.command === "sh")).toBe(false);
  });
});
