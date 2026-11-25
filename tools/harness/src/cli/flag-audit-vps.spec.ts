// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vpsLine, vpsUnprovenFlags } from "../flag/index.js";
import { modeOf, readInventory } from "../guardrail/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { fakeContext } from "./command-support.js";
import { flagCommands } from "./flag-commands.js";

vi.mock("../idea/index.js", () => ({ IdeaRepository: vi.fn() }));
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
const RULE = "vps-flag-proof";
const INVENTORY = { guardrails: [] };
const UNPROVEN = [
  {
    flag: "openbao",
    environment: "vps",
    path: "infra/environments/vps/environment.yaml",
  },
];

const vpsContext = (overrides: Partial<CommandContext> = {}) =>
  fakeContext({ options: { vps: true }, ...overrides });

function audit(): Command {
  const found = flagCommands["audit"];
  if (found === undefined) {
    throw new Error("flag commands have no audit command");
  }
  return found;
}

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

describe("flag audit --vps", () => {
  it("passes and says so when every true vps flag has a live-run outcome", async () => {
    const { context, out, err } = vpsContext();
    expect(await audit().run(context)).toBe(0);
    expect(out()).toBe(
      "Flag audit (vps) passed: every flag that is on in vps has a live-run outcome.\n",
    );
    expect(err()).toBe("");
  });

  it("warns with the fix and exits zero while the vps rule is in audit mode", async () => {
    setVps("audit", UNPROVEN);
    const { context, out, err } = vpsContext();
    expect(await audit().run(context)).toBe(0);
    expect(err()).toBe("warning: line openbao\n");
    expect(out()).toBe("");
  });

  it("fails with the same line and exits one once the vps rule is in enforce mode", async () => {
    setVps("enforce", UNPROVEN);
    const { context, out, err } = vpsContext();
    expect(await audit().run(context)).toBe(FAILED);
    expect(err()).toBe("line openbao\n");
    expect(out()).toBe("");
  });

  it("prints the unproven list as JSON with the rule's mode, and exits zero in audit mode", async () => {
    setVps("audit", UNPROVEN);
    const { context, out, err } = vpsContext({ json: true });
    expect(await audit().run(context)).toBe(0);
    expect(out()).toBe(
      `${JSON.stringify({ environment: "vps", mode: "audit", unproven: UNPROVEN })}\n`,
    );
    expect(err()).toBe("");
  });

  it("puts the failing JSON on stderr and exits one in enforce mode", async () => {
    setVps("enforce", UNPROVEN);
    const { context, out, err } = vpsContext({ json: true });
    expect(await audit().run(context)).toBe(FAILED);
    expect(err()).toBe(
      `${JSON.stringify({ environment: "vps", mode: "enforce", unproven: UNPROVEN })}\n`,
    );
    expect(out()).toBe("");
  });

  it("reads the mode of the vps rule from the repository's inventory, not the working directory", async () => {
    const { context, deps } = vpsContext();
    deps.cwd = "/elsewhere";
    await audit().run(context);
    expect(readInventory).toHaveBeenCalledWith(expect.any(Function), "/repo");
    expect(modeOf).toHaveBeenCalledWith(INVENTORY, RULE);
    expect(vpsUnprovenFlags).toHaveBeenCalledWith(deps.fs, deps.clock, "/repo");
  });
});
