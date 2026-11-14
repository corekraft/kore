import { describe, expect, it } from "vitest";
import { testHarness } from "../../src/testing/index.js";
import { run } from "../../src/cli/index.js";
import {
  FLAG_ON,
  JUDGE_ITEMS,
  OVERLAY,
  JUDGE_TOKEN,
  WRITER_ITEMS,
  WRITER_TOKEN,
  flag,
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

const asRole = (role: string) =>
  spawnArgs.map((arg) => (arg === "reader" ? role : arg));
const writer = [...asRole("writer"), "--worktree"];
const base = [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")];
const WIZARD = "tools/harness/wizards/identities.sh";

/** Every value a spawn put in a command line or a child's environment. */
function exposed(h: ReturnType<typeof testHarness>): string {
  return JSON.stringify(
    h.runner.calls.map((c) => [c.command, c.args, c.options?.env]),
  );
}

describe("session spawn gives each role its own GitHub token", () => {
  it("hands a writer pane a minted installation token through the FIFO, before its agent starts", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain(WRITER_ITEMS), mintResponse, ...base],
    });
    expect(await run(writer, h.deps)).toBe(0);

    const kinds = h.runner.calls.map((c) =>
      c.command === "herdr"
        ? `herdr ${c.args.slice(0, 2).join(" ")}`
        : c.command,
    );
    const handed = kinds.indexOf("herdr pane run");
    expect(handed).toBeGreaterThan(kinds.indexOf("herdr pane split"));
    expect(handed).toBeLessThan(kinds.indexOf("herdr agent start"));
    const write = h.runner.calls.find((c) => c.options?.input === WRITER_TOKEN);
    expect(write?.command).toBe("sh");
    expect(write?.options?.timeoutMs).toBeGreaterThan(0);
    const told = h.runner.calls.find((c) => c.args[1] === "run");
    expect(told?.args[3]).toMatch(
      /^export GH_TOKEN="\$\(cat '\/main\/\.kore\/state\/handoff\/image-trust-writer\/token'\)"; \[ -n "\$GH_TOKEN" \] \|\| exit 1$/,
    );
  });

  it("hands a judge pane the judge's PAT and never calls GitHub for it", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain(JUDGE_ITEMS), ...base],
    });
    expect(await run(asRole("judge"), h.deps)).toBe(0);
    expect(
      h.runner.calls.find((c) => c.options?.input === JUDGE_TOKEN),
    ).toBeDefined();
    expect(h.runner.calls.some((c) => c.command === "curl")).toBe(false);
  });

  it("gives the orchestrator no token and never touches the keychain or a FIFO", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [
        ...keychain(WRITER_ITEMS),
        ...keychain(JUDGE_ITEMS),
        mintResponse,
        ...base,
      ],
    });
    expect(await run(asRole("orchestrator"), h.deps)).toBe(0);
    const commands = h.runner.calls.map((c) => c.command);
    expect(commands).not.toContain("security");
    expect(commands).not.toContain("curl");
    expect(commands).not.toContain("mkfifo");
    expect(h.runner.calls.some((c) => c.args[1] === "run")).toBe(false);
  });

  it("keeps both tokens out of every command line and child environment", async () => {
    for (const [args, items, token] of [
      [writer, [...keychain(WRITER_ITEMS), mintResponse], WRITER_TOKEN],
      [asRole("judge"), keychain(JUDGE_ITEMS), JUDGE_TOKEN],
    ] as const) {
      const h = testHarness({
        env: INSIDE,
        files: FLAG_ON,
        responses: [...items, ...base],
      });
      await run(args, h.deps);
      expect(exposed(h)).not.toContain(token);
      expect(h.out() + h.err()).not.toContain(token);
    }
  });
});

describe("session spawn keeps tokens out of the pane split", () => {
  it("does not stamp the token into the pane's split environment", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain(WRITER_ITEMS), mintResponse, ...base],
    });
    await run(writer, h.deps);
    const split = herdrCalls(h).find((c) => c.includes("pane split"));
    expect(split).not.toContain("GH_TOKEN");
  });
});

