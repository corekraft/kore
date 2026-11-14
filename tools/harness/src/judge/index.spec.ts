import { expect, it, vi } from "vitest";
import * as checks from "./checks.js";
import * as declaration from "./declaration.js";
import * as errors from "./errors.js";
import * as judge from "./index.js";
import * as precheck from "./precheck.js";
import * as reviewFindings from "./review-findings.js";
import * as reviewPost from "./review-post.js";
import * as reviewVerdict from "./review-verdict.js";
import * as reviewers from "./reviewers.js";
import * as sendBack from "./send-back.js";

// The barrel only re-exports its files, so each is mocked: the barrel is
// tested as a pass-through, not as the units behind it.
vi.mock("./checks.js");
vi.mock("./declaration.js");
vi.mock("./errors.js");
vi.mock("./precheck.js");
vi.mock("./review-findings.js");
vi.mock("./review-post.js");
vi.mock("./review-verdict.js");
vi.mock("./reviewers.js");
vi.mock("./send-back.js");

it("the judge barrel exposes exactly the names its callers import", () => {
  expect(Object.keys(judge).sort()).toEqual([
    "JudgeError",
    "PATTERNS",
    "findingsFrom",
    "hasSentBack",
    "parseDeclaration",
    "postReview",
    "precheck",
    "readPr",
    "reviewBody",
    "reviewCheck",
    "reviewersFor",
    "sendBackBody",
    "summary",
  ]);
});

it("each export is the unit's own export, not a copy or a wrapper", () => {
  expect(judge.JudgeError).toBe(errors.JudgeError);
  expect(judge.PATTERNS).toBe(declaration.PATTERNS);
  expect(judge.parseDeclaration).toBe(declaration.parseDeclaration);
  expect(judge.reviewCheck).toBe(checks.reviewCheck);
  expect(judge.precheck).toBe(precheck.precheck);
  expect(judge.readPr).toBe(precheck.readPr);
  expect(judge.summary).toBe(precheck.summary);
  expect(judge.findingsFrom).toBe(reviewFindings.findingsFrom);
  expect(judge.postReview).toBe(reviewPost.postReview);
  expect(judge.reviewBody).toBe(reviewVerdict.reviewBody);
  expect(judge.hasSentBack).toBe(sendBack.hasSentBack);
  expect(judge.sendBackBody).toBe(sendBack.sendBackBody);
  expect(judge.reviewersFor).toBe(reviewers.reviewersFor);
});
