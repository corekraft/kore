import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PAT,
  PEM,
  WIZARD,
  read,
  removeScratch,
  runWizard,
  sandbox,
  type Sandbox,
} from "./identities-wizard-support.js";

afterEach(removeScratch);

/** Every answer a full run gives, in order: the writer, the judge, the reviewer and the orchestrator. */
function fullRun(pem: string): string[] {
  return [
    "", // ready to start
    "y", // an owner
    "12345", // App ID
    "y", // permissions are right
    pem,
    "y", // delete the pem
    "678", // installation id
    "y", // installed on kore only
    "kore-judge",
    PAT,
    // the reviewer App
    "55555",
    "y",
    pem,
    "y",
    "9001",
    "y",
    // the orchestrator App
    "77777",
    "y",
    pem,
    "y",
    "9002",
    "y",
  ];
}

describe("identities wizard", () => {
  it("runs every stage end to end in dry-run mode and touches nothing", () => {
    const box = sandbox();
    const result = runWizard(box, ["--dry-run"], "");
    expect(result.status).toBe(0);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      expect(result.stdout).toContain(`Stage ${n}/11`);
    }
    expect(result.stdout).not.toContain("Stage 12/");
    expect(result.stdout).toContain("Setup complete");
    // No outside tool ran: not security, gh, a browser opener or rm.
    expect(existsSync(box.calls)).toBe(false);
    expect(readdirSync(box.cwd)).toEqual([]);
    expect(readdirSync(box.home)).toEqual([]);
    expect(readFileSync(box.pem, "utf8")).toBe(PEM);
  });

  it("says in a dry run what it would store, without a prompt waiting", () => {
    const box = sandbox();
    const out = runWizard(box, ["--dry-run"], "").stdout;
    for (const item of [
      "kore.writer.app-id",
      "kore.writer.private-key",
      "kore.writer.installation-id",
      "kore.judge.pat",
      "kore.reviewer.app-id",
      "kore.reviewer.private-key",
      "kore.reviewer.installation-id",
      "kore.orchestrator.app-id",
      "kore.orchestrator.private-key",
      "kore.orchestrator.installation-id",
    ]) {
      expect(out).toContain(`would store keychain item ${item}`);
    }
  });

  it("refuses an option it does not know", () => {
    const result = runWizard(sandbox(), ["--wet"], "");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--wet");
  });
});

describe("identities wizard keychain", () => {
  it("stores each secret in the keychain through stdin, never argv, and prints none", () => {
    const box = sandbox();
    const result = runWizard(box, [], `${fullRun(box.pem).join("\n")}\n`);
    expect(result.status).toBe(0);

    const calls = read(box.calls);
    expect(calls).not.toContain("add-generic-password");
    // Ten stores through stdin: writer 3, judge 1, reviewer 3, orchestrator 3.
    expect(
      calls.split("\n").filter((l) => l.startsWith("security -i")),
    ).toEqual(Array(10).fill("security -i"));
    const stdin = read(box.securityStdin);
    const b64 = Buffer.from(PEM).toString("base64");
    expect(stdin).toContain("-s kore.writer.app-id -a kore -w 12345");
    expect(stdin).toContain("-s kore.writer.installation-id -a kore -w 678");
    expect(stdin).toContain(`-s kore.writer.private-key -a kore -w ${b64}`);
    expect(stdin).toContain(`-s kore.judge.pat -a kore -w ${PAT}`);
    expect(stdin).toContain("-s kore.reviewer.app-id -a kore -w 55555");
    expect(stdin).toContain("-s kore.reviewer.installation-id -a kore -w 9001");
    expect(stdin).toContain(`-s kore.reviewer.private-key -a kore -w ${b64}`);
    expect(stdin).toContain("-s kore.orchestrator.app-id -a kore -w 77777");
    expect(stdin).toContain(
      "-s kore.orchestrator.installation-id -a kore -w 9002",
    );
    expect(stdin).toContain(
      `-s kore.orchestrator.private-key -a kore -w ${b64}`,
    );

    const shown = `${result.stdout}${result.stderr}${calls}`;
    expect(shown).not.toContain(PAT);
    expect(shown).not.toContain(b64);
    expect(shown).not.toContain("MIItestkeymaterial");
  });

  it("passes the judge token to gh through its environment, not its arguments", () => {
    const box = sandbox();
    const input = [
      "",
      "y",
      "1",
      "y",
      box.pem,
      "n",
      "2",
      "y",
      "kore-judge",
      PAT,
    ];
    runWizard(box, [], `${input.join("\n")}\n`);
    expect(read(box.calls)).toContain("gh api user --jq .login");
    expect(read(box.calls)).not.toContain(PAT);
  });
});

