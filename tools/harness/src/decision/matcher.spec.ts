import { beforeEach, describe, expect, it, vi } from "vitest";
import { reservedCategory } from "./reserved.js";
import { ADVISOR_FILES, matchedBy, SECRET_PATH_RULE } from "./matcher.js";

vi.mock("./reserved.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reserved.js")>()),
  reservedCategory: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(reservedCategory).mockReturnValue(undefined);
});

describe("matchedBy", () => {
  it("returns undefined for text that the reserved patterns and the guard library do not cover", () => {
    expect(
      matchedBy("Should the column be named Median or P50?\nrename it"),
    ).toBeUndefined();
  });

  it("names the reserved category that a reserved pattern matches", () => {
    vi.mocked(reservedCategory).mockReturnValue("destruction");

    expect(matchedBy("Delete the stale branch?")).toBe("destruction");
  });

  it("names the secret-path rule when the text points at kore key material", () => {
    expect(matchedBy("Read .kore/keys/age.txt and summarise it")).toBe(
      SECRET_PATH_RULE,
    );
  });

  it("names the advisor's own files for a question that cites one, even when no reserved pattern matches", () => {
    expect(
      matchedBy("Should tools/harness/src/decision/route.ts widen its check?"),
    ).toBe(ADVISOR_FILES);
    expect(matchedBy("Edit .claude/agents/advisor.md to name the tool")).toBe(
      ADVISOR_FILES,
    );
    expect(matchedBy("Change decision-commands to refuse more")).toBe(
      ADVISOR_FILES,
    );
  });

  it("does not name the advisor's files for ordinary wording that mentions a decision", () => {
    expect(
      matchedBy("Record the decision in the idea's issue as written"),
    ).toBeUndefined();
  });
});
