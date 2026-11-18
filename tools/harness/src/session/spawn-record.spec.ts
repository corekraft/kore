import { beforeEach, describe, expect, it, vi } from "vitest";
import { mainRoot } from "../runtime/index.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import type { SessionRecord } from "./registry.js";
import {
  noteUnstamped,
  recordIdeaLabels,
  recordLaunch,
  unstampedWarning,
} from "./spawn-record.js";
import { issueLabels } from "./spawn-labels.js";

// The ledger's constructor and record are spies the spec holds, so no prototype is referenced.
const ledger = vi.hoisted(() => ({
  record: vi.fn<(event: object) => Promise<unknown>>(),
}));

vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: class {
    record(event: object) {
      return ledger.record(event);
    }
  },
}));
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));
vi.mock("./spawn-labels.js", () => ({ issueLabels: vi.fn() }));

const SPAWNED = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  role: "writer",
  createdAt: "2026-11-15T10:00:00.000Z",
};
const WARNING =
  'Warning: image-trust-writer (writer) names no idea, so its ledger events cannot be counted per idea. Add --idea <issue number> to the next spawn, or --no-idea "<reason>" if it serves no idea. The session has started.\n';

let deps: FakeDeps;

beforeEach(() => {
  deps = fakeDeps();
  vi.mocked(mainRoot).mockResolvedValue("/main");
  ledger.record.mockResolvedValue(undefined);
});

describe("the warning for a spawn that names no idea", () => {
  it("names the missing idea, the fix, and that the session started", () => {
    expect(unstampedWarning("image-trust-writer", "writer")).toBe(
      'Warning: image-trust-writer (writer) names no idea, so its ledger events cannot be counted per idea. Add --idea <issue number> to the next spawn, or --no-idea "<reason>" if it serves no idea. The session has started.',
    );
  });
});

describe("noteUnstamped warns a required role that gave no reason", () => {
  it("prints the warning to stderr, so stdout stays as the spawn reports it", async () => {
    await noteUnstamped(deps, SPAWNED, {});

    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(WARNING);
    expect(deps.stdout).not.toHaveBeenCalled();
  });

  it("prints no warning when the session gave a --no-idea reason", async () => {
    await noteUnstamped(deps, SPAWNED, { reason: "grilling session" });

    expect(deps.stderr).not.toHaveBeenCalled();
  });
});

describe("noteUnstamped records the spawn in the ledger", () => {
  it("records an unstamped spawn with its role, name, pane and time, and no label without a reason", async () => {
    await noteUnstamped(deps, SPAWNED, {});

    expect(ledger.record).toHaveBeenCalledExactlyOnceWith({
      source: "herdr",
      kind: "spawn.unstamped",
      occurredAt: SPAWNED.createdAt,
      pane: "w3:p9",
      agent: "image-trust-writer",
      role: "writer",
    });
  });

  it("records the --no-idea reason as the label, so a deliberate gap is told from a mistake", async () => {
    await noteUnstamped(deps, SPAWNED, { reason: "grilling session" });

    expect(ledger.record).toHaveBeenCalledExactlyOnceWith({
      source: "herdr",
      kind: "spawn.unstamped",
      occurredAt: SPAWNED.createdAt,
      pane: "w3:p9",
      agent: "image-trust-writer",
      role: "writer",
      label: "grilling session",
    });
  });

  it("records nothing outside a repository, and still warns", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    await noteUnstamped(deps, SPAWNED, {});

    expect(ledger.record).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(WARNING);
  });

  it("never fails the spawn when the ledger cannot record the event", async () => {
    ledger.record.mockRejectedValue(new Error("ledger down"));

    await expect(noteUnstamped(deps, SPAWNED, {})).resolves.toBeUndefined();
  });
});

const LAUNCHED: SessionRecord = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "medium",
  createdAt: "2026-11-15T10:00:00.000Z",
};

