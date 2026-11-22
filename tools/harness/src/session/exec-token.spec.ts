import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments } from "../flag/index.js";
import { bundleMainRoot } from "../runtime/index.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { launchClaude } from "./exec.js";
import {
  AGE_KEY,
  ARGV,
  BUNDLE_URL,
  argvFor,
  INHERITED,
  INPUT,
  MAIN,
  MINTED,
  OWNER,
  SCRUBBED,
  STORE,
  WIZARD,
  answer,
  claudeRuns,
  defaults,
  flags,
  from,
  printed,
  signer,
  type Signer,
} from "./exec-support.js";

// The token path runs for real; only the JWT signing is stubbed.
const crypto = vi.hoisted(() => ({
  createSign: vi.fn<(algorithm: string) => Signer>(),
}));

vi.mock("node:crypto", () => crypto);
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  bundleMainRoot: vi.fn(),
}));
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

const INHERITED_ENV = {
  ...SCRUBBED,
  GH_TOKEN: INHERITED,
  GITHUB_TOKEN: INHERITED,
};

let deps: FakeDeps;

beforeEach(() => {
  vi.clearAllMocks();
  deps = fakeDeps();
  defaults(deps);
  vi.mocked(bundleMainRoot).mockResolvedValue(MAIN);
  crypto.createSign.mockReturnValue(signer());
  flags({ "role-tokens": true, "owner-writer": false });
  answer(deps);
});

describe("launchClaude: the GitHub token", () => {
  it("runs claude with the role's minted token, the main bundle, and no inherited GitHub token or herdr variable", async () => {
    deps.env = {
      ...INHERITED_ENV,
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1-p2",
    };

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(0);
    expect(deps.runner.run).toHaveBeenCalledWith("claude", ARGV, {
      env: {
        ...SCRUBBED,
        GH_TOKEN: MINTED,
        KORE_HARNESS_BUNDLE: "/repo/skills/bin/harness.mjs",
      },
      inherit: true,
    });
    expect(printed(deps)).not.toContain(INHERITED);
    expect(printed(deps)).not.toContain(MINTED);
  });

  it("runs every call of the token path with the scrubbed environment, never the inherited token", async () => {
    deps.env = INHERITED_ENV;

    await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(deps.runner.run).toHaveBeenCalledWith("sops", expect.any(Array), {
      env: SCRUBBED,
    });
    expect(deps.runner.run).toHaveBeenCalledWith("curl", expect.any(Array), {
      input: expect.any(String),
      env: SCRUBBED,
    });
  });

  it("reads the flags and the identity store from the main checkout, not the worktree", async () => {
    await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(environments).toHaveBeenCalledWith(deps.fs, MAIN);
  });
});

describe("launchClaude: the owner token, and roles without one", () => {
  it("with owner-writer on, runs gh for the owner's token with the scrubbed environment, not the inherited one", async () => {
    flags({ "role-tokens": true, "owner-writer": true });
    deps.env = INHERITED_ENV;

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(0);
    expect(deps.runner.run).toHaveBeenCalledWith("gh", ["auth", "token"], {
      env: SCRUBBED,
    });
    expect(deps.runner.run).toHaveBeenCalledWith(
      "claude",
      ARGV,
      expect.objectContaining({
        env: expect.objectContaining({ GH_TOKEN: OWNER }),
      }),
    );
    expect(printed(deps)).not.toContain(INHERITED);
    expect(printed(deps)).not.toContain(OWNER);
  });

  it("runs a role with no identity of its own with no GitHub token, and reads no store", async () => {
    deps.env = INHERITED_ENV;

    const code = await launchClaude(from(deps, BUNDLE_URL), {
      ...INPUT,
      role: "reader",
    });

    expect(code).toBe(0);
    expect(deps.runner.run).toHaveBeenCalledWith("claude", argvFor("reader"), {
      env: {
        ...SCRUBBED,
        KORE_HARNESS_BUNDLE: "/repo/skills/bin/harness.mjs",
      },
      inherit: true,
    });
    expect(deps.fs.exists).not.toHaveBeenCalled();
  });

  it("refuses a role that has an identity when the role-tokens flag is off, with one line, and starts nothing", async () => {
    flags({ "role-tokens": false });

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      "The writer role needs its GitHub identity, but no token was minted: the role-tokens flag is off in the local overlay of the main checkout. Turn it on, then rerun. Nothing was started.\n",
    );
    expect(claudeRuns(deps)).toEqual([]);
    expect(deps.runner.run.mock.calls.map(([command]) => command)).toEqual([
      "claude",
    ]);
  });
});

describe("launchClaude: a token that cannot be made", () => {
  it("refuses a missing identity store, naming it and the transfer step, and starts nothing", async () => {
    deps.fs.exists.mockResolvedValue(false);
    deps.env = INHERITED_ENV;

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      `The writer identity is missing: the identity store ${STORE} was not found. From the Mac, run \`bash ${WIZARD} --transfer <user@host>\`, then rerun.\n`,
    );
    expect(claudeRuns(deps)).toEqual([]);
    expect(printed(deps)).not.toContain(INHERITED);
  });

  it("refuses an undecryptable store, naming the item and the age key, and starts nothing", async () => {
    answer(deps, { sops: { stdout: "", stderr: "", code: 1 } });
    deps.env = INHERITED_ENV;

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      `The writer identity is missing: item kore.writer.app-id could not be read from ${STORE} (it is absent, or sops could not decrypt it with the age key ${AGE_KEY}). From the Mac, run \`bash ${WIZARD} --transfer <user@host>\`, then rerun.\n`,
    );
    expect(claudeRuns(deps)).toEqual([]);
    expect(printed(deps)).not.toContain(INHERITED);
  });

  it("refuses a failed mint with GitHub's reason, and never prints a token", async () => {
    answer(deps, {
      curl: {
        stdout: '{"message":"Bad credentials"}',
        stderr: "curl: (22) The requested URL returned error: 401",
        code: 22,
      },
    });
    deps.env = INHERITED_ENV;

    const code = await launchClaude(from(deps, BUNDLE_URL), INPUT);

    expect(code).toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      `Could not mint a kore-writer installation token (curl: (22) The requested URL returned error: 401: Bad credentials). Check the App is installed on corekraft/kore and its key is current: \`bash ${WIZARD}\`.\n`,
    );
    expect(claudeRuns(deps)).toEqual([]);
    expect(printed(deps)).not.toContain(INHERITED);
    expect(printed(deps)).not.toContain("ghs_");
  });
});
