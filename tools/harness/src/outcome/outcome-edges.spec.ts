import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { outcomeSection } from "../idea/index.js";
import { harness, newArgs } from "../testing/records-support.js";
import {
  LEDGER,
  PATH,
  fakeGh,
  linked,
  record,
  withFlag,
} from "./outcome-support.js";

const CLOSE = ["outcome", "close", "--idea", "1", "--ledger", LEDGER];

describe("harness outcome edge cases", () => {
  it("repairs a lost ledger event on a later close even when GitHub is already current", async () => {
    const { h } = await linked();
    h.fs.appendFile = () => Promise.reject(new Error("disk full"));
    await expect(run(record(), h.deps)).rejects.toThrow("disk full");
    expect(h.get(".kore/state/ledger.jsonl")).toBeUndefined();
    h.fs.appendFile = (path: string, text: string) => {
      h.fs.files.set(path, (h.fs.files.get(path) ?? "") + text);
      return Promise.resolve();
    };
    expect(await run(CLOSE, h.deps)).toBe(0);
    expect(await run(CLOSE, h.deps)).toBe(0);
    expect(
      (h.get(".kore/state/ledger.jsonl") ?? "").trim().split("\n"),
    ).toHaveLength(1);
  });
  it("gives the follow-ups of two ideas with long shared slug prefixes two distinct files", async () => {
    const h = harness();
    const prefix = "Reduce the time every local cluster takes to converge";
    await run(
      [...newArgs(`${prefix} on the first run`), "--issue", "300"],
      h.deps,
    );
    await run(
      [...newArgs(`${prefix} on a fresh profile`), "--issue", "301"],
      h.deps,
    );
    fakeGh(h, { state: "OPEN", labels: [], comments: [] });
    for (const idea of ["1", "2"]) {
      await run(
        withFlag(record(), "--idea", idea).concat(["--result", "refuted"]),
        h.deps,
      );
    }
    const followUps = h
      .paths()
      .filter((p) => /^docs\/ideas\/\d{4}-follow-up-/.test(p));
    expect(followUps).toHaveLength(2);
    expect(new Set(followUps).size).toBe(2);
    const parents = followUps.map(
      (p) => /^parent: (\d{4})$/m.exec(h.get(p) ?? "")?.[1],
    );
    expect(parents.sort((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual([
      "0001",
      "0002",
    ]);
  });
});

describe("harness outcome input and file edges", () => {
  it("rejects an HTML comment that could forge the posted marker", async () => {
    const { h } = await linked();
    const forged = "x <!-- harness outcome idea 0001 -->";
    expect(await run(withFlag(record(), "--summary", forged), h.deps)).toBe(1);
    expect(h.err()).toMatch(/must not contain an HTML comment/);
    expect(await run(withFlag(record(), "--evidence", forged), h.deps)).toBe(1);
    expect(h.get(PATH)).not.toMatch(/^outcome:/m);
  });

  it("finds the outcome section in a CRLF file and keeps it out of the issue body", async () => {
    const { h } = await linked();
    await run(record(), h.deps);
    const crlf = (h.get(PATH) ?? "")
      .replace("## Outcome", "## Outcome  ")
      .replace(/\n/g, "\r\n");
    h.set(PATH, crlf);
    expect(outcomeSection(crlf)).toMatch(/^## Outcome/);
    expect(outcomeSection(crlf)).not.toContain("\r");
    h.runner.calls.length = 0;
    await run(["idea", "sync", "--idea", "1"], h.deps);
    const bodies = h.runner.calls.map((c) => c.options?.input ?? "").join("");
    expect(bodies).not.toContain("Up time fell");
  });

  it("keeps a later section in the issue body while leaving the outcome out of it", async () => {
    const { h } = await linked();
    await run(record(), h.deps);
    h.set(PATH, `${h.get(PATH) ?? ""}\n## Notes\n\nKeep me.\n`);
    h.runner.calls.length = 0;
    await run(["idea", "sync", "--idea", "1"], h.deps);
    const bodies = h.runner.calls.map((c) => c.options?.input ?? "").join("");
    expect(bodies).toContain("Keep me.");
    expect(bodies).not.toContain("Up time fell");
  });
});
