// Docs: infra/plans/11-agent-delivery-loop.md (Step 3, the challenge stage)
import { describe, expect, it } from "vitest";
import {
  distinctRounds,
  duplicateRounds,
  MAX_ROUNDS,
  markerFor,
  parseObjections,
  parseRounds,
  renderRound,
  type IssueComment,
  type Round,
} from "./model.js";

const AUTHOR = "junners";

const comment = (
  body: string,
  author = AUTHOR,
  url = `https://example.test/comment-${body.length}`,
): IssueComment => ({ body, author, url });

const marker = (idea: string, round: number) =>
  `<!-- harness-challenge idea=${idea} round=${round} -->`;

describe("challenge model constants and markers", () => {
  it("allows exactly two challenge rounds before a person decides", () => {
    expect(MAX_ROUNDS).toBe(2);
  });

  it("writes the marker that finds a round again on the issue", () => {
    expect(markerFor("0001", 2)).toBe(marker("0001", 2));
  });
});

describe("renderRound", () => {
  it("lists each objection as a bullet under the round heading", () => {
    expect(renderRound("0001", 1, ["No baseline.", "No rollback."])).toBe(
      [
        marker("0001", 1),
        "## Challenge round 1 of 2",
        "",
        "Open objections:",
        "",
        "- No baseline.",
        "- No rollback.",
        "",
      ].join("\n"),
    );
  });

  it("records a round with no objections as an approval", () => {
    expect(renderRound("0002", 2, [])).toBe(
      [
        marker("0002", 2),
        "## Challenge round 2 of 2",
        "",
        "No open objections.",
        "",
      ].join("\n"),
    );
  });
});

describe("parseRounds", () => {
  it("reads the round and its objections from a comment by the author", () => {
    const rounds = parseRounds(
      "0001",
      [comment(renderRound("0001", 1, ["No baseline."]), AUTHOR, "u1")],
      AUTHOR,
    );
    expect(rounds).toEqual([
      { round: 1, objections: ["No baseline."], url: "u1" },
    ]);
  });

  it("reads an approval as a round with no objections", () => {
    const rounds = parseRounds(
      "0001",
      [comment(renderRound("0001", 1, []))],
      AUTHOR,
    );
    expect(rounds).toEqual([
      expect.objectContaining({ round: 1, objections: [] }),
    ]);
  });

  it("ignores a comment by anyone but the author", () => {
    const rounds = parseRounds(
      "0001",
      [comment(renderRound("0001", 1, ["x"]), "mallory")],
      AUTHOR,
    );
    expect(rounds).toEqual([]);
  });

  it("ignores rounds recorded for another idea", () => {
    const rounds = parseRounds(
      "0001",
      [comment(renderRound("0002", 1, ["other"]))],
      AUTHOR,
    );
    expect(rounds).toEqual([]);
  });

  it("ignores a comment whose first line is not the marker, such as a person's remark", () => {
    const rounds = parseRounds(
      "0001",
      [comment(`Challenge round 1 of 2 looked fair.\n- x`)],
      AUTHOR,
    );
    expect(rounds).toEqual([]);
  });

  it("returns the rounds in round order, whatever order the comments came in", () => {
    const rounds = parseRounds(
      "0001",
      [
        comment(renderRound("0001", 2, ["second"]), AUTHOR, "u2"),
        comment(renderRound("0001", 1, ["first"]), AUTHOR, "u1"),
      ],
      AUTHOR,
    );
    expect(rounds.map((r) => r.round)).toEqual([1, 2]);
  });

  it("reads objections with CRLF line endings and drops blank bullets", () => {
    const body = `${marker("0001", 1)}\r\n## Challenge round 1 of 2\r\n\r\n- one\r\n- \r\n- two\r\n`;
    expect(parseRounds("0001", [comment(body)], AUTHOR)).toEqual([
      expect.objectContaining({ objections: ["one", "two"] }),
    ]);
  });
});

describe("parseObjections", () => {
  it("reads one objection per line, dropping any leading bullet", () => {
    expect(parseObjections("- first\n* second\n  third  \n")).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("skips blank lines and returns nothing for empty input", () => {
    expect(parseObjections("\n  \n")).toEqual([]);
    expect(parseObjections("")).toEqual([]);
  });
});

describe("distinctRounds", () => {
  const first: Round = { round: 1, objections: ["a"], url: "u1" };
  const again: Round = { round: 1, objections: ["b"], url: "u1b" };
  const second: Round = { round: 2, objections: [], url: "u2" };

  it("keeps the first comment for each round number, so a duplicate counts once", () => {
    expect(distinctRounds([first, again, second])).toEqual([first, second]);
  });

  it("returns an empty list for no rounds", () => {
    expect(distinctRounds([])).toEqual([]);
  });
});

describe("duplicateRounds", () => {
  it("names each round number claimed by more than one comment, with those comments", () => {
    const rounds: Round[] = [
      { round: 1, objections: [], url: "a" },
      { round: 2, objections: [], url: "b" },
      { round: 1, objections: [], url: "c" },
    ];
    expect(duplicateRounds(rounds)).toEqual([{ round: 1, urls: ["a", "c"] }]);
  });

  it("returns nothing when every round number appears once", () => {
    expect(duplicateRounds([{ round: 1, objections: [], url: "a" }])).toEqual(
      [],
    );
  });
});
