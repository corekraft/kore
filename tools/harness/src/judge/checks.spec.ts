import { describe, expect, it } from "vitest";
import { parsePrView } from "./checks.js";
import { COMMITTED, RUN_URL } from "./checks-support.js";

describe("parsePrView reads the PR's identity", () => {
  it("refuses output that is not JSON, so the caller can name the gh failure", () => {
    expect(parsePrView("not json")).toBeUndefined();
  });

  it("reads an empty view from an object with no fields", () => {
    expect(parsePrView("{}")).toEqual({
      baseSha: "",
      body: "",
      comments: [],
      headCommittedAt: undefined,
      headSha: "",
      rollup: [],
    });
  });

  it("reads the base and head commits and the PR body", () => {
    expect(
      parsePrView(
        '{"baseRefOid":"abc123","headRefOid":"def456","body":"Safety pattern: x"}',
      ),
    ).toMatchObject({
      baseSha: "abc123",
      headSha: "def456",
      body: "Safety pattern: x",
    });
  });

  it("takes the newest commit date as the head commit time, and none without commits", () => {
    const dated = JSON.stringify({
      commits: [
        { committedDate: "2026-01-02T00:00:00Z" },
        { committedDate: "" },
        { committedDate: "2026-01-03T00:00:00Z" },
      ],
    });
    expect(parsePrView(dated)?.headCommittedAt).toBe("2026-01-03T00:00:00Z");
    expect(parsePrView('{"commits":[]}')?.headCommittedAt).toBeUndefined();
  });
});

describe("parsePrView reads comments and checks", () => {
  it("reads a comment's body, its author's login and its date", () => {
    const parsed = parsePrView(
      JSON.stringify({
        comments: [
          {
            body: "principles-review: No violations.",
            author: { login: "reviewer-bot" },
            createdAt: COMMITTED,
          },
        ],
      }),
    );
    expect(parsed?.comments).toEqual([
      {
        body: "principles-review: No violations.",
        author: "reviewer-bot",
        createdAt: COMMITTED,
      },
    ]);
  });

  it("reads a comment with no author as an empty author", () => {
    expect(
      parsePrView(
        '{"comments":[{"body":"x","createdAt":"2026-01-01T00:00:00Z"}]}',
      )?.comments[0]?.author,
    ).toBe("");
  });

  it("reads each status check's name, status, conclusion and details URL", () => {
    const parsed = parsePrView(
      JSON.stringify({
        statusCheckRollup: [
          {
            name: "check",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            detailsUrl: RUN_URL,
          },
        ],
      }),
    );
    expect(parsed?.rollup).toEqual([
      {
        name: "check",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        url: RUN_URL,
      },
    ]);
  });

  it("reads a field that is not a list as an empty list", () => {
    expect(
      parsePrView('{"comments":"x","statusCheckRollup":{},"commits":null}'),
    ).toMatchObject({ comments: [], rollup: [] });
  });
});
