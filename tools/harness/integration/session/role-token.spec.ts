import { createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testHarness } from "../../src/testing/index.js";
import { run } from "../../src/cli/index.js";
import {
  APP_KEY,
  FLAG_ON,
  JUDGE_ITEMS,
  JUDGE_TOKEN,
  WRITER_ITEMS,
  WRITER_TOKEN,
  keychain,
  keychainMiss,
  mintResponse,
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

// roleToken is reached through `session spawn`, the public surface: the barrel
// exports no more than that, and an integration spec imports only barrels.
const asRole = (role: string) =>
  spawnArgs.map((arg) => (arg === "reader" ? role : arg));
const writer = [...asRole("writer"), "--worktree"];
const base = [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")];
const MINT = "https://api.github.com/app/installations/678/access_tokens";
const WIZARD = "tools/harness/wizards/identities.sh";

describe("a writer's token, minted with real crypto", () => {
  it("mints a short-lived installation token, signing the App JWT in process", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain(WRITER_ITEMS), mintResponse, ...base],
    });
    expect(await run(writer, h.deps)).toBe(0);

    const curl = h.runner.calls.find((c) => c.command === "curl");
    expect(curl?.args).toContain(MINT);
    const bearer = /Authorization: Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)"/.exec(
      curl?.options?.input ?? "",
    );
    expect(bearer).not.toBeNull();
    const [, header, payload, signature] = bearer as RegExpExecArray;
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${payload}`);
    expect(
      verify.verify(APP_KEY.publicKey, Buffer.from(signature!, "base64url")),
    ).toBe(true);
    const claims = JSON.parse(
      Buffer.from(payload!, "base64url").toString(),
    ) as { iss: string; iat: number; exp: number };
    expect(claims.iss).toBe("12345");
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });

  it("asks only for the writer's permissions on this repository", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain(WRITER_ITEMS), mintResponse, ...base],
    });
    await run(writer, h.deps);
    const curl = h.runner.calls.find((c) => c.command === "curl");
    const body = JSON.parse(
      curl?.args[(curl.args.indexOf("--data") ?? 0) + 1] ?? "{}",
    ) as { repositories: string[]; permissions: Record<string, string> };
    expect(body.repositories).toEqual(["kore"]);
    expect(body.permissions).toEqual({
      contents: "write",
      pull_requests: "write",
      metadata: "read",
    });
  });
});

describe("a writer's token stays out of argv, the environment and the mint's error", () => {
  it("keeps the secrets out of every command line and child environment", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain(WRITER_ITEMS), mintResponse, ...base],
    });
    await run(writer, h.deps);
    for (const call of h.runner.calls) {
      const shown = JSON.stringify([call.args, call.options?.env ?? {}]);
      expect(shown).not.toContain(APP_KEY.stored);
      expect(shown).not.toContain(WRITER_TOKEN);
      expect(shown).not.toMatch(/Bearer|BEGIN/);
    }
  });

  it("refuses a mint that carries no token", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [
        ...keychain(WRITER_ITEMS),
        { match: (c) => c === "curl", result: { stdout: "{}" } },
        ...base,
      ],
    });
    expect(await run(writer, h.deps)).toBe(1);
    expect(h.err()).toContain("the response carried no token");
  });
});

describe("a judge's PAT and the roles without a token", () => {
  it("hands a judge the PAT from the keychain, and never calls GitHub for it", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain(JUDGE_ITEMS), ...base],
    });
    expect(await run(asRole("judge"), h.deps)).toBe(0);
    expect(h.runner.calls.some((c) => c.command === "curl")).toBe(false);
    expect(h.runner.calls.some((c) => c.options?.input === JUDGE_TOKEN)).toBe(
      true,
    );
  });

  it("gives the orchestrator no token and never reads the keychain", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain(WRITER_ITEMS), ...keychain(JUDGE_ITEMS), ...base],
    });
    expect(await run(asRole("orchestrator"), h.deps)).toBe(0);
    expect(h.runner.calls.map((c) => c.command)).not.toContain("security");
    expect(h.runner.calls.map((c) => c.command)).not.toContain("curl");
  });

  it("treats an empty keychain value as missing", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain({ "kore.judge.pat": "" }), ...base],
    });
    expect(await run(asRole("judge"), h.deps)).toBe(1);
    expect(h.err()).toContain("The judge identity is missing");
  });
});

describe("a missing identity or a failed mint", () => {
  it("names the missing writer keychain item and the wizard, before any pane is split", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [keychainMiss, ...base],
    });
    expect(await run(writer, h.deps)).toBe(1);
    expect(h.err()).toContain("kore.writer.app-id");
    expect(h.err()).toContain(WIZARD);
    expect(herdrCalls(h)).toEqual([]);
  });

  it("names the wizard when the judge PAT is absent", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [keychainMiss, ...base],
    });
    expect(await run(asRole("judge"), h.deps)).toBe(1);
    expect(h.err()).toContain("kore.judge.pat");
    expect(h.err()).toContain(WIZARD);
  });

  it("reports a failed mint with GitHub's message, and never echoes the response body", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [
        ...keychain(WRITER_ITEMS),
        {
          match: (c) => c === "curl",
          result: {
            code: 22,
            stderr: "curl: (22) The requested URL returned error: 401",
            stdout: JSON.stringify({
              message: "Bad credentials",
              token: "ghs_must_not_appear",
            }),
          },
        },
        ...base,
      ],
    });
    expect(await run(writer, h.deps)).toBe(1);
    expect(h.err()).toContain("401");
    expect(h.err()).toContain("Bad credentials");
    expect(h.err()).not.toContain("ghs_must_not_appear");
    expect(h.err()).toContain("kore-writer");
  });
});
