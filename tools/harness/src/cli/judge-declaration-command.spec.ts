import { describe, expect, it, vi } from "vitest";
import { auditDeclaration } from "../judge/index.js";
import { contextWith } from "./command-support.js";
import { declarationCommands } from "./judge-declaration-command.js";

vi.mock("../judge/index.js");

function contextOf(body: string) {
  const stdout = vi.fn();
  const stderr = vi.fn();
  const context = contextWith({
    stdin: vi.fn().mockResolvedValue(body),
    stdout,
    stderr,
  });
  return { context, stdout, stderr };
}

describe("harness judge declaration", () => {
  it("audits the PR body read from stdin and exits 0 when it passes", async () => {
    const { context, stdout, stderr } = contextOf("BODY");
    vi.mocked(auditDeclaration).mockReturnValue({ ok: true });
    expect(await declarationCommands.declaration?.run(context)).toBe(0);
    expect(auditDeclaration).toHaveBeenCalledWith("BODY");
    expect(stdout).toHaveBeenCalledWith("PR body declaration: ok\n");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("names the problem on stderr and exits 1 when the audit fails", async () => {
    const { context, stdout, stderr } = contextOf("BODY");
    vi.mocked(auditDeclaration).mockReturnValue({ ok: false, reason: "why" });
    expect(await declarationCommands.declaration?.run(context)).toBe(1);
    expect(stderr).toHaveBeenCalledWith("PR body declaration: why\n");
    expect(stdout).not.toHaveBeenCalled();
  });

  it("is read-only and takes no operand", () => {
    expect(declarationCommands.declaration?.operand).toBeUndefined();
    expect(declarationCommands.declaration?.help?.effects.kind).toBe(
      "read-only",
    );
  });
});
