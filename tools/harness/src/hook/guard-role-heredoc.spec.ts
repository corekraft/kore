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

  it("allows a quoted session send heredoc, whose body is data", () => {
    expect(
      bash(
        "reader",
        "node skills/bin/harness.mjs session send peer-1 <<'EOF'\nrun `ls` and $(x)\nEOF",
      ),
    ).toBeNull();
  });
});

describe("a read-only role's heredoc hides no write unless it is an allowed session report", () => {
  const REPORT = "node skills/bin/harness.mjs session report --summary -";

  it.each([
    ["a quoted opener inside a string", "cat \"<<'EOF'\"\ntee out\nEOF"],
    ["a parameter expansion", "echo ${x:-<<'EOF'}\ntee out\nEOF"],
    ["a legacy arithmetic expansion", "echo $[1<<'EOF']\ntee out\nEOF"],
    ["a conditional expression", "[[ a <<'EOF' ]]\ntee out\nEOF"],
    ["arithmetic", "echo $((1<<'EOF'))\ntee out\nEOF"],
    ["an ANSI-C quoted string", "echo $'x'<<'EOF'\ntee out\nEOF"],
    ["a ;-chained opener", "ls; cat <<'EOF'\ntee out\nEOF"],
    ["a command that reads the body", "bash <<'EOF'\ntee out\nEOF"],
    [
      "a report segment chained to another command",
      `${REPORT} <<'EOF'; ls\ntee out\nEOF`,
    ],
    [
      "a report segment preceded by another command",
      `ls; ${REPORT} <<'EOF'\ntee out\nEOF`,
    ],
    ["a report segment on a later line", `ls\n${REPORT} <<'EOF'\ntee out\nEOF`],
    [
      "a second opener on the report line",
      `${REPORT} <<'EOF' <<'END'\ntee out\nEOF`,
    ],
    [
      "a redirection on the report line",
      `${REPORT} > out <<'EOF'\nx\nEOF\ntee out`,
    ],
  ])("refuses a write hidden after %s", (_name, command) => {
    expect(bash("reader", command)).toMatchObject({
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
