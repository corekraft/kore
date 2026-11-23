import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { resolveTier, undefinedRoleError } from "./agent-definition.js";
import { contextOf, fakeDeps, type FakeDeps } from "./deps-support.js";
import { hostLeaseRefusal } from "./host-lease.js";
import { sessionNameError } from "./names.js";
import { USAGE_ERROR } from "./output.js";
import { spawnLoadRefusal } from "./spawn-load.js";
import { checkRequest } from "./spawn-check.js";
import { tierInputError, tierOf } from "./tier-source.js";
import { parseTimeout } from "./wait.js";

vi.mock("./agent-definition.js");
vi.mock("./host-lease.js");
vi.mock("./names.js");
vi.mock("./spawn-load.js");
vi.mock("./tier-source.js");
vi.mock("./wait.js");

const WRITER_NEEDS_WORKTREE =
  "A writer needs its own worktree so concurrent writers cannot collide. Add --worktree.";

let deps: FakeDeps;

/** A complete, valid spawn request for a reader over the shared deps; a test overrides what it covers. */
function request(
  options: Record<string, string | boolean> = {},
): CommandContext {
  return contextOf(deps, {
    options: {
      role: "reader",
      name: "image-trust-writer",
      brief: "Do the thing.",
      ...options,
    },
  });
}

beforeEach(() => {
  deps = fakeDeps();
  vi.mocked(sessionNameError).mockReturnValue(undefined);
  vi.mocked(parseTimeout).mockReturnValue(60_000);
  vi.mocked(hostLeaseRefusal).mockResolvedValue(undefined);
  vi.mocked(spawnLoadRefusal).mockReturnValue(undefined);
  vi.mocked(tierInputError).mockReturnValue(undefined);
  vi.mocked(tierOf).mockResolvedValue({ tierSource: "definition" });
  vi.mocked(undefinedRoleError).mockResolvedValue(undefined);
  vi.mocked(resolveTier).mockResolvedValue({
    model: "claude-sonnet-5-5",
    effort: "high",
  });
});

describe("checkRequest refuses a missing required flag", () => {
  it("names the first missing flag among role, name and brief", async () => {
    const context = contextOf(deps, {
      options: { name: "image-trust-writer", brief: "Do it." },
    });

    await expect(checkRequest(context)).resolves.toEqual({
      error: "Missing --role.",
      code: USAGE_ERROR,
    });
  });

  it("refuses a flag given without a value, as if it were missing", async () => {
    const context = contextOf(deps, {
      options: { role: "reader", name: true, brief: "Do it." },
    });

    await expect(checkRequest(context)).resolves.toEqual({
      error: "Missing --name.",
      code: USAGE_ERROR,
    });
  });
});

describe("checkRequest refuses a bad name, brief, worktree or idea before any hc call", () => {
  it("refuses the name the session-name check rejects", async () => {
    vi.mocked(sessionNameError).mockReturnValue("Names are lowercase.");
    const context = request();

    await expect(checkRequest(context)).resolves.toEqual({
      error: "Names are lowercase.",
      code: USAGE_ERROR,
    });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("refuses --branch without --worktree", async () => {
    await expect(checkRequest(request({ branch: "feat/x" }))).resolves.toEqual({
      error: "--branch only applies with --worktree.",
      code: USAGE_ERROR,
    });
  });

  it("refuses a writer without --worktree", async () => {
    await expect(checkRequest(request({ role: "writer" }))).resolves.toEqual({
      error: WRITER_NEEDS_WORKTREE,
      code: USAGE_ERROR,
    });
  });

  it("refuses an idea that is not an issue number", async () => {
    await expect(checkRequest(request({ idea: "abc" }))).resolves.toEqual({
      error: 'Invalid --idea "abc". Use an issue number such as 338 or #338.',
      code: USAGE_ERROR,
    });
  });
});

describe("checkRequest reads the timeout", () => {
  it("refuses the timeout the parser rejects", async () => {
    vi.mocked(parseTimeout).mockReturnValue({
      error: "--timeout must be a positive whole number of milliseconds.",
    });

    await expect(checkRequest(request({ timeout: "soon" }))).resolves.toEqual({
      error: "--timeout must be a positive whole number of milliseconds.",
      code: USAGE_ERROR,
    });
  });
});

describe("checkRequest resolves the tier and returns the checked request", () => {
  it("refuses an undefined role before resolving a tier, so a flag cannot stand in for a definition", async () => {
    vi.mocked(undefinedRoleError).mockResolvedValue("Role verifier has none.");

    await expect(
      checkRequest(
        request({
          role: "verifier",
          model: "claude-opus-5-5",
          effort: "high",
        }),
      ),
    ).resolves.toEqual({
      error: "Role verifier has none.",
      code: USAGE_ERROR,
    });
    expect(undefinedRoleError).toHaveBeenCalledWith(deps, "verifier");
    expect(resolveTier).not.toHaveBeenCalled();
  });

  it("refuses with the tier's error when the role has no definition", async () => {
    vi.mocked(resolveTier).mockResolvedValue({
      error: "No agent definition for reader.",
    });

    await expect(checkRequest(request())).resolves.toEqual({
      error: "No agent definition for reader.",
      code: USAGE_ERROR,
    });
  });

  it("gives a flag over the definition, and asks for the definition when a flag is absent", async () => {
    const context = request({ model: "claude-opus-5-5" });

    await checkRequest(context);

    expect(resolveTier).toHaveBeenCalledWith(deps, "reader", {
      model: "claude-opus-5-5",
      effort: undefined,
    });
  });

  it("returns the request with the resolved model and effort and the timeout", async () => {
    await expect(checkRequest(request())).resolves.toEqual({
      values: {
        role: "reader",
        name: "image-trust-writer",
        brief: "Do the thing.",
        model: "claude-sonnet-5-5",
        effort: "high",
      },
      timeoutMs: 60_000,
      tier: { tierSource: "definition" },
    });
  });

  it("keeps the idea as an issue reference, with or without the hash", async () => {
    await expect(checkRequest(request({ idea: "338" }))).resolves.toMatchObject(
      {
        idea: "#338",
      },
    );
    await expect(
      checkRequest(request({ idea: "#338" })),
    ).resolves.toMatchObject({
      idea: "#338",
    });
  });
});
