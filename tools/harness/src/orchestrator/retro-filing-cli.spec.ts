import { describe, expect, it } from "vitest";
import type { RunResult, Runner } from "../runtime/index.js";
import { RetroFilingCli } from "./retro-filing-cli.js";
import type { Proposal } from "./retro-proposals.js";

const NOW = "2026-11-15T10:00:00.000Z";

const proposal: Proposal = {
  title: "Cut send-backs",
  hypothesis: "h",
  expectedOutcome: "e",
  measurement: "m",
  safetyPattern: "no-behaviour-change",
  metric: "friction.total",
  direction: "down",
  window: "14d",
};

function setup(answer: (args: string[]) => Partial<RunResult> = () => ({})) {
  const calls: string[][] = [];
  const runner: Runner = {
    run: (_command, args) => {
      calls.push(args.slice(1));
      return Promise.resolve({
        stdout: "",
        stderr: "",
        code: 0,
        ...answer(args.slice(1)),
      });
    },
  };
  return { cli: new RetroFilingCli(runner, "root", () => NOW), calls };
}

describe("RetroFilingCli", () => {
  it("files a proposal as a harness idea under its key, and reports whether it was created", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({ created: true, number: "0042" }),
    }));

    expect(await cli.file("retro-1-ab", proposal)).toEqual({
      created: true,
      number: "0042",
    });
    expect(calls).toEqual([
      [
        "idea",
        "new",
        "--slug",
        "retro-1-ab",
        "--title",
        "Cut send-backs",
        "--hypothesis",
        "h",
        "--expected-outcome",
        "e",
        "--measurement",
        "m",
        "--safety-pattern",
        "no-behaviour-change",
        "--kind",
        "harness",
        "--metric",
        "friction.total",
        "--direction",
        "down",
        "--window",
        "14d",
        "--json",
      ],
    ]);
  });

  it("names the failed tool when the idea domain refuses a proposal", async () => {
    const { cli } = setup(() => ({ code: 1, stderr: "bad slug" }));

    await expect(cli.file("k", proposal)).rejects.toThrow(
      "`harness idea new --slug k` failed: bad slug.",
    );
  });
});

describe("RetroFilingCli ledger events", () => {
  it("records the idea-filed event with the idea and its key", async () => {
    const { cli, calls } = setup();

    await cli.recordFiled("0042", "retro-1-ab");

    expect(calls).toEqual([
      [
        "ledger",
        "record",
        "--source",
        "claude",
        "--kind",
        "idea.filed",
        "--occurred-at",
        NOW,
        "--idea",
        "0042",
        "--label",
        "retro-1-ab",
      ],
    ]);
  });

  it("records the dropped count once per trigger", async () => {
    const { cli, calls } = setup((args) =>
      args[1] === "list" ? { stdout: JSON.stringify({ events: [] }) } : {},
    );

    await cli.recordDropped("retro-1", 2);

    expect(calls.at(-1)).toEqual([
      "ledger",
      "record",
      "--source",
      "claude",
      "--kind",
      "retro.dropped",
      "--occurred-at",
      NOW,
      "--label",
      "retro-1",
      "--number",
      "2",
    ]);
  });

  it("records nothing when the trigger's dropped count is already in the ledger", async () => {
    const { cli, calls } = setup(() => ({
      stdout: JSON.stringify({ events: [{ label: "retro-1" }] }),
    }));

    await cli.recordDropped("retro-1", 2);

    expect(calls).toEqual([
      ["ledger", "list", "--kind", "retro.dropped", "--json"],
    ]);
  });
});
