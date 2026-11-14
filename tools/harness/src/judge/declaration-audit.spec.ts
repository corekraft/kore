import { describe, expect, it, vi } from "vitest";
import { auditDeclaration } from "./declaration-audit.js";
import { parseDeclaration } from "./declaration.js";

vi.mock("./declaration.js");

const VALID = {
  ok: true,
  pattern: "no-behaviour-change",
  idea: undefined,
  expandStep: undefined,
} as const;

describe("auditDeclaration", () => {
  it("passes a body whose one valid pattern line is its last line", () => {
    vi.mocked(parseDeclaration).mockReturnValue(VALID);
    expect(
      auditDeclaration("Refs #1\n\nSafety pattern: no-behaviour-change\n"),
    ).toEqual({ ok: true });
    expect(parseDeclaration).toHaveBeenCalledWith(
      "Refs #1\n\nSafety pattern: no-behaviour-change\n",
    );
  });

  it("reports the parser's reason when the declaration is not valid", () => {
    vi.mocked(parseDeclaration).mockReturnValue({ ok: false, reason: "no" });
    expect(auditDeclaration("Safety pattern: nope")).toEqual({
      ok: false,
      reason: "no",
    });
  });

  it("reports a valid declaration that is not the last line", () => {
    vi.mocked(parseDeclaration).mockReturnValue(VALID);
    expect(
      auditDeclaration("Safety pattern: no-behaviour-change\nIdea: x\n"),
    ).toEqual({
      ok: false,
      reason:
        "The `Safety pattern:` line must be the last line of the PR body. Move it to the end.",
    });
  });

  it("ignores a trailing HTML comment and blank lines when finding the last line", () => {
    vi.mocked(parseDeclaration).mockReturnValue(VALID);
    expect(
      auditDeclaration(
        "Safety pattern: no-behaviour-change\n\n<!-- note -->\n\n",
      ),
    ).toEqual({ ok: true });
  });

  it("reports an empty body, which the parser has already refused", () => {
    vi.mocked(parseDeclaration).mockReturnValue(VALID);
    expect(auditDeclaration("").ok).toBe(false);
  });
});
