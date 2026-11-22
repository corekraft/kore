// The facts plan 16 relies on, settled against a real hc core (plan 16, Step 2).
// Each is an assertion. Where hc behaves other than the plan assumed, the assertion
// says what hc does, and the plan records it. A release gate, never a commit gate:
// it starts its own scratch core under a scratch HC_SESSION and XDG dirs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunResult } from "../../src/runtime/index.js";
import {
  hcMissingReason,
  scratchCore,
  type ScratchCore,
} from "./hc-core-support.js";

const missing = await hcMissingReason();

/** The JSON hc printed, as a record. */
function json(result: RunResult): Record<string, unknown> {
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

/** The terminal hc lists under this address, from its full listing. */
async function listed(core: ScratchCore, address: string) {
  const all = json(await core.hc(["ls", "--json", "--all"]));
  const rows = all.terminals as {
    address: string;
    agent?: string;
    state?: string;
  }[];
  return rows.find((row) => row.address === address);
}

/** Waits until a predicate holds on hc's own record of the terminal, polling its get. */
async function until(
  core: ScratchCore,
  address: string,
  holds: (record: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const record = json(await core.hc(["get", "--json", address]));
    if (holds(record)) {
      return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(address + " never reached the state the fact needs");
}

const ended = (record: Record<string, unknown>) => record.state === "finished";

if (missing !== undefined) {
  it.skip(missing, () => undefined);
} else {
  let core: ScratchCore;

  beforeAll(async () => {
    core = await scratchCore();
    await core.start();
  });

  afterAll(async () => {
    await core.dispose();
  });

  describe("a parent and its children", () => {
    it("a parent's exit ends its child, which hc marks die_with_parent", async () => {
      const parent = json(
        await core.hc(["run", "--json", "--bg", "--cwd", core.dir, "--", "sh"]),
      );
      const child = json(
        await core.hc([
          "run",
          "--json",
          "--bg",
          "--cwd",
          core.dir,
          "--parent",
          parent.address as string,
          "--",
          "sh",
        ]),
      );
      const record = json(
        await core.hc(["get", "--json", child.address as string]),
      );
      expect(record.die_with_parent).toBe(true);
      await core.terminals.send(parent.address as string, "exit 0");
      await until(core, parent.address as string, ended);
      expect((await until(core, child.address as string, ended)).state).toBe(
        "finished",
      );
    });
  });

  describe("a caller that is not a terminal, and what a child's exit leaves", () => {
    it("a caller that is not a terminal runs hc with no HC_TERMINAL_ID, and run --parent still works", async () => {
      expect(core.env).not.toHaveProperty("HC_TERMINAL_ID");
      expect(core.terminals.self()).toBeUndefined();
      const parent = json(
        await core.hc(["run", "--json", "--bg", "--cwd", core.dir, "--", "sh"]),
      );
      const child = json(
        await core.hc([
          "run",
          "--json",
          "--bg",
          "--cwd",
          core.dir,
          "--parent",
          parent.address as string,
          "--",
          "sh",
        ]),
      );
      expect(
        json(await core.hc(["get", "--json", child.address as string])).parent,
      ).toBe(parent.address);
    });

    it("a plain shell parent receives no exit note from its child", async () => {
      // No positive control here: a note needs an agent parent, which only a live claude run gives (see the todos).
      const parent = json(
        await core.hc(["run", "--json", "--bg", "--cwd", core.dir, "--", "sh"]),
      ).address as string;
      const before = json(await core.hc(["read", "--json", parent])).text;
      const child = json(
        await core.hc([
          "run",
          "--json",
          "--bg",
          "--cwd",
          core.dir,
          "--parent",
          parent,
          "--",
          "sh",
          "-c",
          "exit 0",
        ]),
      ).address as string;
      await until(core, child, ended);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(json(await core.hc(["read", "--json", parent])).text).toBe(before);
    });
  });

  describe("a plain shell parent, and the listing", () => {
    it("a plain shell parent reports status null and reported false, and its listing row names agent sh", async () => {
      const parent = json(
        await core.hc(["run", "--json", "--bg", "--cwd", core.dir, "--", "sh"]),
      ).address as string;
      const record = json(await core.hc(["get", "--json", parent]));
      expect(record.status).toBeNull();
      expect(record.reported).toBe(false);
      expect((await listed(core, parent))?.agent).toBe("sh");
    });

    it("hc ls --all lists a child that finished while nobody watched it, with its exit code, and hc ls does not", async () => {
      const parent = json(
        await core.hc(["run", "--json", "--bg", "--cwd", core.dir, "--", "sh"]),
      ).address as string;
      const child = json(
        await core.hc([
          "run",
          "--json",
          "--bg",
          "--cwd",
          core.dir,
          "--parent",
          parent,
          "--",
          "sh",
        ]),
      ).address as string;
      await core.terminals.send(child, "exit 4");
      for (
        let attempt = 0;
        attempt < 200 && (await listed(core, child))?.state !== "finished";
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await listed(core, child)).toMatchObject({
        state: "finished",
        exit_code: 4,
      });
      const live = json(await core.hc(["ls", "--json"])).terminals as {
        address: string;
      }[];
      expect(live.map((row) => row.address)).not.toContain(child);
    });

    it("hc starts a child of a finished parent live, so the adapter must refuse one first", async () => {
      const parent = json(
        await core.hc(["run", "--json", "--bg", "--cwd", core.dir, "--", "sh"]),
      ).address as string;
      await core.terminals.send(parent, "exit 0");
      await until(core, parent, ended);
      const child = json(
        await core.hc([
          "run",
          "--json",
          "--bg",
          "--cwd",
          core.dir,
          "--parent",
          parent,
          "--",
          "sh",
        ]),
      ).address as string;
      expect(json(await core.hc(["get", "--json", child])).state).toBe("live");
      await core.terminals.kill(child);
    });
  });

  describe("a holder crash", () => {
    it("a holder crash ends a live terminal with reason holder_lost and no exit code, and keeps a finished one's exit code", async () => {
      const live = json(
        await core.hc(["run", "--json", "--bg", "--cwd", core.dir, "--", "sh"]),
      ).address as string;
      const finished = json(
        await core.hc(["run", "--json", "--bg", "--cwd", core.dir, "--", "sh"]),
      ).address as string;
      await core.terminals.send(finished, "exit 5");
      await until(core, finished, ended);
      const holder = json(await core.hc(["server", "status", "--json"]))
        .holder as { pid: number };
      process.kill(holder.pid, "SIGKILL");
      expect(await until(core, live, ended)).toMatchObject({
        reason: "holder_lost",
        exit_code: null,
      });
      expect(json(await core.hc(["get", "--json", finished]))).toMatchObject({
        exit_code: 5,
        reason: "exited",
      });
    });

    it.todo(
      "a core restart keeps its terminals: the brief bars hc server restart, so this is owed to a live run (plan 16, Step 2)",
    );
    it.todo(
      "an exit note reaches an agent parent, and --no-notify keeps it out: needs a live claude parent (plan 16, Step 5)",
    );
    it.todo(
      "an agent parent reports a status object, against a plain shell's null: needs a live claude parent (plan 16, Step 5)",
    );
  });

  describe("a core stop, on its own scratch core", () => {
    it("a stop ends a live terminal with reason server_stop, unless it was kept", async () => {
      const own = await scratchCore();
      await own.start();
      try {
        const live = json(
          await own.hc(["run", "--json", "--bg", "--cwd", own.dir, "--", "sh"]),
        ).address as string;
        await own.stop();
        expect(json(await own.hc(["get", "--json", live]))).toMatchObject({
          state: "finished",
          reason: "server_stop",
        });
      } finally {
        await own.dispose();
      }
    });
  });
}
