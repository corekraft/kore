import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, FlagError, readOverlay } from "../flag/index.js";
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
const NOW = "2026-01-02T03:04:05.000Z";
const KEYCHAIN: Record<string, string | undefined> = {
  "kore.writer.app-id": "12345",
  "kore.writer.installation-id": "678",
  "kore.writer.private-key": Buffer.from(PEM).toString("base64"),
  "kore.judge.pat": "github_pat_judge",
};
const WIZARD = "tools/harness/wizards/identities.sh";
const MINT = "https://api.github.com/app/installations/678/access_tokens";

let deps: FakeDeps;

/** A signer whose sign returns the given signature; each call is recorded on the spies. */
function signer(signature: Buffer) {
  const update = vi.fn((_data: string): Signer => self);
  const sign = vi.fn((_key: string) => signature);
  const self: Signer = { update, sign };
  return { signer: self, update, sign };
}

/** Answers `security` from the items (a missing one exits 44) and curl with the given reply. */
function answer(
  items: Record<string, string | undefined>,
  curl: Partial<RunResult> = { stdout: '{"token":"ghs_t"}' },
): void {
  deps.runner.run.mockImplementation((command, args) => {
    if (command === "curl") {
      return Promise.resolve({ stdout: "", stderr: "", code: 0, ...curl });
    }
    const value = items[String(args[args.indexOf("-s") + 1])];
    return Promise.resolve(
      value === undefined
        ? { stdout: "", stderr: "", code: 44 }
        : { stdout: `${value}\n`, stderr: "", code: 0 },
    );
  });
}

/** The flag overlay for the local environment, with role-tokens on or off. */
function flag(on: boolean): void {
  vi.mocked(environments).mockResolvedValue(["local"]);
  vi.mocked(readOverlay).mockResolvedValue({
    environment: "local",
    path: "infra/environments/local/environment.yaml",
    text: "",
    features: { "role-tokens": on },
  });
}

beforeEach(() => {
  deps = fakeDeps();
  crypto.createSign.mockReturnValue(signer(Buffer.from("signed")).signer);
  answer(KEYCHAIN);
  flag(true);
});

describe("roleToken reads nothing for a role without an identity", () => {
  it("returns undefined for the orchestrator, without the flag or the keychain", async () => {
    await expect(roleToken(deps, "orchestrator")).resolves.toBeUndefined();

    expect(environments).not.toHaveBeenCalled();
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("returns undefined while the role-tokens flag is off, so spawn behaves as before", async () => {
    flag(false);

    await expect(roleToken(deps, "writer")).resolves.toBeUndefined();
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("returns undefined when the repository has no local overlay", async () => {
    vi.mocked(environments).mockResolvedValue(["ci"]);

    await expect(roleToken(deps, "judge")).resolves.toBeUndefined();
    expect(readOverlay).not.toHaveBeenCalled();
  });

  it("refuses, naming the overlay problem, when the overlay is malformed", async () => {
    vi.mocked(readOverlay).mockRejectedValue(
      new FlagError("The local overlay is not JSON."),
    );

    await expect(roleToken(deps, "writer")).resolves.toEqual({
      error: "The local overlay is not JSON. No pane was split.",
    });
  });

  it("rethrows a failure to read the overlay that is not a flag error", async () => {
    vi.mocked(readOverlay).mockRejectedValue(new Error("EIO: read failed"));

    await expect(roleToken(deps, "writer")).rejects.toThrow("EIO: read failed");
  });
});

describe("roleToken for a judge", () => {
  it("returns the judge's PAT from its keychain item", async () => {
    await expect(roleToken(deps, "judge")).resolves.toEqual({
      token: "github_pat_judge",
    });
    expect(deps.runner.run).toHaveBeenCalledExactlyOnceWith("security", [
      "find-generic-password",
      "-s",
      "kore.judge.pat",
      "-a",
      "kore",
      "-w",
    ]);
  });

  it("refuses, naming the item and the wizard, when the PAT is missing", async () => {
    answer({});

    await expect(roleToken(deps, "judge")).resolves.toEqual({
      error: `The judge identity is missing: keychain item kore.judge.pat was not found. Create it with \`bash ${WIZARD}\`, then rerun. No pane was split.`,
    });
  });
});

describe("roleToken signs and mints for a writer", () => {
  it("signs an App JWT in this process and exchanges it for an installation token", async () => {
    const jwt = signer(Buffer.from("signed"));
    crypto.createSign.mockReturnValue(jwt.signer);

    const result = await roleToken(deps, "writer");

    expect(result).toEqual({ token: "ghs_t" });
    expect(crypto.createSign).toHaveBeenCalledExactlyOnceWith("RSA-SHA256");
    expect(jwt.sign).toHaveBeenCalledExactlyOnceWith(PEM);
    const [unsigned] = jwt.update.mock.calls[0] ?? [""];
    const payload = JSON.parse(
      Buffer.from(String(unsigned).split(".")[1] ?? "", "base64url").toString(),
    ) as Record<string, unknown>;
    const issued = Date.parse(NOW) / 1000 - 60;
    expect(payload).toEqual({ iat: issued, exp: issued + 540, iss: "12345" });
  });

  it("sends the JWT through curl's config on stdin, never on the command line", async () => {
    await roleToken(deps, "writer");

    const curl = deps.runner.run.mock.calls.at(-1);
    expect(curl?.[0]).toBe("curl");
    expect(curl?.[1]).toContain(MINT);
    expect(curl?.[1].join(" ")).not.toContain("Bearer");
    expect(curl?.[2]?.input).toMatch(
      /^header = "Authorization: Bearer [\w.-]+"/,
    );
  });

  it("refuses, naming the item and the wizard, when the app-id is missing", async () => {
    answer({ ...KEYCHAIN, "kore.writer.app-id": undefined });

    await expect(roleToken(deps, "writer")).resolves.toEqual({
      error: `The writer identity is missing: keychain item kore.writer.app-id was not found. Create it with \`bash ${WIZARD}\`, then rerun. No pane was split.`,
    });
  });

  it("refuses, naming the key and the wizard, when the key cannot sign", async () => {
    const broken: Signer = {
      update: () => {
        throw new Error("bad key");
      },
      sign: () => Buffer.alloc(0),
    };
    crypto.createSign.mockReturnValue(broken);

    await expect(roleToken(deps, "writer")).resolves.toEqual({
      error: `The writer App private key in keychain item kore.writer.private-key could not sign a token. Recreate it with \`bash ${WIZARD}\`. No pane was split.`,
    });
  });

  it("names GitHub's message, and never the body, when the mint is refused", async () => {
    answer(KEYCHAIN, {
      code: 22,
      stderr: "curl: (22) The requested URL returned error: 403",
      stdout: '{"message":"Resource not accessible","token":"ghs_leak"}',
    });

    const result = await roleToken(deps, "writer");

    expect(result).toEqual({
      error: `Could not mint a kore-writer installation token (curl: (22) The requested URL returned error: 403: Resource not accessible). Check the App is installed on corekraft/kore and its key is current: \`bash ${WIZARD}\`. No pane was split.`,
    });
    expect(JSON.stringify(result)).not.toContain("ghs_leak");
  });

  it("refuses when GitHub answers without a token", async () => {
    answer(KEYCHAIN, { stdout: "not json" });

    await expect(roleToken(deps, "writer")).resolves.toEqual({
      error: `Could not mint a kore-writer installation token (the response carried no token). Check the App is installed on corekraft/kore and its key is current: \`bash ${WIZARD}\`. No pane was split.`,
    });
  });
});
