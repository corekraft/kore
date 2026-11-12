import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { PATH, ghWrites, linked, record, withFlag } from "./outcome-support.js";

const PROOF = ["--flag", "ingress-agentgateway", "--environment", "local"];
const live = (extra: string[] = PROOF) =>
  withFlag(
    withFlag(record(extra), "--kind", "verification"),
    "--source",
    "live-run",
  );

describe("harness outcome record --flag --environment", () => {
  it("writes the flag and environment into the outcome section", async () => {
    const { h } = await linked();
    expect(await run(live(), h.deps)).toBe(0);
    const file = h.get(PATH) ?? "";
    expect(file).toContain("- Flag: ingress-agentgateway\n");
    expect(file).toContain("- Environment: local\n");
  });

  it("writes neither line when the outcome is not about a flag", async () => {
    const { h } = await linked();
    await run(record(), h.deps);
    expect(h.get(PATH)).not.toMatch(/- Flag:|- Environment:/);
  });

  it.each([
    ["--flag without --environment", ["--flag", "x"], /--environment/],
    ["--environment without --flag", ["--environment", "local"], /--flag/],
  ])("rejects %s before any write", async (_name, extra, message) => {
    const { h } = await linked();
    const before = h.get(PATH);
    expect(await run(live(extra), h.deps)).toBe(1);
    expect(h.err()).toMatch(message);
    expect(h.get(PATH)).toBe(before);
    expect(ghWrites(h)).toHaveLength(0);
  });

  it.each([
    ["kind", withFlag(live(), "--kind", "experiment")],
    ["source", withFlag(live(), "--source", "journal")],
  ])(
    "rejects flag proof whose %s is not a live verification",
    async (_n, argv) => {
      const { h } = await linked();
      expect(await run(argv, h.deps)).toBe(1);
      expect(h.err()).toMatch(/verification.*live-run/);
      expect(ghWrites(h)).toHaveLength(0);
    },
  );

  it("rejects a flag or environment name that is not a lowercase name", async () => {
    const { h } = await linked();
    const argv = live(["--flag", "Bad Flag", "--environment", "local"]);
    expect(await run(argv, h.deps)).toBe(1);
    expect(h.err()).toMatch(/--flag "Bad Flag"/);
  });
});

describe("harness outcome record summary", () => {
  it.each(["- Environment: local", "- Result: confirmed", "- Flag: x"])(
    "rejects a summary line %s that would override a recorded field",
    async (line) => {
      const { h } = await linked();
      const before = h.get(PATH);
      const argv = withFlag(live(), "--summary", `Worked.\n${line}`);
      expect(await run(argv, h.deps)).toBe(1);
      expect(h.err()).toMatch(/must not start a line with "- Name:"/);
      expect(h.get(PATH)).toBe(before);
      expect(ghWrites(h)).toHaveLength(0);
    },
  );
});
