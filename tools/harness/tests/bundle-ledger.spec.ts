import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, "../../../skills/bin/harness.mjs");

describe("bundled ledger", () => {
  it("records an event from stdin and lists it back, under .kore/state of KORE_ROOT", () => {
    const work = mkdtempSync(join(tmpdir(), "harness-ledger-"));
    try {
      const env = { ...process.env, KORE_ROOT: work };
      const event = JSON.stringify({
        source: "claude",
        kind: "session.start",
        occurredAt: "2026-01-02T03:00:00Z",
        session: "s1",
      });
      execFileSync(process.execPath, [bundle, "ledger", "record"], {
        cwd: work,
        env,
        input: event,
      });
      const listed = JSON.parse(
        execFileSync(
          process.execPath,
          [bundle, "ledger", "list", "--json", "--session", "s1"],
          { cwd: work, env, encoding: "utf8" },
        ),
      ) as { events: { kind: string }[]; skipped: number };
      expect(listed.events.map((e) => e.kind)).toEqual(["session.start"]);
      expect(listed.skipped).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("bundled ledger concurrency", () => {
  it("keeps every event whole when six bundled records run at once", async () => {
    const work = mkdtempSync(join(tmpdir(), "harness-ledger-"));
    try {
      const env = { ...process.env, KORE_ROOT: work };
      await Promise.all(
        [1, 2, 3, 4, 5, 6].map(
          (n) =>
            new Promise<void>((done, fail) => {
              const child = spawn(
                process.execPath,
                [
                  bundle,
                  "ledger",
                  "record",
                  "--source",
                  "github",
                  "--kind",
                  "pr.opened",
                  "--occurred-at",
                  "2026-01-02T03:00:00Z",
                  "--number",
                  String(n),
                ],
                { cwd: work, env, stdio: "ignore" },
              );
              child.on("error", fail);
              child.on("exit", (code) =>
                code === 0
                  ? done()
                  : fail(new Error(`record ${n} exited ${code}`)),
              );
            }),
        ),
      );
      const listed = JSON.parse(
        execFileSync(process.execPath, [bundle, "ledger", "list", "--json"], {
          cwd: work,
          env,
          encoding: "utf8",
        }),
      ) as { events: { number: number }[]; skipped: number };
      expect(listed.skipped).toBe(0);
      expect(listed.events.map((e) => e.number).sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
