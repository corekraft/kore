import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginsOf } from "./cost-config-logins.js";
import { bad } from "./cost-config-support.js";

vi.mock("./cost-config-support.js");

const FILE = ".claude/harness.json";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(bad).mockImplementation((_file, key, fix) => ({
    error: `bad ${key}: ${fix}`,
  }));
});

describe("loginsOf: the owner login and the reviewer logins of the harness config", () => {
  it("gives neither when the config sets neither", () => {
    expect(loginsOf(FILE, {})).toEqual({});
  });

  it("keeps a plain owner login and a list of plain and GitHub App reviewer logins", () => {
    expect(
      loginsOf(FILE, {
        ownerLogin: "junners",
        reviewerLogins: ["junners", "app/kore-reviewer"],
      }),
    ).toEqual({
      ownerLogin: "junners",
      reviewerLogins: ["junners", "app/kore-reviewer"],
    });
  });

  it.each(["app/kore-reviewer", "two words", "", 7])(
    "refuses an owner login of %j, naming the key",
    (login) => {
      expect(loginsOf(FILE, { ownerLogin: login })).toEqual({
        error: expect.stringMatching(/^bad ownerLogin: must be a GitHub login/),
      });
      expect(bad).toHaveBeenCalledWith(FILE, "ownerLogin", expect.any(String));
    },
  );

  it.each([
    [[]],
    ["junners"],
    [["two words"]],
    [[7]],
    [["app/"]],
    [["app/-a"]],
  ])("refuses reviewer logins %j, naming the key", (logins) => {
    expect(loginsOf(FILE, { reviewerLogins: logins })).toEqual({
      error: expect.stringMatching(/^bad reviewerLogins: must be a non-empty/),
    });
  });
});
