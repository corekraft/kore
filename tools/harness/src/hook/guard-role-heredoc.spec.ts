import { describe, expect, it } from "vitest";
import { checkRole } from "./guard-role.js";

const bash = (role: string, command: string) =>
  checkRole(role, "Bash", { command }, "/repo");

const SUBSTITUTION = {
  action: "block",
  message: expect.stringContaining("A command substitution"),
};

describe("a read-only role's session report heredoc is data, not shell", () => {
  it("allows a quoted heredoc whose body holds backticks and $( ) text", () => {
    const command =
      "node skills/bin/harness.mjs session report --outcome done --summary - <<'EOF'\nThe verdict cites `src/a.ts:3` and $(not run)\nsrc/b.ts:9 | rule | `x`\nEOF";

    expect(bash("reader", command)).toBeNull();
  });

  it("allows a quoted plan heredoc whose body would read as commands", () => {
    const command =
      'node skills/bin/harness.mjs session report --outcome done --plan - <<\'EOF\'\n{"stop":{"reason":"rm -rf x"}}\nEOF';

    expect(bash("reader", command)).toBeNull();
  });

  it("refuses a substitution in the command before the heredoc", () => {
    expect(bash("reader", "echo $(id) <<'EOF'\nx\nEOF")).toMatchObject(
      SUBSTITUTION,
    );
  });

  it("refuses a substitution in an unquoted heredoc body, which the shell would run", () => {
    expect(
      bash(
        "reader",
        "node skills/bin/harness.mjs session report --outcome done --summary - <<EOF\n$(id)\nEOF",
      ),
    ).toMatchObject(SUBSTITUTION);
  });

  it("refuses a write hidden after a quoted opener that sits inside a string", () => {
    expect(bash("reader", "cat \"<<'EOF'\"\ntee out\nEOF")).toMatchObject({
      action: "block",
      rule: "role-read-only",
    });
  });

  it.each([
    ["a parameter expansion", "echo ${x:-<<'EOF'}\ntee out\nEOF"],
    ["a legacy arithmetic expansion", "echo $[1<<'EOF']\ntee out\nEOF"],
    ["a conditional expression", "[[ a <<'EOF' ]]\ntee out\nEOF"],
  ])(
    "refuses a write hidden after a quoted opener inside %s",
    (_name, command) => {
      expect(bash("reader", command)).toMatchObject({
        action: "block",
        rule: "role-read-only",
      });
    },
  );

  it("refuses a write hidden after a quoted opener inside arithmetic", () => {
    expect(bash("reader", "echo $((1<<'EOF'))\ntee out\nEOF")).toMatchObject({
      action: "block",
      rule: "role-read-only",
    });
  });

  it("refuses a write placed after a heredoc's terminator", () => {
    expect(
      bash(
        "reader",
        "node skills/bin/harness.mjs session report --outcome done --summary - <<'EOF'\nx\nEOF\ntee out",
      ),
    ).toMatchObject({ action: "block", rule: "role-read-only" });
  });
});
