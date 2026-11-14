import { isAbsolute, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ghMayRun, readMayRun } from "./guard-role-allow.js";
import { checkDelivery } from "./guard-role-delivery.js";
import { checkProtected } from "./guard-role-protected.js";
import {
  harnessAllowed,
  harnessStatus,
  notifiesFinish,
  readOnly,
  sendsToPane,
  setsEnvironment,
  useNotify,
  writes,
} from "./guard-role-writes.js";
import { commandOf, splitSegments } from "./guard-shell.js";
import { block } from "./guard-verdict.js";
import { checkRole } from "./guard-role.js";

vi.mock("node:path");
vi.mock("./guard-role-allow.js");
vi.mock("./guard-role-delivery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-delivery.js")>()),
  checkDelivery: vi.fn(),
}));
vi.mock("./guard-role-protected.js");
vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  harnessAllowed: vi.fn(),
  harnessStatus: vi.fn(),
  notifiesFinish: vi.fn(),
  readOnly: vi.fn(),
  sendsToPane: vi.fn(),
  setsEnvironment: vi.fn(),
  useNotify: vi.fn(),
  writes: vi.fn(),
}));
vi.mock("./guard-shell.js");
vi.mock("./guard-verdict.js");

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
const words = (tokens: readonly string[]) => ({
  name: tokens[0] ?? "",
  args: tokens.slice(1),
});

/** Fake relative: the rest of `to` past `from`, else `../outside`. */
function relativeTo(from: string, to: string): string {
  if (to === from) {
    return "";
  }
  return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : "../outside";
}

/** Runs one tool call as the host does, for a role with no protected finding. */
const call = (role: unknown, tool: string, input: Record<string, unknown>) =>
  checkRole(role, tool, input, ROOT);
const bash = (role: string, command: string) => call(role, "Bash", { command });

beforeEach(() => {
  vi.mocked(splitSegments).mockImplementation(splitWords);
  vi.mocked(commandOf).mockImplementation(words);
  vi.mocked(resolve).mockImplementation((root, path) =>
    path.startsWith("/") ? path : `${root}/${path}`,
  );
  vi.mocked(isAbsolute).mockImplementation((path) => path.startsWith("/"));
  vi.mocked(relative).mockImplementation(relativeTo);
  vi.mocked(checkProtected).mockReturnValue(null);
  vi.mocked(checkDelivery).mockReturnValue(null);
  vi.mocked(readMayRun).mockReturnValue(true);
  vi.mocked(ghMayRun).mockReturnValue(false);
  vi.mocked(harnessAllowed).mockReturnValue(false);
  vi.mocked(harnessStatus).mockReturnValue(false);
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
  vi.mocked(block).mockImplementation(hit);
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

    expect(bash("judge", "gh pr merge 1")).toBe(deliveryHit);
    expect(checkDelivery).toHaveBeenCalledWith(
      "judge",
      true,
      "Bash",
      { command: "gh pr merge 1" },
      ROOT,
    );
  });
});

describe("checkRole: a read-only role's writes and file reads", () => {
  it("refuses every write tool from a read-only role", () => {
    expect(call("reader", "Edit", { file_path: "a.md" })).toMatchObject({
      rule: "role-read-only",
    });
  });

  it("lets the reader read code, but refuses the concierge reading it", () => {
    expect(call("reader", "Read", { file_path: "src/x.ts" })).toBeNull();
    expect(call("concierge", "Read", { file_path: "src/x.ts" })).toMatchObject({
      rule: "role-no-code",
    });
  });

  it("lets the concierge read plans, ADRs and ideas, and refuses a climbing glob", () => {
    expect(call("concierge", "Read", { file_path: "docs/a.md" })).toBeNull();
    expect(
      call("concierge", "Grep", { path: "../secret", pattern: "x" }),
    ).toMatchObject({
      rule: "role-no-code",
    });
    expect(
      call("concierge", "Glob", { path: "infra/plans", pattern: "../../x" }),
    ).toMatchObject({
      rule: "role-no-code",
    });
  });
});

describe("checkRole: a read-only role's shell", () => {
  it("refuses a command substitution, as a read-only role or as a no-code one", () => {
    expect(bash("reader", "echo $(ls)")).toMatchObject({
      rule: "role-read-only",
    });
    expect(bash("concierge", "echo $(ls)")).toMatchObject({
      rule: "role-no-code",
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

    expect(bash("refiner", "tee out")).toMatchObject({
      rule: "role-read-only",
    });
  });
});

describe("checkRole: the concierge's harness commands and gh reads", () => {
  it("lets the concierge run its allowlisted harness commands and gh reads", () => {
    vi.mocked(harnessAllowed).mockReturnValue(true);
    expect(
      bash("concierge", "node skills/bin/harness.mjs idea new"),
    ).toBeNull();
    vi.mocked(ghMayRun).mockReturnValue(true);
    expect(bash("concierge", "gh pr view 1")).toBeNull();
  });

  it("refuses a command a no-code role does not list, and allows its date and echo", () => {
    expect(bash("concierge", "rm f")).toMatchObject({ rule: "role-no-code" });
    expect(bash("concierge", "date")).toBeNull();
  });

  it("lets the concierge run git log and status with only the flags that print no code", () => {
    expect(bash("concierge", "git log --oneline -n 3")).toBeNull();
    expect(bash("concierge", "git status -s")).toBeNull();
    expect(bash("concierge", "git log -p")).toMatchObject({
      rule: "role-no-code",
    });
    expect(bash("concierge", "git diff")).toMatchObject({
      rule: "role-no-code",
    });
  });

  it("allows the harness status query to a no-code role", () => {
    vi.mocked(harnessAllowed).mockReturnValue(false);
    vi.mocked(harnessStatus).mockReturnValue(true);

    expect(bash("challenger", "node skills/bin/harness.mjs status")).toBeNull();
  });

  it("refuses a command the read allowlist does not name, for a reader", () => {
    vi.mocked(readMayRun).mockReturnValue(false);

    expect(bash("reader", "curl x")).toMatchObject({ rule: "role-read-only" });
  });

  it("gives the refiner the harness commands it may file, and the challenger its own", () => {
    bash("refiner", "node skills/bin/harness.mjs idea new");
    bash("challenger", "node skills/bin/harness.mjs idea challenge");

    const [refinerCall] = vi.mocked(readMayRun).mock.calls;
    const [, , challengerList] = vi.mocked(harnessAllowed).mock.calls[0] ?? [];
    expect(refinerCall?.[1]).toContain("idea new");
    expect(challengerList).toContain("idea challenge");
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
