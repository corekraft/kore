import { expect, test } from "vitest";
import { contractDeclaration } from "./contract-trailers.js";

const version = "1.2.3+abc1234";

/** A head commit message with the given trailer lines, after the subject. */
const commit = (...trailers: string[]) =>
  ["feat: retire a flag", "", ...trailers].join("\n");

const DATA = [
  "Contract-release: data",
  "Contract-last-used: 1.2.2+def5678",
  "Contract-soak-hours: 24",
];

test("a commit with no Contract trailer is not a contract, and raises nothing", () => {
  expect(
    contractDeclaration({
      message: commit("Safety-pattern: feature-flagged"),
      version,
      pattern: "feature-flagged",
    }),
  ).toEqual({ failures: [] });
});

test("a complete data contract declares its kind, last-used release and soak window", () => {
  expect(
    contractDeclaration({
      message: commit(...DATA, "Safety-pattern: expand-contract"),
      version,
      pattern: "expand-contract",
    }),
  ).toEqual({
    declaration: { kind: "data", lastUsed: "1.2.2+def5678", soakHours: 24 },
    failures: [],
  });
});

test("a code contract may state a fractional soak window, with no minimum", () => {
  expect(
    contractDeclaration({
      message: commit(
        "Contract-release: code",
        "Contract-last-used: 1.2.2+def5678",
        "Contract-soak-hours: 0.5",
        "Safety-pattern: expand-contract",
      ),
      version,
      pattern: "expand-contract",
    }),
  ).toEqual({
    declaration: { kind: "code", lastUsed: "1.2.2+def5678", soakHours: 0.5 },
    failures: [],
  });
});

test("the trailer keys are matched case-insensitively, as the Safety-pattern trailer is", () => {
  expect(
    contractDeclaration({
      message: commit(
        "contract-release: data",
        "CONTRACT-LAST-USED: 1.2.2+def5678",
        "contract-soak-hours: 24",
      ),
      version,
      pattern: "expand-contract",
    }).declaration,
  ).toEqual({ kind: "data", lastUsed: "1.2.2+def5678", soakHours: 24 });
});

test("a contract trailer with no Contract-release is refused, naming what the kind is", () => {
  expect(
    contractDeclaration({
      message: commit("Contract-last-used: 1.2.2+def5678"),
      version,
      pattern: "expand-contract",
    }),
  ).toEqual({
    failures: [
      "Contract-release: data or code is missing; a contract names its kind, the release it was last used in and its soak window",
      "Contract-soak-hours is missing; a contract states its soak window as a positive number of hours, such as 24",
    ],
  });
});

test("a Contract-release that is neither data nor code is refused, showing the value it had", () => {
  expect(
    contractDeclaration({
      message: commit(...DATA.map((line) => line.replace("data", "both"))),
      version,
      pattern: "expand-contract",
    }).failures,
  ).toEqual(['Contract-release must be data or code; got "both"']);
});

test("a missing Contract-last-used is refused, naming the earlier release it needs", () => {
  expect(
    contractDeclaration({
      message: commit("Contract-release: data", "Contract-soak-hours: 24"),
      version,
      pattern: "expand-contract",
    }).failures,
  ).toEqual([
    "Contract-last-used: <version>+<sha> is missing; a contract names the earlier release in which the thing was last used",
  ]);
});

test("a Contract-last-used that is not a version plus a commit SHA is refused", () => {
  expect(
    contractDeclaration({
      message: commit(
        ...DATA.map((line) => line.replace("1.2.2+def5678", "1.2.2")),
      ),
      version,
      pattern: "expand-contract",
    }).failures,
  ).toEqual([
    'Contract-last-used must be a semantic version plus a commit SHA, such as 1.2.2+def5678; got "1.2.2"',
  ]);
});

test("a Contract-last-used equal to this candidate's own version is refused, since it must be an earlier release", () => {
  expect(
    contractDeclaration({
      message: commit(
        ...DATA.map((line) => line.replace("1.2.2+def5678", version)),
      ),
      version,
      pattern: "expand-contract",
    }).failures,
  ).toEqual([
    `Contract-last-used must name an earlier release; ${version} is this candidate's own version`,
  ]);
});

test("a missing Contract-soak-hours is refused, naming the unit", () => {
  expect(
    contractDeclaration({
      message: commit(
        "Contract-release: data",
        "Contract-last-used: 1.2.2+def5678",
      ),
      version,
      pattern: "expand-contract",
    }).failures,
  ).toEqual([
    "Contract-soak-hours is missing; a contract states its soak window as a positive number of hours, such as 24",
  ]);
});

test.each(["0", "-3", "1e3", "Infinity", "24h"])(
  "a Contract-soak-hours of %j is not a positive finite number of hours, and is refused",
  (value) => {
    expect(
      contractDeclaration({
        message: commit(
          ...DATA.map((line) => line.replace(/: 24$/, `: ${value}`)),
        ),
        version,
        pattern: "expand-contract",
      }).failures,
    ).toEqual([
      `Contract-soak-hours must be a positive number of hours, such as 24; got "${value}"`,
    ]);
  },
);

test("a contract that does not declare Safety-pattern expand-contract is refused, naming the pattern it has", () => {
  expect(
    contractDeclaration({
      message: commit(...DATA),
      version,
      pattern: "feature-flagged",
    }).failures,
  ).toEqual([
    "a contract declares Safety-pattern expand-contract, not feature-flagged",
  ]);
});

test("a contract with no Safety-pattern trailer says the pattern is none", () => {
  expect(
    contractDeclaration({
      message: commit(...DATA),
      version,
      pattern: undefined,
    }).failures,
  ).toEqual(["a contract declares Safety-pattern expand-contract, not none"]);
});

test("every problem with a declaration is reported together, and no declaration is returned", () => {
  const result = contractDeclaration({
    message: commit("Contract-release: sideways", "Contract-soak-hours: 0"),
    version,
    pattern: "feature-flagged",
  });
  expect(result.declaration).toBeUndefined();
  expect(result.failures).toEqual([
    'Contract-release must be data or code; got "sideways"',
    "Contract-last-used: <version>+<sha> is missing; a contract names the earlier release in which the thing was last used",
    'Contract-soak-hours must be a positive number of hours, such as 24; got "0"',
    "a contract declares Safety-pattern expand-contract, not feature-flagged",
  ]);
});
