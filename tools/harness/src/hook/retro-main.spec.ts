// The main session's figures from one Bash command (#940): which command is a poll,
// which reads a pane result, and which types into a pane, signed or raw.

import { describe, expect, it } from "vitest";
import { mainCommand } from "./retro-main.js";

const none = { loop: false, prChecks: [], reads: 0, signed: 0, raw: 0 };

describe("mainCommand: a poll is a sleep, an until or seq loop, or a raw PR check", () => {
  it("marks a sleep, an until loop and a seq loop as a loop", () => {
    expect(mainCommand("sleep 300").loop).toBe(true);
    expect(
      mainCommand("until gh pr view 9 --json state; do sleep 5; done").loop,
    ).toBe(true);
    expect(mainCommand("for i in $(seq 1 30); do date; done").loop).toBe(true);
  });

  it("marks an ordinary command as no loop", () => {
    expect(mainCommand("npm test")).toEqual(none);
    expect(mainCommand("for f in *.ts; do echo $f; done").loop).toBe(false);
  });

  it("names the pull request of each raw gh pr checks, with or without a flag after it", () => {
    expect(mainCommand("gh pr checks 812 --watch").prChecks).toEqual(["812"]);
    expect(mainCommand("gh pr checks #812").prChecks).toEqual(["812"]);
  });

  it("does not count the harness's own pr checks wait, or a gh pr view", () => {
    expect(
      mainCommand("node skills/bin/harness.mjs pr checks 812 --wait"),
    ).toEqual(none);
    expect(mainCommand("gh pr view 812")).toEqual(none);
  });
});

describe("mainCommand: a pane-result read is herdr agent read or pane read", () => {
  it("counts each read in the command, across && and ;", () => {
    expect(
      mainCommand(
        "herdr agent read w3:p1 && herdr pane read w3:p2; herdr agent read w3:p3",
      ).reads,
    ).toBe(3);
  });

  it("does not count a listing or a status call as a read", () => {
    expect(mainCommand("herdr agent list").reads).toBe(0);
    expect(mainCommand("herdr pane list").reads).toBe(0);
  });
});

describe("mainCommand: a signed send is session send; a raw send types into a pane with herdr", () => {
  it("counts a harness session send as signed, through the harness file or its name", () => {
    expect(
      mainCommand('node skills/bin/harness.mjs session send w3 --message "go"')
        .signed,
    ).toBe(1);
    expect(mainCommand("harness session send w3 --message go").signed).toBe(1);
  });

  it("counts agent prompt, pane send-text and pane send-keys as raw", () => {
    expect(mainCommand("herdr agent prompt w3:p1 hi").raw).toBe(1);
    expect(mainCommand("herdr pane send-text w3:p1 hi").raw).toBe(1);
    expect(mainCommand("herdr pane send-keys w3:p1 Enter").raw).toBe(1);
  });

  it("counts an env assignment before the command, and no send for a session wait", () => {
    expect(mainCommand("FOO=1 herdr agent prompt w3:p1 hi").raw).toBe(1);
    expect(
      mainCommand("node skills/bin/harness.mjs session wait w3").signed,
    ).toBe(0);
  });
});
