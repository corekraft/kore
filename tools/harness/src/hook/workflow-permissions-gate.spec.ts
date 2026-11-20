// The exact gate of each signing job in release.yaml: release, mirror and charts
// run only on a tag, charts-main only on main, and no other job may hold a
// signing scope. The rules are the signer guard's (ADR 0138, issue #1370).
// Plan: infra/plans/2-implementation.md (Step 7), ADR 0044, ADR 0138.

import { describe, expect, it } from "vitest";
import { permissionProblems } from "./workflow-permissions.js";
import { SIGNERS, release, signerJob } from "./workflow-permissions-support.js";

const TAG = "if: github.ref_type == 'tag'";
const MAIN = "if: github.ref == 'refs/heads/main'";
const TAG_FIX = "add `if: github.ref_type == 'tag'`";
const MAIN_FIX = "add `if: github.ref == 'refs/heads/main'`";

const releaseYaml = (name: string, ifLine: string | null) => ({
  "release.yaml": signerJob(name, ifLine),
});

describe("permissionProblems: the accepted gates of the signing jobs", () => {
  it.each(["mirror", "charts"])(
    "accepts a %s job with its exact tag gate",
    (name) => {
      expect(permissionProblems(releaseYaml(name, TAG))).toEqual([]);
    },
  );

  it("accepts a charts-main job with its exact main gate", () => {
    expect(permissionProblems(releaseYaml("charts-main", MAIN))).toEqual([]);
  });
});

describe("permissionProblems: a charts-main job needs its exact main gate", () => {
  it.each([
    ["no if", null],
    ["the tag gate", TAG],
    ["the expression wrapper", "if: ${{ github.ref == 'refs/heads/main' }}"],
    ["a block scalar", "if: |\n      github.ref == 'refs/heads/main'"],
    ["a comment glued to the gate", "if: github.ref == 'refs/heads/main'#main"],
    ["main or true", "if: github.ref == 'refs/heads/main' || true"],
  ])("refuses a charts-main job whose gate is %s", (_form, ifLine) => {
    expect(permissionProblems(releaseYaml("charts-main", ifLine))).toEqual([
      `release.yaml: signing job charts-main must run only for main; ${MAIN_FIX}`,
    ]);
  });
});

describe("permissionProblems: release, mirror and charts need their exact tag gate", () => {
  it.each([
    [
      "tag or main",
      "if: github.ref_type == 'tag' || github.ref == 'refs/heads/main'",
    ],
    ["tag or true", "if: github.ref_type == 'tag' || true"],
    ["the main gate", MAIN],
  ])("refuses a charts job whose gate is %s", (_form, ifLine) => {
    expect(permissionProblems(releaseYaml("charts", ifLine))).toEqual([
      `release.yaml: signing job charts must run only for tags; ${TAG_FIX}`,
    ]);
  });

  it("refuses a mirror job gated to main, naming the tag gate to add", () => {
    expect(permissionProblems(releaseYaml("mirror", MAIN))).toEqual([
      `release.yaml: signing job mirror must run only for tags; ${TAG_FIX}`,
    ]);
  });
});

describe("permissionProblems: only the named charts-main job may sign on main", () => {
  it.each(["Charts-Main", "charts_main", "sneaky"])(
    "refuses a %s job gated to main as an unknown signer",
    (name) => {
      expect(permissionProblems(releaseYaml(name, MAIN))).toEqual([
        `release.yaml: job ${name} requests id-token: write; ${SIGNERS}`,
        `release.yaml: job ${name} requests packages: write; ${SIGNERS}`,
      ]);
    },
  );

  it.each(["nightly.yml", "check.yml"])(
    "refuses a charts-main job gated to main in %s",
    (file) => {
      expect(
        permissionProblems({ [file]: signerJob("charts-main", MAIN) }),
      ).toEqual([
        `${file}: job release requests packages: write; ${SIGNERS}`,
        `${file}: job release requests id-token: write; ${SIGNERS}`,
        `${file}: job charts-main requests id-token: write; ${SIGNERS}`,
        `${file}: job charts-main requests packages: write; ${SIGNERS}`,
      ]);
    },
  );

  it("refuses a pull_request trigger in release.yaml beside a charts-main job", () => {
    const text = signerJob("charts-main", MAIN).replace(
      "  workflow_dispatch:\n",
      "  workflow_dispatch:\n  pull_request:\n",
    );
    expect(permissionProblems({ "release.yaml": text })).toEqual([
      "release.yaml: must not run on pull_request; a pull request could mint a trusted signature, so remove the trigger",
    ]);
  });
});

describe("permissionProblems: a signing job's if: is one line equal to its gate", () => {
  // GitHub joins a plain scalar's continuation lines into the condition, so a
  // deeper-indented line after `if:` must be refused, not ignored.
  const lineMessage = (name: string, runsOn: string, gate: string) =>
    `release.yaml: signing job ${name} must run only for ${runsOn}; its if: spans more than one line, and the gate must be one line equal to the exact condition, so write \`if: ${gate}\` on one line`;
  const CONT = ["\n      || true", "\n      - || true"];

  it("refuses a charts-main job whose if: continues onto a second line", () => {
    for (const cont of CONT) {
      expect(
        permissionProblems(releaseYaml("charts-main", `${MAIN}${cont}`)),
      ).toEqual([
        lineMessage("charts-main", "main", "github.ref == 'refs/heads/main'"),
      ]);
    }
  });

  it.each(["charts", "mirror"])(
    "refuses a %s job whose tag gate continues onto a second line",
    (name) => {
      for (const cont of CONT) {
        expect(permissionProblems(releaseYaml(name, `${TAG}${cont}`))).toEqual([
          lineMessage(name, "tags", "github.ref_type == 'tag'"),
        ]);
      }
    },
  );

  it("refuses a release job whose tag gate continues onto a second line", () => {
    for (const cont of CONT) {
      expect(
        permissionProblems({
          "release.yaml": release({
            ifRelease: `github.ref_type == 'tag'${cont}`,
          }),
        }),
      ).toEqual([lineMessage("release", "tags", "github.ref_type == 'tag'")]);
    }
  });
});
