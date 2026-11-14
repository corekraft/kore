import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { resolveTier } from "./agent-definition.js";
import { contextOf, fakeDeps, type FakeDeps } from "./deps-support.js";
import { hostLeaseRefusal } from "./host-lease.js";
import { sessionNameError } from "./names.js";
import { FAILED, USAGE_ERROR } from "./output.js";
import { check } from "./spawn-check.js";
import { findResult, parseTimeout } from "./wait.js";

vi.mock("./agent-definition.js");
vi.mock("./host-lease.js");
vi.mock("./names.js");
vi.mock("./wait.js");

const BRIEF_MARKER =
  'The brief has a line that is only a RESULT marker, which would end the wait early. Describe the marker in words instead, such as "end with the word RESULT, a colon, then done or blocked".';
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
  deps.env = { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p1" };
  vi.mocked(sessionNameError).mockReturnValue(undefined);
  vi.mocked(findResult).mockReturnValue(undefined);
  vi.mocked(parseTimeout).mockReturnValue(60_000);
  vi.mocked(hostLeaseRefusal).mockResolvedValue(undefined);
  vi.mocked(resolveTier).mockResolvedValue({
    model: "claude-sonnet-5-5",
    effort: "high",
  });
});

describe("check refuses a missing required flag", () => {
  it("names the first missing flag among role, name and brief", async () => {
    const context = contextOf(deps, {
      options: { name: "image-trust-writer", brief: "Do it." },
    });

    await expect(check(context)).resolves.toEqual({
      error: "Missing --role.",
      code: USAGE_ERROR,
    });
  });

  it("refuses a flag given without a value, as if it were missing", async () => {
    const context = contextOf(deps, {
      options: { role: "reader", name: true, brief: "Do it." },
    });

    await expect(check(context)).resolves.toEqual({
      error: "Missing --name.",
      code: USAGE_ERROR,
    });
  });
});

describe("check refuses a bad name, brief, worktree or idea before any herdr call", () => {
  it("refuses the name the session-name check rejects", async () => {
    vi.mocked(sessionNameError).mockReturnValue("Names are lowercase.");
    const context = request();

    await expect(check(context)).resolves.toEqual({
      error: "Names are lowercase.",
      code: USAGE_ERROR,
    });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("refuses a brief with a line that is only a RESULT marker", async () => {
    vi.mocked(findResult).mockReturnValue("done");

    await expect(check(request())).resolves.toEqual({
      error: BRIEF_MARKER,
      code: USAGE_ERROR,
    });
  });

  it("refuses --branch without --worktree", async () => {
    await expect(check(request({ branch: "feat/x" }))).resolves.toEqual({
      error: "--branch only applies with --worktree.",
      code: USAGE_ERROR,
    });
  });

  it("refuses a writer without --worktree", async () => {
    await expect(check(request({ role: "writer" }))).resolves.toEqual({
      error: WRITER_NEEDS_WORKTREE,
      code: USAGE_ERROR,
    });
  });

  it("refuses an idea that is not an issue number", async () => {
    await expect(check(request({ idea: "abc" }))).resolves.toEqual({
      error: 'Invalid --idea "abc". Use an issue number such as 338 or #338.',
      code: USAGE_ERROR,
    });
  });
});

describe("check reads the timeout and the caller", () => {
  it("refuses the timeout the parser rejects", async () => {
    vi.mocked(parseTimeout).mockReturnValue({
      error: "--timeout must be a positive whole number of milliseconds.",
    });

    await expect(check(request({ timeout: "soon" }))).resolves.toEqual({
      error: "--timeout must be a positive whole number of milliseconds.",
      code: USAGE_ERROR,
    });
  });

  it("refuses to run outside Herdr, naming HERDR_ENV", async () => {
    deps.env = {};

    await expect(check(request())).resolves.toEqual({
      error:
        "Not inside Herdr (HERDR_ENV is not 1). Run this from a Herdr pane; no session was started.",
      code: FAILED,
    });
  });

  it("refuses inside Herdr when the caller's pane id is empty", async () => {
    deps.env = { HERDR_ENV: "1", HERDR_PANE_ID: "" };

    await expect(check(request())).resolves.toEqual({
      error:
        "HERDR_PANE_ID is not set, so the session cannot broadcast back. Run this from a Herdr pane.",
      code: FAILED,
    });
  });

  it("refuses a writer while the host lease refuses it, and checks no other role's lease", async () => {
    vi.mocked(hostLeaseRefusal).mockResolvedValue("A live run holds the host.");

    await expect(
      check(request({ role: "writer", worktree: true })),
    ).resolves.toEqual({ error: "A live run holds the host.", code: FAILED });
    expect(hostLeaseRefusal).toHaveBeenCalledWith(deps);

    vi.mocked(hostLeaseRefusal).mockClear();
    await check(request());
    expect(hostLeaseRefusal).not.toHaveBeenCalled();
  });
});

describe("check resolves the tier and returns the checked request", () => {
  it("refuses with the tier's error when the role has no definition", async () => {
    vi.mocked(resolveTier).mockResolvedValue({
      error: "No agent definition for reader.",
    });

    await expect(check(request())).resolves.toEqual({
      error: "No agent definition for reader.",
      code: USAGE_ERROR,
    });
  });

  it("gives a flag over the definition, and asks for the definition when a flag is absent", async () => {
    const context = request({ model: "claude-opus-5-5" });

    await check(context);

    expect(resolveTier).toHaveBeenCalledWith(deps, "reader", {
      model: "claude-opus-5-5",
      effort: undefined,
    });
  });

  it("returns the request with the resolved model and effort, the caller and the timeout", async () => {
    await expect(check(request())).resolves.toEqual({
      values: {
        role: "reader",
        name: "image-trust-writer",
        brief: "Do the thing.",
        model: "claude-sonnet-5-5",
        effort: "high",
      },
      callerPane: "w3:p1",
      timeoutMs: 60_000,
    });
  });

  it("keeps the idea as an issue reference, with or without the hash", async () => {
    await expect(check(request({ idea: "338" }))).resolves.toMatchObject({
      idea: "#338",
    });
    await expect(check(request({ idea: "#338" }))).resolves.toMatchObject({
      idea: "#338",
    });
  });
});
