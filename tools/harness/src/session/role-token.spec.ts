import { createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testHarness } from "../testing/index.js";
import { roleToken } from "./role-token.js";
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

describe("roleToken", () => {
  it("mints a short-lived installation token for a writer, signing the App JWT in process", async () => {
    const h = testHarness({
      files: FLAG_ON,
      responses: [...keychain(WRITER_ITEMS), mintResponse],
    });
    expect(await roleToken(h.deps, "writer")).toEqual({ token: WRITER_TOKEN });

    const curl = h.runner.calls.find((c) => c.command === "curl");
    expect(curl?.args).toContain(
      "https://api.github.com/app/installations/678/access_tokens",
    );
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
      files: FLAG_ON,
      responses: [...keychain(WRITER_ITEMS), mintResponse],
    });
    await roleToken(h.deps, "writer");
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

  it("reads the judge's PAT from the keychain without calling GitHub", async () => {
    const h = testHarness({ files: FLAG_ON, responses: keychain(JUDGE_ITEMS) });
    expect(await roleToken(h.deps, "judge")).toEqual({ token: JUDGE_TOKEN });
    expect(h.runner.calls.some((c) => c.command === "curl")).toBe(false);
  });

  it("gives the orchestrator and every other role no token and never reads the keychain", async () => {
    for (const role of ["orchestrator", "reader", "concierge", "refiner"]) {
      const h = testHarness({
        files: FLAG_ON,
        responses: [...keychain(WRITER_ITEMS), ...keychain(JUDGE_ITEMS)],
      });
      expect(await roleToken(h.deps, role)).toBeUndefined();
      expect(h.runner.calls).toEqual([]);
    }
  });
});

describe("roleToken without an identity or with a failed mint", () => {
  it("names the missing keychain item and the wizard when the writer identity is absent", async () => {
    const h = testHarness({ files: FLAG_ON, responses: [keychainMiss] });
    const result = await roleToken(h.deps, "writer");
    expect(result).toHaveProperty("error");
    const { error } = result as { error: string };
    expect(error).toContain("kore.writer.app-id");
    expect(error).toContain("tools/harness/wizards/identities.sh");
  });

  it("names the wizard when the judge PAT is absent", async () => {
    const h = testHarness({ files: FLAG_ON, responses: [keychainMiss] });
    const { error } = (await roleToken(h.deps, "judge")) as { error: string };
    expect(error).toContain("kore.judge.pat");
    expect(error).toContain("tools/harness/wizards/identities.sh");
  });

  it("treats an empty keychain value as missing", async () => {
    const h = testHarness({
      files: FLAG_ON,
      responses: keychain({ "kore.judge.pat": "" }),
    });
    expect(await roleToken(h.deps, "judge")).toHaveProperty("error");
  });
});

describe("roleToken keeps secrets out of argv", () => {
  it("keeps every secret out of argv and out of the environment it hands a child", async () => {
    const h = testHarness({
      files: FLAG_ON,
      responses: [...keychain(WRITER_ITEMS), mintResponse],
    });
    await roleToken(h.deps, "writer");
    for (const call of h.runner.calls) {
      const shown = JSON.stringify([call.args, call.options?.env ?? {}]);
      expect(shown).not.toContain(APP_KEY.stored);
      expect(shown).not.toContain(WRITER_TOKEN);
      expect(shown).not.toMatch(/Bearer|BEGIN/);
    }
  });

  it("reports a failed mint without echoing the response body", async () => {
    const h = testHarness({
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
      ],
    });
    const { error } = (await roleToken(h.deps, "writer")) as { error: string };
    expect(error).toContain("401");
    expect(error).toContain("Bad credentials");
    expect(error).not.toContain("ghs_must_not_appear");
    expect(error).toContain("kore-writer");
  });

  it("rejects a mint response that carries no token", async () => {
    const h = testHarness({
      files: FLAG_ON,
      responses: [
        ...keychain(WRITER_ITEMS),
        { match: (c) => c === "curl", result: { stdout: "{}" } },
      ],
    });
    expect(await roleToken(h.deps, "writer")).toHaveProperty("error");
  });
});