describe("session spawn stops cleanly when a token cannot be delivered", () => {
  it("fails before splitting a pane when the writer identity is missing, naming the wizard", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [keychainMiss, ...base],
    });
    expect(await run(writer, h.deps)).toBe(1);
    expect(h.err()).toContain("kore.writer.app-id");
    expect(h.err()).toContain(WIZARD);
    expect(herdrCalls(h)).toEqual([]);
    expect(h.runner.calls.some((c) => c.command === "git")).toBe(false);
  });

  it("fails before splitting a pane when the judge PAT is missing, naming the wizard", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [keychainMiss, ...base],
    });
    expect(await run(asRole("judge"), h.deps)).toBe(1);
    expect(h.err()).toContain(WIZARD);
    expect(herdrCalls(h)).toEqual([]);
  });

  it("stops without starting the agent when the pane never reads its token, and says to close the pane", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [
        ...keychain(JUDGE_ITEMS),
        {
          match: (c, a) => c === "sh" && a[1]?.includes("cat >") === true,
          result: { code: 124, stderr: "timed out after 10000 ms" },
        },
        ...base,
      ],
    });
    expect(await run(asRole("judge"), h.deps)).toBe(1);
    expect(h.err()).toContain("herdr pane close w3:p9");
    expect(herdrCalls(h).some((c) => c.includes("agent start"))).toBe(false);
    expect(h.err()).not.toContain(JUDGE_TOKEN);
  });
});

describe("session spawn reports a failed token delivery", () => {
  it("reports a failed agent start for a token pane with the likely cause", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [
        ...keychain(JUDGE_ITEMS),
        {
          match: (c, a) => c === "herdr" && a[1] === "start",
          result: { code: 1, stderr: "pane_not_found" },
        },
        ...base,
      ],
    });
    expect(await run(asRole("judge"), h.deps)).toBe(1);
    expect(h.err()).toContain("agent start failed");
    expect(h.err()).toContain("read no token");
  });

  it("removes the FIFO directory whether the handoff worked or not", async () => {
    const h = testHarness({
      env: INSIDE,
      files: FLAG_ON,
      responses: [...keychain(JUDGE_ITEMS), ...base],
    });
    await run(asRole("judge"), h.deps);
    const last = h.runner.calls.filter((c) => c.command === "rm").at(-1);
    expect(last?.args).toEqual([
      "-rf",
      "/main/.kore/state/handoff/image-trust-writer",
    ]);
  });
});

describe("session spawn behind the role-tokens flag", () => {
  const spawned = (files: Record<string, string>, role: string[]) => {
    const h = testHarness({
      env: INSIDE,
      files,
      responses: [keychainMiss, ...base],
    });
    return { h, done: run(role, h.deps) };
  };

  it.each([
    ["off in the local overlay", flag(false)],
    ["not declared in the overlay", { [OVERLAY]: JSON.stringify({}) }],
    ["without an overlay at all", {}],
  ])(
    "spawns a writer and a judge exactly as before when the flag is %s",
    async (_why, files) => {
      for (const role of [writer, asRole("judge")]) {
        const { h, done } = spawned(files, role);
        expect(await done).toBe(0);
        const commands = h.runner.calls.map((c) => c.command);
        for (const touched of ["security", "curl", "mkfifo", "sh"]) {
          expect(commands).not.toContain(touched);
        }
        expect(h.runner.calls.some((c) => c.args[1] === "run")).toBe(false);
        expect(herdrCalls(h).some((c) => c.includes("agent start"))).toBe(true);
      }
    },
  );

  it("fails a writer spawn with the wizard hint when the flag is on and the identity is missing", async () => {
    const { h, done } = spawned(FLAG_ON, writer);
    expect(await done).toBe(1);
    expect(h.err()).toContain(WIZARD);
    expect(herdrCalls(h)).toEqual([]);
  });

  it("stops with the overlay's own error when the local overlay is not valid", async () => {
    const { h, done } = spawned({ [OVERLAY]: "not json" }, writer);
    expect(await done).toBe(1);
    expect(h.err()).toContain("environment.yaml");
    expect(herdrCalls(h)).toEqual([]);
  });
});
