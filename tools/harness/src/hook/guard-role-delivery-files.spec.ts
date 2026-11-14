import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAbsolute, relative, resolve } from "node:path";
import { readOnly } from "./guard-role-writes.js";
import { checkDelivery } from "./guard-role-delivery.js";
import { block } from "./guard-verdict.js";

vi.mock("node:path");
vi.mock("./guard-role-allow.js");
vi.mock("./guard-role-merge.js");
vi.mock("./guard-role-push.js");
vi.mock("./guard-role-routes.js");
vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  readOnly: vi.fn(),
}));
vi.mock("./guard-shell.js");
vi.mock("./guard-verdict.js");

const ROOT = "/repo";
const WHERE = { root: ROOT, cwd: ROOT };

const hit = (rule: string, message: string) => ({
  action: "block" as const,
  rule,
  message,
});

/** Fake relative: the rest of `to` past `from`, else `../outside`. */
function relativeTo(from: string, to: string): string {
  if (to === from) {
    return "";
  }
  return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : "../outside";
}

beforeEach(() => {
  vi.mocked(resolve).mockImplementation((root, path) =>
    path.startsWith("/") ? path : `${root}/${path}`,
  );
  vi.mocked(isAbsolute).mockImplementation((path) => path.startsWith("/"));
  vi.mocked(relative).mockImplementation(relativeTo);
  vi.mocked(readOnly).mockImplementation((what) =>
    hit("role-read-only", `${what} changes files`),
  );
  vi.mocked(block).mockImplementation(hit);
});

describe("checkDelivery: a tool other than Bash", () => {
  it("refuses a file write by a reporting role, which changes no file", () => {
    expect(
      checkDelivery("judge", true, "Write", { file_path: "a.md" }, WHERE),
    ).toEqual(hit("role-read-only", "Write changes files"));
  });

  it("reads the role kind it is given, not the role's name", () => {
    expect(
      checkDelivery("judge", false, "Write", { file_path: "a.md" }, WHERE),
    ).toBeNull();
    expect(
      checkDelivery("writer", true, "Edit", { file_path: "docs/a.md" }, WHERE),
    ).toEqual(hit("role-read-only", "Edit changes files"));
  });

  it("allows a writer's write inside its worktree, relative or absolute", () => {
    expect(
      checkDelivery("writer", false, "Edit", { file_path: "docs/a.md" }, WHERE),
    ).toBeNull();
    expect(
      checkDelivery(
        "writer",
        false,
        "Edit",
        { file_path: `${ROOT}/a.md` },
        WHERE,
      ),
    ).toBeNull();
  });

  it("refuses a writer's write outside its worktree, but not scratch space in tmp", () => {
    expect(
      checkDelivery(
        "writer",
        false,
        "Write",
        { file_path: "/etc/hosts" },
        WHERE,
      ),
    ).toMatchObject({
      rule: "role-worktree",
    });
    expect(
      checkDelivery("writer", false, "Write", { file_path: "/tmp/x" }, WHERE),
    ).toBeNull();
  });

  it("passes a tool that writes no file", () => {
    expect(
      checkDelivery(
        "writer",
        false,
        "Read",
        { file_path: "/etc/hosts" },
        WHERE,
      ),
    ).toBeNull();
  });
});
