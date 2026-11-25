// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlagError, vpsLine, vpsUnprovenFlags } from "../flag/index.js";
import { GuardrailError, modeOf, readInventory } from "../guardrail/index.js";
import { fakeContext } from "./command-support.js";
import { auditVps } from "./flag-audit-vps.js";

vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  vpsLine: vi.fn(),
  vpsUnprovenFlags: vi.fn(),
}));
vi.mock("../guardrail/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guardrail/index.js")>()),
  modeOf: vi.fn(),
  readInventory: vi.fn(),
}));

const FAILED = 1;
const BASE = "/repo";
const RULE = "vps-flag-proof";
const INVENTORY = { guardrails: [] };
const UNPROVEN = [
  {
    flag: "openbao",
    environment: "vps",
    path: "infra/environments/vps/environment.yaml",
  },
];

/** Sets the vps rule's mode and what the vps audit finds. */
function setVps(mode: "audit" | "enforce", unproven = UNPROVEN): void {
  vi.mocked(readInventory).mockResolvedValue(INVENTORY);
  vi.mocked(modeOf).mockReturnValue(mode);
  vi.mocked(vpsUnprovenFlags).mockResolvedValue(unproven);
  vi.mocked(vpsLine).mockImplementation((u) => `line ${u.flag}`);
}

beforeEach(() => {
  setVps("audit", []);
});

describe("auditVps", () => {
  it("passes and says so when every true vps flag has a live-run outcome", async () => {
    const { context, out, err } = fakeContext();
    expect(await auditVps(context, BASE)).toBe(0);
    expect(out()).toBe(
      "Flag audit (vps) passed: every flag that is on in vps has a live-run outcome.\n",
    );
    expect(err()).toBe("");
  });

  it("prints an empty vps list as JSON when it passes", async () => {
    const { context, out, err } = fakeContext({ json: true });
    expect(await auditVps(context, BASE)).toBe(0);
    expect(out()).toBe(
      `${JSON.stringify({ environment: "vps", mode: "audit", unproven: [] })}\n`,
    );
    expect(err()).toBe("");
  });

  it("warns with the fix and exits zero while the vps rule is in audit mode", async () => {
    setVps("audit", UNPROVEN);
    const { context, out, err } = fakeContext();
    expect(await auditVps(context, BASE)).toBe(0);
    expect(err()).toBe("warning: line openbao\n");
    expect(out()).toBe("");
  });

  it("fails with the same line and exits one once the vps rule is in enforce mode", async () => {
    setVps("enforce", UNPROVEN);
    const { context, out, err } = fakeContext();
    expect(await auditVps(context, BASE)).toBe(FAILED);
    expect(err()).toBe("line openbao\n");
    expect(out()).toBe("");
  });

  it("prints the unproven list as JSON with the rule's mode, and exits zero in audit mode", async () => {
    setVps("audit", UNPROVEN);
    const { context, out, err } = fakeContext({ json: true });
    expect(await auditVps(context, BASE)).toBe(0);
    expect(out()).toBe(
      `${JSON.stringify({ environment: "vps", mode: "audit", unproven: UNPROVEN })}\n`,
    );
    expect(err()).toBe("");
  });

  it("puts the failing JSON on stderr and exits one in enforce mode", async () => {
    setVps("enforce", UNPROVEN);
    const { context, out, err } = fakeContext({ json: true });
    expect(await auditVps(context, BASE)).toBe(FAILED);
    expect(err()).toBe(
      `${JSON.stringify({ environment: "vps", mode: "enforce", unproven: UNPROVEN })}\n`,
    );
    expect(out()).toBe("");
  });
});

describe("auditVps reads the repository it is given", () => {
  it("reads the vps rule and the vps flags from the given repository root, not the working directory", async () => {
    const { context, deps } = fakeContext();
    deps.cwd = "/elsewhere";
    await auditVps(context, BASE);
    expect(readInventory).toHaveBeenCalledWith(expect.any(Function), BASE);
    expect(modeOf).toHaveBeenCalledWith(INVENTORY, RULE);
    expect(vpsUnprovenFlags).toHaveBeenCalledWith(deps.fs, deps.clock, BASE);
  });

  it("names an unreadable inventory as a flag error and checks no flag", async () => {
    vi.mocked(readInventory).mockRejectedValue(
      new GuardrailError("the guardrail inventory is not valid"),
    );
    const { context, out, err } = fakeContext();
    const failure = await auditVps(context, BASE).catch(
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(FlagError);
    expect(failure).toHaveProperty(
      "message",
      "the guardrail inventory is not valid",
    );
    expect(vpsUnprovenFlags).not.toHaveBeenCalled();
    expect(out()).toBe("");
    expect(err()).toBe("");
  });

  it("rethrows an error that is not a guardrail error, so a bug is never reported as a flag refusal", async () => {
    vi.mocked(readInventory).mockRejectedValue(new Error("disk on fire"));
    const { context } = fakeContext();
    const failure = await auditVps(context, BASE).catch(
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(FlagError);
    expect(failure).toHaveProperty("message", "disk on fire");
  });
});
