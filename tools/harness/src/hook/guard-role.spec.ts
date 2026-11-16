import { beforeEach, describe, expect, it, vi } from "vitest";
import { readMayRun } from "./guard-role-allow.js";
import { checkDelivery } from "./guard-role-delivery.js";
import { checkProtected } from "./guard-role-protected.js";
import {
  notifiesFinish,
  readOnly,
  sendsToPane,
  setsEnvironment,
  useNotify,
  writes,
} from "./guard-role-writes.js";
import { splitSegments } from "./guard-shell.js";
import { checkRole } from "./guard-role.js";

vi.mock("./guard-role-allow.js");
vi.mock("./guard-role-delivery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-delivery.js")>()),
  checkDelivery: vi.fn(),
}));
vi.mock("./guard-role-protected.js");
vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  notifiesFinish: vi.fn(),
  readOnly: vi.fn(),
  sendsToPane: vi.fn(),
  setsEnvironment: vi.fn(),
  useNotify: vi.fn(),
  writes: vi.fn(),
}));
vi.mock("./guard-shell.js");

const ROOT = "/repo";

/** A block finding, as the verdict helpers build one. */
const hit = (rule: string, message: string) => ({
  action: "block" as const,
  rule,
  message,
});

/** Fake shell: segments split on `&&`, words on spaces. */
const splitWords = (command: string) =>
  command.split(" && ").map((s) => s.split(" "));

/** Runs one tool call as the host does, for a role with no protected finding. */
const call = (
  role: unknown,
  tool: string,
  input: Record<string, unknown>,
  cwd?: string,
) => checkRole(role, tool, input, ROOT, cwd);
const bash = (role: string, command: string) => call(role, "Bash", { command });

beforeEach(() => {
  vi.mocked(splitSegments).mockImplementation(splitWords);
  vi.mocked(checkProtected).mockReturnValue(null);
  vi.mocked(checkDelivery).mockReturnValue(null);
  vi.mocked(readMayRun).mockReturnValue(true);
  vi.mocked(notifiesFinish).mockReturnValue(false);
  vi.mocked(sendsToPane).mockReturnValue(false);
  vi.mocked(setsEnvironment).mockReturnValue(false);
  vi.mocked(writes).mockReturnValue(false);
  vi.mocked(readOnly).mockImplementation((what) =>
    hit("role-read-only", `${what} changes files`),
  );
  vi.mocked(useNotify).mockImplementation((what) =>
    hit("role-read-only", `${what} types into a pane`),
  );
});

describe("checkRole: which sessions it bounds", () => {
  it("leaves a session with no role, or an unknown role, unbounded", () => {
    expect(call(undefined, "Bash", { command: "rm -rf x" })).toBeNull();
    expect(call("someone-else", "Write", { file_path: "a" })).toBeNull();
    expect(checkProtected).not.toHaveBeenCalled();
  });

  it("returns the protected-path finding before any role rule", () => {
    const protectedHit = hit("role-protected", "a protected file");
    vi.mocked(checkProtected).mockReturnValue(protectedHit);

    expect(call("writer", "Write", { file_path: "x" })).toBe(protectedHit);
    expect(checkDelivery).not.toHaveBeenCalled();
  });

  it("hands a delivery role's call to the delivery check", () => {
    const deliveryHit = hit("role-no-merge", "a merge");
    vi.mocked(checkDelivery).mockReturnValue(deliveryHit);

    const cwd = `${ROOT}/tools/harness`;
    expect(call("judge", "Bash", { command: "gh pr merge 1" }, cwd)).toBe(
      deliveryHit,
    );
    expect(checkDelivery).toHaveBeenCalledWith(
      "judge",
      true,
      "Bash",
      { command: "gh pr merge 1" },
      { root: ROOT, cwd },
    );
  });
});

describe("checkRole: a read-only role's writes and file reads", () => {
  it("refuses every write tool from a read-only role", () => {
    expect(call("reader", "Edit", { file_path: "a.md" })).toMatchObject({
      rule: "role-read-only",
    });
  });
});

describe("checkRole: a read-only role's shell", () => {
  it("refuses a command substitution", () => {
    expect(bash("reader", "echo $(ls)")).toMatchObject({
      rule: "role-read-only",
    });
  });

  it("refuses a segment that sets a variable or changes shell state", () => {
    vi.mocked(setsEnvironment).mockReturnValue(true);

    expect(bash("reader", "KORE_ROOT=/x cat f")).toMatchObject({
      rule: "role-read-only",
    });
  });

  it("points a spawned role's raw pane input at the finish notice", () => {
    vi.mocked(sendsToPane).mockReturnValue(true);

    expect(bash("reader", "herdr pane send-text w3:p1 x")).toMatchObject({
      message: expect.stringContaining("types into a pane"),
    });
  });

  it("refuses a write in the shell", () => {
    vi.mocked(writes).mockReturnValue(true);

    expect(bash("reader", "tee out")).toMatchObject({
      rule: "role-read-only",
    });
  });
});

describe("checkRole: a read-only role's allowlist", () => {
  it("refuses a command the read allowlist does not name, for a reader", () => {
    vi.mocked(readMayRun).mockReturnValue(false);

    expect(bash("reader", "curl x")).toMatchObject({ rule: "role-read-only" });
  });

  it("gives the reader the read-only harness commands, with none that files or records", () => {
    bash("reader", "node skills/bin/harness.mjs idea list");

    const [readerCall] = vi.mocked(readMayRun).mock.calls;
    expect(readerCall?.[1]).toContain("idea list");
    expect(readerCall?.[1]).not.toContain("idea new");
  });

  it("lets a spawned role finish with its one notice, which no allowlist names", () => {
    vi.mocked(readMayRun).mockReturnValue(false);
    vi.mocked(notifiesFinish).mockReturnValue(true);

    expect(
      bash(
        "reader",
        "node skills/bin/harness.mjs session notify w3:p1 --outcome done",
      ),
    ).toBeNull();
  });
});