describe("recordLaunch writes the effort the session ran at", () => {
  it("records the effort beside the role, model, stage and tier source of the launch", async () => {
    await recordLaunch(deps, LAUNCHED, { tierSource: "definition" }, "write");

    expect(ledger.record).toHaveBeenCalledExactlyOnceWith({
      source: "herdr",
      kind: "session.launch",
      occurredAt: "2026-11-15T10:00:00.000Z",
      pane: "w3:p9",
      agent: "image-trust-writer",
      role: "writer",
      tier: "claude-sonnet-5-5",
      effort: "medium",
      stage: "write",
      tierSource: "definition",
    });
  });

  it("records the launch with no effort key when the session's record carries none, so it reads as unknown", async () => {
    await recordLaunch(
      deps,
      { ...LAUNCHED, effort: undefined as unknown as string },
      undefined,
      undefined,
    );

    expect(ledger.record).toHaveBeenCalledExactlyOnceWith({
      source: "herdr",
      kind: "session.launch",
      occurredAt: "2026-11-15T10:00:00.000Z",
      pane: "w3:p9",
      agent: "image-trust-writer",
      role: "writer",
      tier: "claude-sonnet-5-5",
    });
    expect(ledger.record.mock.calls[0]?.[0]).not.toHaveProperty("effort");
  });

  it("records nothing outside a repository", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    await recordLaunch(deps, LAUNCHED, undefined, undefined);

    expect(ledger.record).not.toHaveBeenCalled();
  });
});

describe("recordIdeaLabels records one session.labelled event per label the idea's issue carries", () => {
  const IDEA = "#1004";
  const LABELLED = {
    name: "image-trust-writer",
    createdAt: LAUNCHED.createdAt,
  };

  it("records each label name keyed to the session and stamped at the launch, and nothing else", async () => {
    vi.mocked(issueLabels).mockResolvedValue(["ready-for-agent", "tooling"]);

    await recordIdeaLabels(deps, LABELLED, IDEA);

    expect(issueLabels).toHaveBeenCalledExactlyOnceWith(
      deps.runner,
      "/main",
      IDEA,
    );
    expect(ledger.record.mock.calls).toEqual([
      [
        {
          source: "herdr",
          kind: "session.labelled",
          occurredAt: LAUNCHED.createdAt,
          session: "image-trust-writer",
          label: "ready-for-agent",
        },
      ],
      [
        {
          source: "herdr",
          kind: "session.labelled",
          occurredAt: LAUNCHED.createdAt,
          session: "image-trust-writer",
          label: "tooling",
        },
      ],
    ]);
  });

  it("records nothing when the lookup failed, so the launch still reads as an unlabelled one", async () => {
    vi.mocked(issueLabels).mockResolvedValue(undefined);

    await expect(
      recordIdeaLabels(deps, LABELLED, IDEA),
    ).resolves.toBeUndefined();

    expect(ledger.record).not.toHaveBeenCalled();
  });

  it("records nothing for an issue with no labels", async () => {
    vi.mocked(issueLabels).mockResolvedValue([]);

    await recordIdeaLabels(deps, LABELLED, IDEA);

    expect(ledger.record).not.toHaveBeenCalled();
  });

  it("records nothing outside a repository, and never looks the labels up", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);

    await recordIdeaLabels(deps, LABELLED, IDEA);

    expect(issueLabels).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it("never fails the launch on a ledger file error, which it records nothing for", async () => {
    vi.mocked(issueLabels).mockResolvedValue(["bug"]);
    ledger.record.mockRejectedValueOnce(
      Object.assign(new Error("disk full"), { code: "ENOSPC" }),
    );

    await expect(
      recordIdeaLabels(deps, LABELLED, IDEA),
    ).resolves.toBeUndefined();
  });

  it("rethrows an error that is not a file error, since that is a bug", async () => {
    vi.mocked(issueLabels).mockResolvedValue(["bug"]);
    ledger.record.mockRejectedValueOnce(new Error("bug in the recorder"));

    await expect(recordIdeaLabels(deps, LABELLED, IDEA)).rejects.toThrow(
      "bug in the recorder",
    );
  });
});
