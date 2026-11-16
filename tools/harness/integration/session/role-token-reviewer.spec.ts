import { describe, expect, it } from "vitest";
import { testHarness } from "../../src/testing/index.js";
import { run } from "../../src/cli/index.js";
import {
  APP_KEY,
  FLAG_ON,
  REVIEWER_ITEMS,
  REVIEWER_TOKEN,
  flag,
  keychain,
  keychainMiss,
  reviewerMintResponse,
} from "./role-token-support.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  nameFree,
  spawnArgs,
  splitReturns,
} from "./spawn-support.js";

// The Reviewer is reached through `session spawn` as the principles-review role,
// the public surface, like the writer and judge specs beside it.
const reviewer = spawnArgs.map((arg) =>
  arg === "reader" ? "principles-review" : arg,
);
const base = [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")];
const REVIEWER_MINT =
  "https://api.github.com/app/installations/9001/access_tokens";
const WIZARD = "tools/harness/wizards/identities.sh";
// spawn refuses a role with no agent definition, so the Reviewer's definition is faked beside the overlay.
const REVIEW_DEFINITION = {
  "/repo/.claude/agents/principles-review.md":
    "---\nname: principles-review\nmodel: claude-sonnet-5-5\neffort: medium\ntools: Read, Grep, Glob, Bash\n---\nBody.\n",
};
const REVIEWER_FILES = { ...FLAG_ON, ...REVIEW_DEFINITION };

describe("a principles-review pane gets the Reviewer App's token", () => {
  it("mints the Reviewer App's installation token and hands it to the pane through the FIFO", async () => {
    const h = testHarness({
      env: INSIDE,
      files: REVIEWER_FILES,
      responses: [...keychain(REVIEWER_ITEMS), reviewerMintResponse, ...base],
    });
    expect(await run(reviewer, h.deps)).toBe(0);

    const curl = h.runner.calls.find((c) => c.command === "curl");
    expect(curl?.args).toContain(REVIEWER_MINT);
    expect(
      h.runner.calls.some((c) => c.options?.input === REVIEWER_TOKEN),
    ).toBe(true);
  });

  it("asks GitHub only for the Reviewer's grant on this repository", async () => {
    const h = testHarness({
      env: INSIDE,
      files: REVIEWER_FILES,
      responses: [...keychain(REVIEWER_ITEMS), reviewerMintResponse, ...base],
    });
    await run(reviewer, h.deps);
    const curl = h.runner.calls.find((c) => c.command === "curl");
    const body = JSON.parse(
      curl?.args[(curl.args.indexOf("--data") ?? 0) + 1] ?? "{}",
    ) as { repositories: string[]; permissions: Record<string, string> };
    expect(body.repositories).toEqual(["kore"]);
    expect(body.permissions).toEqual({
      pull_requests: "write",
      contents: "read",
      metadata: "read",
    });
  });

  it("keeps the Reviewer's key and token out of every command line and child environment", async () => {
    const h = testHarness({
      env: INSIDE,
      files: REVIEWER_FILES,
      responses: [...keychain(REVIEWER_ITEMS), reviewerMintResponse, ...base],
    });
    await run(reviewer, h.deps);
    for (const call of h.runner.calls) {
      const shown = JSON.stringify([call.args, call.options?.env ?? {}]);
      expect(shown).not.toContain(APP_KEY.stored);
      expect(shown).not.toContain(REVIEWER_TOKEN);
    }
  });
});

describe("a principles-review pane without its Reviewer token", () => {
  it("names the missing Reviewer keychain item and the wizard, before any pane is split", async () => {
    const h = testHarness({
      env: INSIDE,
      files: REVIEWER_FILES,
      responses: [
        ...keychain({
          "kore.reviewer.app-id": "55555",
          "kore.reviewer.installation-id": "9001",
        }),
        keychainMiss,
        ...base,
      ],
    });
    expect(await run(reviewer, h.deps)).toBe(1);
    expect(h.err()).toContain("kore.reviewer.private-key");
    expect(h.err()).toContain(WIZARD);
    expect(herdrCalls(h)).toEqual([]);
  });

  it("gives the Reviewer no token while the role-tokens flag is off", async () => {
    const h = testHarness({
      env: INSIDE,
      files: { ...flag(false), ...REVIEW_DEFINITION },
      responses: [...keychain(REVIEWER_ITEMS), reviewerMintResponse, ...base],
    });
    expect(await run(reviewer, h.deps)).toBe(0);
    expect(h.runner.calls.map((c) => c.command)).not.toContain("security");
    expect(h.runner.calls.map((c) => c.command)).not.toContain("curl");
  });
});
