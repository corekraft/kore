// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaRepository } from "../idea/index.js";
import { proofAudit, unprovenLine, waivedLine } from "../flag/index.js";
import { fakeContext } from "./command-support.js";
import { audit } from "./flag-audit-command.js";
import { auditVps } from "./flag-audit-vps.js";

vi.mock("../idea/index.js", () => ({ IdeaRepository: vi.fn() }));
vi.mock("./flag-audit-vps.js");
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  proofAudit: vi.fn(),
  unprovenLine: vi.fn(),
  waivedLine: vi.fn(),
}));

const FAILED = 1;
const OVERLAY = "infra/environments/local/environment.yaml";
const WAIVED = [
  {
    flag: "w",
    environment: "local",
    path: OVERLAY,
    idea: "0044",
    proof: "docs/ideas/0044-proof.md",
  },
];

beforeEach(() => {
  vi.mocked(proofAudit).mockResolvedValue({ unproven: [], waived: [] });
  vi.mocked(unprovenLine).mockImplementation((u) => `line ${u.flag}`);
  vi.mocked(waivedLine).mockImplementation((w) => `waived ${w.flag}`);
});

describe("flag audit", () => {
  it("passes and says so when no flag is on without proof", async () => {
    const { context, out, err } = fakeContext();
    expect(await audit.run(context)).toBe(0);
    expect(out()).toBe("Flag audit passed: no flag is on without proof.\n");
    expect(err()).toBe("");
  });

  it("prints an empty list as JSON when it passes", async () => {
    const { context, out } = fakeContext({ json: true });
    expect(await audit.run(context)).toBe(0);
    expect(out()).toBe('{"unproven":[],"waived":[]}\n');
  });

  it("fails with one line per unproven flag on stderr", async () => {
    const unproven = [
      { flag: "a", environment: "local", path: OVERLAY },
      { flag: "b", environment: "local", path: OVERLAY },
    ];
    vi.mocked(proofAudit).mockResolvedValue({ unproven, waived: [] });
    const { context, err, out } = fakeContext();
    expect(await audit.run(context)).toBe(FAILED);
    expect(err()).toBe("line a\nline b\n");
    expect(out()).toBe("");
  });

  it("fails with the unproven list as JSON on stderr", async () => {
    const unproven = [{ flag: "a", environment: "local", path: OVERLAY }];
    vi.mocked(proofAudit).mockResolvedValue({ unproven, waived: [] });
    const { context, err } = fakeContext({ json: true });
    expect(await audit.run(context)).toBe(FAILED);
    expect(err()).toBe(`${JSON.stringify({ unproven, waived: [] })}\n`);
  });
});

describe("flag audit owner waivers", () => {
  it("passes and names each flag that rests on an owner waiver, apart from a live run", async () => {
    vi.mocked(proofAudit).mockResolvedValue({ unproven: [], waived: WAIVED });
    const { context, out, err } = fakeContext();
    expect(await audit.run(context)).toBe(0);
    expect(out()).toBe(
      "Flag audit passed: no flag is on without proof.\nwaived w\n",
    );
    expect(err()).toBe("");
  });

  it("prints the waived flags as JSON beside the unproven list", async () => {
    vi.mocked(proofAudit).mockResolvedValue({ unproven: [], waived: WAIVED });
    const { context, out } = fakeContext({ json: true });
    expect(await audit.run(context)).toBe(0);
    expect(out()).toBe(`${JSON.stringify({ unproven: [], waived: WAIVED })}\n`);
  });

  it("reads the repository root from the deps, not the working directory", async () => {
    const { context, deps } = fakeContext();
    deps.cwd = "/elsewhere";
    await audit.run(context);
    expect(proofAudit).toHaveBeenCalledWith(deps.fs, deps.clock, "/repo");
    expect(IdeaRepository).not.toHaveBeenCalled();
  });
});

describe("flag audit --vps routing", () => {
  it("hands --vps to the vps audit for the repository root, not the flag-wide audit", async () => {
    vi.mocked(auditVps).mockResolvedValue(0);
    const { context } = fakeContext({ options: { vps: true } });
    expect(await audit.run(context)).toBe(0);
    expect(auditVps).toHaveBeenCalledWith(context, "/repo");
    expect(proofAudit).not.toHaveBeenCalled();
  });

  it("runs the flag-wide audit, not the vps audit, when --vps is absent", async () => {
    const { context } = fakeContext();
    expect(await audit.run(context)).toBe(0);
    expect(proofAudit).toHaveBeenCalled();
    expect(auditVps).not.toHaveBeenCalled();
  });
});
