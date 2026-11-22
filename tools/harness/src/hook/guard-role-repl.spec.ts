import { describe, expect, it } from "vitest";
import { checkRole } from "./guard-role.js";

const READ_ONLY = ["reader", "principles-review", "judgment"];
const WRITE = { code: "await $`echo x > out.txt`" };

describe("a read-only role may not run a REPL call, whose JavaScript the guard cannot read", () => {
  it.each(READ_ONLY)("refuses %s a REPL write under role-read-only", (role) => {
    expect(checkRole(role, "REPL", WRITE, "/repo")).toMatchObject({
      action: "block",
      rule: "role-read-only",
    });
  });

  it.each(READ_ONLY)(
    "refuses %s a REPL read too, since the guard cannot tell it from a write",
    (role) => {
      expect(
        checkRole(
          role,
          "REPL",
          { code: "await $`cat docs/index.md`" },
          "/repo",
        ),
      ).toMatchObject({ action: "block", rule: "role-read-only" });
    },
  );

  it("leaves a REPL call from a session with no role to the other rules", () => {
    expect(checkRole(undefined, "REPL", WRITE, "/repo")).toBeNull();
  });
});
