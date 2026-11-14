// Docs: docs/decisions/0077-feature-flags-are-activated-only-after-a-live-run-verification.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { outcomeSection } from "../idea/index.js";
import { fakeRepository, type FakeIdea } from "./flag-support.js";
import { findProof } from "./proof.js";

vi.mock("../idea/index.js");

const FLAG = "ingress-agentgateway";
const ENVIRONMENT = "local";

const proven: Record<string, string> = {
  Result: "confirmed",
  Kind: "verification",
  Source: "live-run",
  Flag: FLAG,
  Environment: ENVIRONMENT,
};

/** An outcome section as the tool writes it: the heading, a blank line, then the field lines. */
function section(fields: Record<string, string>, after = ""): string {
  return [
    "## Outcome",
    "",
    ...Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`),
    after,
  ].join("\n");
}

const idea = (number: string, body: string): FakeIdea => ({
  number,
  path: `docs/ideas/${number}-proof.md`,
  text: body,
});

beforeEach(() => {
  // The real section reader: the text from `## Outcome` on, or undefined when there is none.
  vi.mocked(outcomeSection).mockImplementation((text) =>
    text === "" ? undefined : text,
  );
});

describe("findProof matching", () => {
  it("returns the idea whose confirmed live-run verification matches", async () => {
    const repo = fakeRepository([idea("0001", section(proven))]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toEqual({
      idea: "0001",
      path: "docs/ideas/0001-proof.md",
    });
  });

  it("skips an idea with no outcome section and keeps looking", async () => {
    const repo = fakeRepository([
      idea("0001", ""),
      idea("0002", section(proven)),
    ]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toMatchObject({
      idea: "0002",
    });
  });

  it("finds no proof when no idea has a matching outcome", async () => {
    const repo = fakeRepository([idea("0001", "")]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toBeUndefined();
  });

  it.each([
    ["a refuted result", { Result: "refuted" }],
    ["an experiment kind", { Kind: "experiment" }],
    ["a journal source", { Source: "journal" }],
    ["another flag", { Flag: "other-flag" }],
    ["another environment", { Environment: "managed-example" }],
  ])("refuses proof that is %s", async (_, change) => {
    const repo = fakeRepository([
      idea("0001", section({ ...proven, ...change })),
    ]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toBeUndefined();
  });

  it("refuses an outcome that is missing one of the five fields", async () => {
    const missing: Record<string, string> = { ...proven };
    delete missing["Source"];
    const repo = fakeRepository([idea("0001", section(missing))]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toBeUndefined();
  });

  it("trims whitespace around a field's value", async () => {
    const padded = section({ ...proven, Result: "  confirmed  " });
    const repo = fakeRepository([idea("0001", padded)]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toMatchObject({
      idea: "0001",
    });
  });

  it("takes the first value when a field is repeated, so a later one cannot override it", async () => {
    const refutedFirst = section(
      { ...proven, Result: "refuted" },
      "- Result: confirmed",
    );
    const repo = fakeRepository([idea("0001", refutedFirst)]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toBeUndefined();
  });

  it("accepts a repeated confirmed field when the first value is confirmed", async () => {
    const confirmedFirst = section(proven, "- Result: refuted");
    const repo = fakeRepository([idea("0001", confirmedFirst)]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toMatchObject({
      idea: "0001",
    });
  });

  it("ignores a field line written after the blank line that ends the block", async () => {
    const forged = section(
      { ...proven, Result: "refuted" },
      "\nSummary.\n- Result: confirmed",
    );
    const repo = fakeRepository([idea("0001", forged)]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toBeUndefined();
  });
});

describe("findProof reading the outcome block", () => {
  it("reads the field block to the end of the section when no blank line ends it", async () => {
    const body = [
      "## Outcome",
      ...Object.entries(proven).map(([key, value]) => `- ${key}: ${value}`),
    ].join("\n");
    const repo = fakeRepository([idea("0001", body)]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toMatchObject({
      idea: "0001",
    });
  });

  it("finds no proof in a section with a heading and no field lines", async () => {
    const repo = fakeRepository([idea("0001", "## Outcome\n\nIt worked.")]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toBeUndefined();
  });

  it("reads only lines shaped like a field, ignoring any other bullet", async () => {
    const body = section(proven).replace(
      "- Result: confirmed",
      "* Result: confirmed",
    );
    const repo = fakeRepository([idea("0001", body)]);
    expect(await findProof(repo, FLAG, ENVIRONMENT)).toBeUndefined();
  });
});
