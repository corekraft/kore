import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
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
const ORCHESTRATOR_MINT =
  "https://api.github.com/app/installations/9002/access_tokens";
const KEYCHAIN: Record<string, string | undefined> = {
  "kore.orchestrator.app-id": "77777",
  "kore.orchestrator.installation-id": "9002",
  "kore.orchestrator.private-key": Buffer.from(PEM).toString("base64"),
};

let deps: FakeDeps;

/** A signer whose sign returns a fixed signature; each call is recorded on the spies. */
function signer() {
  const update = vi.fn((_data: string): Signer => self);
  const sign = vi.fn((_key: string) => Buffer.from("signed"));
  const self: Signer = { update, sign };
  return { signer: self, update, sign };
}

/** Answers `security` from the items (a missing one exits 44) and curl with a token. */
function answer(items: Record<string, string | undefined>): void {
  deps.runner.run.mockImplementation((command, args) => {
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

/** The grant the minting request sent, parsed from curl's --data argument. */
function grantSent(): unknown {
  const args = deps.runner.run.mock.calls.at(-1)?.[1] ?? [];
  return JSON.parse(String(args[args.indexOf("--data") + 1]));
}

beforeEach(() => {
  deps = fakeDeps();
  crypto.createSign.mockReturnValue(signer().signer);
  answer(KEYCHAIN);
  flag(true);
});

describe("roleToken gives the advisor pane the kore-orchestrator App's token", () => {
  it("mints the orchestrator App's token for an advisor pane, with the orchestrator's grant only", async () => {
    await expect(roleToken(deps, "advisor")).resolves.toEqual({
      token: "ghs_t",
    });

    const [command, args] = deps.runner.run.mock.calls.at(-1) ?? [];
    expect(command).toBe("curl");
    expect(args).toContain(ORCHESTRATOR_MINT);
    expect(grantSent()).toEqual({
      repositories: ["kore"],
      permissions: {
        issues: "write",
        pull_requests: "write",
        contents: "read",
        metadata: "read",
      },
    });
  });

  it("signs the advisor's JWT with the orchestrator App id", async () => {
    const jwt = signer();
    crypto.createSign.mockReturnValue(jwt.signer);

    await roleToken(deps, "advisor");

    expect(jwt.sign).toHaveBeenCalledExactlyOnceWith(PEM);
    const [unsigned] = jwt.update.mock.calls[0] ?? [""];
    const payload = JSON.parse(
      Buffer.from(String(unsigned).split(".")[1] ?? "", "base64url").toString(),
    ) as Record<string, unknown>;
    expect(payload["iss"]).toBe("77777");
  });

  it("reads only the orchestrator's three keychain items, never the writer's or the reviewer's", async () => {
    await roleToken(deps, "advisor");

    const services = deps.runner.run.mock.calls
      .filter(([command]) => command === "security")
      .map(([, args]) => args[args.indexOf("-s") + 1]);
    expect(services).toEqual([
      "kore.orchestrator.app-id",
      "kore.orchestrator.installation-id",
      "kore.orchestrator.private-key",
    ]);
  });

  it("names the orchestrator identity and the wizard when the advisor's key is missing", async () => {
    answer({ ...KEYCHAIN, "kore.orchestrator.private-key": undefined });

    await expect(roleToken(deps, "advisor")).resolves.toEqual({
      error: `The orchestrator identity is missing: keychain item kore.orchestrator.private-key was not found. Create it with \`bash ${WIZARD}\`, then rerun. No pane was split.`,
    });
  });

  it("leaves the advisor pane without a token, and reads no keychain item, while the role-tokens flag is off", async () => {
    flag(false);

    await expect(roleToken(deps, "advisor")).resolves.toBeUndefined();
    expect(deps.runner.run).not.toHaveBeenCalled();
  });
});
