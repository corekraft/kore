import { beforeEach, expect, test, vi } from "vitest";
import { isAgeRecipient, type Repository } from "../config/index.js";
import { fakeRepository } from "./platform-support.js";
import { sopsProblems } from "./preflight-sops.js";

vi.mock("../config/index.js");

const recipient =
  "age1x9t7jczgl5xx3djfgy4x2cygnvj8k9qxjhnu0zxh79kr4aty3cgs6wulrg";

beforeEach(() => {
  vi.mocked(isAgeRecipient).mockImplementation((value) => value === recipient);
});

function vpsWith(sopsRecipients: string[] | undefined): Repository {
  return {
    ...fakeRepository({ name: "vps", provider: "managed" }),
    sopsRecipients,
  };
}

test("a vps creation rule that names a valid age recipient is no missing prerequisite", () => {
  expect(sopsProblems(vpsWith([recipient]))).toEqual([]);
});

test("a vps with no creation rule for its secrets is missing the sops recipient, and the fix names the vps secrets path", () => {
  const [problem] = sopsProblems(vpsWith(undefined));
  expect(problem).toMatchObject({ name: "sops recipient" });
  expect(problem?.problem).toContain("infra/environments/vps/secrets");
  expect(problem?.fix).toContain("infra/environments/vps/secrets");
});

test("a creation rule whose recipient is a placeholder rather than an age public key is missing the sops recipient", () => {
  const problems = sopsProblems(vpsWith(["AGE-RECIPIENT-MUST-BE-CONFIGURED"]));
  expect(problems).toHaveLength(1);
  expect(problems[0]?.name).toBe("sops recipient");
  expect(problems[0]?.problem).toContain("not an age public key");
});

test("a creation rule with one valid and one invalid recipient is still refused, and it names the count", () => {
  const problems = sopsProblems(vpsWith([recipient, "not-a-key"]));
  expect(problems).toHaveLength(1);
  expect(problems[0]?.problem).toContain("1 recipient");
});
