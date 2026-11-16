import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { RunResult } from "../runtime/index.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { roleToken } from "./role-token.js";

interface Signer {
  update(data: string): Signer;
  sign(key: string): Buffer;
}

const crypto = vi.hoisted(() => ({
  createSign: vi.fn<(algorithm: string) => Signer>(),
}));

vi.mock("node:crypto", () => crypto);
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));

const PEM = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n";
const WIZARD = "tools/harness/wizards/identities.sh";
const KEY = Buffer.from(PEM).toString("base64");
const KEYCHAIN: Record<string, string | undefined> = {
  "kore.judge.pat": "github_pat_judge",
  "kore.judge.app-id": "31337",
  "kore.judge.installation-id": "679",
  "kore.judge.private-key": KEY,
  "kore.reviewer.app-id": "55555",
  "kore.reviewer.installation-id": "9001",
  "kore.reviewer.private-key": KEY,
  "kore.orchestrator.app-id": "77777",
  "kore.orchestrator.installation-id": "9002",
  "kore.orchestrator.private-key": KEY,
};
const GH_LOGIN_ERROR =
  "The owner-writer flag is on but `gh auth token` returned no token. Run `gh auth login`, then rerun. No pane was split.";

let deps: FakeDeps;

/** Answers `gh`, `security` (a missing item exits 44) and curl. */
function answer(
  items: Record<string, string | undefined>,
  gh: Partial<RunResult> = { stdout: "gho_owner\n" },
): void {
  deps.runner.run.mockImplementation((command, args) => {
    if (command === "gh") {
      return Promise.resolve({ stdout: "", stderr: "", code: 0, ...gh });
    }
    if (command === "curl") {
      return Promise.resolve({
        stdout: '{"token":"ghs_t"}',
        stderr: "",
        code: 0,
      });
    }
    const value = items[String(args[args.indexOf("-s") + 1])];
    return Promise.resolve(
      value === undefined
        ? { stdout: "", stderr: "", code: 44 }
        : { stdout: `${value}\n`, stderr: "", code: 0 },
    );
  });
}

/** The local overlay with role-tokens and owner-writer set. */
function flag(roleTokens: boolean, ownerWriter: boolean): void {
  vi.mocked(environments).mockResolvedValue(["local"]);
  vi.mocked(readOverlay).mockResolvedValue({
    environment: "local",
    path: "infra/environments/local/environment.yaml",
    text: "",
    features: { "role-tokens": roleTokens, "owner-writer": ownerWriter },
  });
}

/** The URLs curl was asked to mint from, in order. */
const mints = (): unknown[] =>
  deps.runner.run.mock.calls
    .filter((call) => call[0] === "curl")
    .map((call) => call[1].at(-1));

beforeEach(() => {
  deps = fakeDeps();
  const signer: Signer = {
    update: () => signer,
    sign: () => Buffer.from("signed"),
  };
  crypto.createSign.mockReturnValue(signer);
  answer(KEYCHAIN);
  flag(true, true);
});

describe("roleToken for a writer with the owner-writer flag on", () => {
  it("gives the owner's gh login token, with no keychain read and no mint", async () => {
    await expect(roleToken(deps, "writer")).resolves.toEqual({
      token: "gho_owner",
    });
    expect(deps.runner.run).toHaveBeenCalledExactlyOnceWith("gh", [
      "auth",
      "token",
    ]);
  });

  it("refuses with gh auth login when the command fails", async () => {
    answer(KEYCHAIN, { code: 1, stderr: "not logged in" });

    await expect(roleToken(deps, "writer")).resolves.toEqual({
      error: GH_LOGIN_ERROR,
    });
  });

  it("refuses with gh auth login when the command prints nothing", async () => {
    answer(KEYCHAIN, { stdout: "\n" });

    await expect(roleToken(deps, "writer")).resolves.toEqual({
      error: GH_LOGIN_ERROR,
    });
  });

  it("gives nothing while role-tokens is off, and runs nothing", async () => {
    flag(false, true);

    await expect(roleToken(deps, "writer")).resolves.toBeUndefined();
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("mints the kore-writer App token while owner-writer is off", async () => {
    flag(true, false);
    answer({
      "kore.writer.app-id": "12345",
      "kore.writer.installation-id": "678",
      "kore.writer.private-key": KEY,
    });

    await expect(roleToken(deps, "writer")).resolves.toEqual({
      token: "ghs_t",
    });
    expect(deps.runner.run).not.toHaveBeenCalledWith("gh", ["auth", "token"]);
  });
});

describe("roleToken for a judge with the owner-writer flag on", () => {
  it("mints from the kore-judge App with its grant and never reads the PAT", async () => {
    answer({ ...KEYCHAIN, "kore.judge.pat": undefined });

    await expect(roleToken(deps, "judge")).resolves.toEqual({ token: "ghs_t" });
    expect(mints()).toEqual([
      "https://api.github.com/app/installations/679/access_tokens",
    ]);
    const calls = deps.runner.run.mock.calls;
    expect(calls.map((call) => call[1].join(" ")).join("\n")).not.toContain(
      "kore.judge.pat",
    );
    const args = calls.at(-1)?.[1] ?? [];
    expect(JSON.parse(String(args[args.indexOf("--data") + 1]))).toEqual({
      repositories: ["kore"],
      permissions: {
        pull_requests: "write",
        contents: "read",
        metadata: "read",
      },
    });
  });

  it("names the judge identity and the wizard when an App item is missing", async () => {
    answer({ ...KEYCHAIN, "kore.judge.app-id": undefined });

    await expect(roleToken(deps, "judge")).resolves.toEqual({
      error: `The judge identity is missing: keychain item kore.judge.app-id was not found. Create it with \`bash ${WIZARD}\`, then rerun. No pane was split.`,
    });
  });

  it("still reads the judge PAT while owner-writer is off", async () => {
    flag(true, false);

    await expect(roleToken(deps, "judge")).resolves.toEqual({
      token: "github_pat_judge",
    });
    expect(mints()).toEqual([]);
  });
});

describe("roleToken for the other roles with the owner-writer flag on", () => {
  it("leaves the reviewer and orchestrator on their Apps and runs no gh", async () => {
    await roleToken(deps, "principles-review");
    await roleToken(deps, "orchestrator");

    expect(mints()).toEqual([
      "https://api.github.com/app/installations/9001/access_tokens",
      "https://api.github.com/app/installations/9002/access_tokens",
    ]);
    expect(deps.runner.run).not.toHaveBeenCalledWith("gh", ["auth", "token"]);
  });
});
