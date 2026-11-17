// The context hook's real reader of the pane-result-summary flag: the local
// overlay decides it, and no overlay or an unwritten flag means off (ADR 0123).
// The flag domain's overlay reader is mocked; the file system is a typed fake.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { beforeEach, describe, expect, it, vi } from "vitest";
import { environments, readOverlay } from "../flag/index.js";
import type { CliDeps, FileSystem } from "../runtime/index.js";
import { realContextDeps } from "./context-deps.js";

vi.mock("../flag/index.js", () => ({
  environments: vi.fn(),
  readOverlay: vi.fn(),
}));
vi.mock("../plan/index.js", () => ({ readPlans: vi.fn() }));
vi.mock("./retro-scan.js", () => ({ windowStart: vi.fn() }));

const ROOT = "/repo";
const FS = {} as FileSystem;
const CLI = { fs: FS, env: {} } as unknown as CliDeps;

/** The local overlay as the flag domain reads it, with the given features. */
const overlay = (
  features: Record<string, boolean>,
): Awaited<ReturnType<typeof readOverlay>> => ({
  environment: "local",
  path: "infra/environments/local/environment.yaml",
  text: "",
  features,
});

beforeEach(() => {
  vi.mocked(environments).mockResolvedValue(["local"]);
});

describe("context deps: pane-result-summary flag", () => {
  it("reads the local overlay, and is on when it turns the flag on", async () => {
    vi.mocked(readOverlay).mockResolvedValue(
      overlay({ "pane-result-summary": true }),
    );

    expect(await realContextDeps(CLI, ROOT).paneResultSummaryOn()).toBe(true);
    expect(vi.mocked(readOverlay).mock.calls).toEqual([[FS, ROOT, "local"]]);
  });

  it("is off when the local overlay leaves the flag false", async () => {
    vi.mocked(readOverlay).mockResolvedValue(
      overlay({ "pane-result-summary": false }),
    );

    expect(await realContextDeps(CLI, ROOT).paneResultSummaryOn()).toBe(false);
  });

  it("is off when no local overlay exists, and reads none", async () => {
    vi.mocked(environments).mockResolvedValue([]);

    expect(await realContextDeps(CLI, ROOT).paneResultSummaryOn()).toBe(false);
    expect(readOverlay).not.toHaveBeenCalled();
  });
});