describe("identities wizard re-runs", () => {
  it("keeps the reviewer's items already in the keychain and asks only for the orchestrator's", () => {
    const box = sandbox();
    writeFileSync(
      box.present,
      [
        "kore.reviewer.app-id",
        "kore.reviewer.installation-id",
        "kore.reviewer.private-key",
      ].join("\n") + "\n",
    );
    const input = [
      "",
      "y",
      "12345",
      "y",
      box.pem,
      "n",
      "678",
      "y",
      "kore-judge",
      PAT,
      // the reviewer's three stages find their items and ask nothing
      // the orchestrator App is new
      "77777",
      "y",
      box.pem,
      "n",
      "9002",
      "y",
    ];
    const result = runWizard(box, [], `${input.join("\n")}\n`);
    expect(result.status).toBe(0);

    // Each reviewer item is found and kept: no store, no prompt, no value read.
    const stdin = read(box.securityStdin);
    expect(stdin).not.toContain("-s kore.reviewer.");
    expect(result.stdout).toContain("kept keychain item kore.reviewer.app-id");
    expect(result.stdout).toContain(
      "kept keychain item kore.reviewer.private-key",
    );
    expect(result.stdout).toContain(
      "kept keychain item kore.reviewer.installation-id",
    );
    // The orchestrator's items are new, so they are stored.
    expect(stdin).toContain("-s kore.orchestrator.app-id -a kore -w 77777");
    expect(stdin).toContain(
      "-s kore.orchestrator.installation-id -a kore -w 9002",
    );
    // Only the lookups read the keychain, and none of them asks for a value.
    const lookups = read(box.calls)
      .split("\n")
      .filter((l) => l.startsWith("security find-generic-password"));
    expect(lookups.every((l) => !l.includes(" -w"))).toBe(true);
  });
});

describe("identities wizard files", () => {
  it("writes no file and removes the .pem only after you confirm", () => {
    const box = sandbox();
    const input = [
      "",
      "y",
      "1",
      "y",
      box.pem,
      "y",
      "2",
      "y",
      "kore-judge",
      PAT,
    ];
    runWizard(box, [], `${input.join("\n")}\n`);
    expect(read(box.calls)).toContain(`rm -P ${box.pem}`);
    expect(readdirSync(box.cwd)).toEqual([]);
    expect(readdirSync(box.home)).toEqual([]);

    const kept: Sandbox = sandbox();
    const decline = [
      "",
      "y",
      "1",
      "y",
      kept.pem,
      "n",
      "2",
      "y",
      "kore-judge",
      PAT,
    ];
    const result = runWizard(kept, [], `${decline.join("\n")}\n`);
    expect(read(kept.calls)).not.toContain("rm -P");
    expect(result.stdout).toContain("delete it yourself");
  });

  it("stops without storing the judge token when GitHub does not know it", () => {
    const box = sandbox();
    writeFileSync(
      join(box.bin, "gh"),
      `#!/bin/sh\ncase "$*" in "auth status") exit 0;; *) exit 1;; esac\n`,
    );
    const input = [
      "",
      "y",
      "1",
      "y",
      box.pem,
      "n",
      "2",
      "y",
      "kore-judge",
      PAT,
    ];
    const result = runWizard(box, [], `${input.join("\n")}\n`);
    expect(result.status).not.toBe(0);
    expect(read(box.securityStdin)).not.toContain("kore.judge.pat");
  });

  it("never writes a secret anywhere but the keychain or a dotenv file", () => {
    const script = readFileSync(WIZARD, "utf8");
    const stages = script.slice(script.indexOf("run_wizard() {"));
    expect(stages).not.toMatch(/write_env|set_secret|set_var/);
    expect(stages).not.toMatch(/security\s+add-generic-password/);
    expect(stages).not.toMatch(/>\s*"?\$?\{?(PEM|JUDGE|WRITER)/);
  });
});
