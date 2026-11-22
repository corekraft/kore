import { describe, expect, it } from "vitest";
import { shellOutsideBodies } from "./guard-heredoc.js";

const REPORT = "node skills/bin/harness.mjs session report --summary -";

describe("shellOutsideBodies drops only the body of an allowed session report or send heredoc", () => {
  it("drops a quoted body but keeps the shell after its terminator", () => {
    expect(
      shellOutsideBodies(`${REPORT} <<'EOF'\nbody $(x) \`y\`\nEOF\ntee out`),
    ).toBe(`${REPORT} <<'EOF'\ntee out`);
  });

  it("drops the body of a session send heredoc", () => {
    expect(
      shellOutsideBodies(
        "node skills/bin/harness.mjs session send peer-1 <<'MSG'\nrm x\nMSG",
      ),
    ).toBe("node skills/bin/harness.mjs session send peer-1 <<'MSG'");
  });

  it("keeps an unquoted body, which the shell expands", () => {
    const command = `${REPORT} <<EOF\n$(id)\nEOF`;
    expect(shellOutsideBodies(command)).toBe(command);
  });

  it("ends the body only at a line that is exactly the tag", () => {
    expect(shellOutsideBodies(`${REPORT} <<'EOF'\n EOF\nEOF \nEOF\nls`)).toBe(
      `${REPORT} <<'EOF'\nls`,
    );
  });

  it("returns a command with no heredoc unchanged", () => {
    expect(shellOutsideBodies("ls -la")).toBe("ls -la");
  });

  describe("strips nothing when the first line is not exactly an allowed segment", () => {
    it.each([
      ["inside double quotes", "cat \"<<'EOF'\"\ntee out\nEOF"],
      ["inside a parameter expansion", "echo ${x:-<<'EOF'}\ntee out\nEOF"],
      ["inside arithmetic", "echo $((1<<'EOF'))\ntee out\nEOF"],
      [
        "inside a legacy arithmetic expansion",
        "echo $[1<<'EOF']\ntee out\nEOF",
      ],
      ["inside a conditional expression", "[[ a <<'EOF' ]]\ntee out\nEOF"],
      ["after an ANSI-C quoted string", "echo $'x'<<'EOF'\ntee out\nEOF"],
      [
        "after an escaped quote in an ANSI-C string",
        "echo $'\\'' <<'EOF'\ntee out\nEOF",
      ],
      ["after a ;-chained command", "ls; cat <<'EOF'\ntee out\nEOF"],
      [
        "for a command that is not session report or send",
        "cat <<'EOF'\ntee out\nEOF",
      ],
      ["for an indented heredoc", `${REPORT} <<-'EOF'\ntee out\nEOF`],
      [
        "with a command chained after the opener",
        `${REPORT} <<'EOF'; ls\ntee out\nEOF`,
      ],
      [
        "with a command chained before the segment",
        `ls; ${REPORT} <<'EOF'\ntee out\nEOF`,
      ],
      [
        "when the segment is on a later line",
        `ls\n${REPORT} <<'EOF'\ntee out\nEOF`,
      ],
      ["with a second opener", `${REPORT} <<'EOF' <<'END'\ntee out\nEOF`],
      ["with a quoted argument", `${REPORT} "a b" <<'EOF'\ntee out\nEOF`],
      ["with a redirection", `${REPORT} > out <<'EOF'\ntee out\nEOF`],
      ["with a substitution argument", `${REPORT} $(id) <<'EOF'\ntee out\nEOF`],
      ["with a here-string", `${REPORT} <<<'EOF'\ntee out\nEOF`],
      ["with a double-quoted tag", `${REPORT} <<"EOF"\ntee out\nEOF`],
      ["with trailing text", `${REPORT} <<'EOF' \ntee out\nEOF`],
    ])("%s", (_name, command) => {
      expect(shellOutsideBodies(command)).toBe(command);
    });
  });
});
