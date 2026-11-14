import { describe, expect, it } from "vitest";
import { parseIssueComments } from "./parse-issue-comments.js";

const OWNER = "junners";
const PROOF = "Expand proof: #547 the warning ran clean on main";

describe("parseIssueComments reads an issue's comments", () => {
  it("maps each comment's author login, body and creation time", () => {
    expect(
      parseIssueComments(
        JSON.stringify({
          comments: [
            { author: { login: OWNER }, body: PROOF, createdAt: "t1" },
          ],
        }),
      ),
    ).toEqual([{ author: OWNER, body: PROOF, createdAt: "t1" }]);
  });

  it("reads an empty author login for a comment with no author, so no reviewer matches it", () => {
    expect(
      parseIssueComments(
        JSON.stringify({
          comments: [{ author: null, body: PROOF, createdAt: "t1" }],
        }),
      ),
    ).toEqual([{ author: "", body: PROOF, createdAt: "t1" }]);
  });

  it("reads no comments from a view that has none", () => {
    expect(parseIssueComments("{}")).toEqual([]);
  });

  it("returns undefined for output that is not JSON, so the caller can name the gh failure", () => {
    expect(parseIssueComments("nope")).toBeUndefined();
  });
});
