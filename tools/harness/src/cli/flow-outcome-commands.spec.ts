import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { DEFAULT, harness } from "./ledger-commands-support.js";
import { at, finishedIdea } from "../testing/index.js";

function seeded() {
  const h = harness();
  const events = [
    ...finishedIdea(1, { approval: 3000 }),
    ...finishedIdea(2, { approval: 1000 }, 10_000),
    ...finishedIdea(3, { approval: 2000 }, 20_000),
  ];
  h.fs.files.set(DEFAULT, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return { h, argv: ["flow", "report"] };
}

describe("flow report outcome lines", () => {
  it("prints the outcome metrics, attribution and guard blocks in plain text", async () => {
    const { h, argv } = seeded();
    await run(argv, h.deps);
    expect(h.out()).toContain(
      "Attribution: no stamped sessions yet, so nothing is measured",
    );
    expect(h.out()).toContain("Main red: no check runs on main");
    expect(h.out()).toContain("Reverts: 0 of 3 merged changes");
    expect(h.out()).toContain("Live runs: no nightly runs");
    expect(h.out()).toContain(
      "Owner minutes per merged change: 0 (0 over 3 merged;",
    );
    expect(h.out()).toContain("Guard blocks: none");
  });

  it("prints the outcome numbers it was given", async () => {
    const { h, argv } = seeded();
    const ledger = h.fs.files.get(DEFAULT) ?? "";
    const extra = [
      at(1, "ci.main", { outcome: "failure" }),
      at(2, "ci.main", { outcome: "success" }),
      at(3, "ci.nightly", { outcome: "success" }),
      at(4, "guard.block", { label: "destructive", session: "s1" }),
    ];
    h.fs.files.set(
      DEFAULT,
      ledger + extra.map((e) => `${JSON.stringify(e)}\n`).join(""),
    );
    await run(argv, h.deps);
    expect(h.out()).toContain("Main red: 1 of 2 check runs on main (50%)");
    expect(h.out()).toContain("Live runs: 1 of 1 nightly runs passed (100%)");
    expect(h.out()).toContain("Guard blocks: destructive 1");
  });
});
