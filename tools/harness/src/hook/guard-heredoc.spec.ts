import { describe, expect, it } from "vitest";
import { shellOutsideBodies } from "./guard-heredoc.js";

describe("shellOutsideBodies drops only a quoted heredoc's body, which is data", () => {
  it("drops a quoted body but keeps the shell after its terminator", () => {
    expect(
      shellOutsideBodies(
        "harness session report --summary - <<'EOF'\nbody $(x) `y`\nEOF\ntee out",
      ),
    ).toBe("harness session report --summary - <<'EOF'\ntee out");
  });

  it("keeps an unquoted body, which the shell expands", () => {
    expect(shellOutsideBodies("cat <<EOF\n$(id)\nEOF")).toBe(
      "cat <<EOF\n$(id)\nEOF",
    );
  });

  it("drops an indented quoted body up to its indented terminator", () => {
    expect(shellOutsideBodies("cat <<-'EOF'\n\tbody rm\n\tEOF\necho ok")).toBe(
      "cat <<-'EOF'\necho ok",
    );
  });

  it("still drops a quoted body after an opener that follows a closed quote", () => {
    expect(shellOutsideBodies("echo \"it's\" <<'EOF'\nrm x\nEOF\nls")).toBe(
      "echo \"it's\" <<'EOF'\nls",
    );
  });

  describe("an opener the shell does not read as one drops nothing", () => {
    it.each([
      ["inside double quotes", "cat \"<<'EOF'\"\ntee out\nEOF"],
      ["inside single quotes", "echo '<<EOF' '<<\"EOF\"'\ntee out"],
      [
        "inside a double-quoted string that spans lines",
        "echo \"a\n<<'EOF'\n\"\ntee out\nEOF",
      ],
      ["inside arithmetic", "echo $((1<<'EOF'))\ntee out\nEOF"],
      ["inside a subshell", "(cat <<'EOF'\ntee out\nEOF"],
      ["after a backslash", "cat \\<<'EOF'\ntee out\nEOF"],
      ["in a comment", "ls # <<'EOF'\ntee out\nEOF"],
      ["as a here-string", "cat <<<'EOF'\ntee out\nEOF"],
      ["inside a parameter expansion", "echo ${x:-<<'EOF'}\ntee out\nEOF"],
      [
        "inside a parameter expansion in a string",
        'echo "${x:-"<<\'EOF\'"}"\ntee out\nEOF',
      ],
      [
        "inside a legacy arithmetic expansion",
        "echo $[1<<'EOF']\ntee out\nEOF",
      ],
      ["inside a conditional expression", "[[ a <<'EOF' ]]\ntee out\nEOF"],
    ])("%s", (_name, command) => {
      expect(shellOutsideBodies(command)).toBe(command);
    });
  });

  it("returns a command with no heredoc unchanged", () => {
    expect(shellOutsideBodies("ls -la")).toBe("ls -la");
  });
});
