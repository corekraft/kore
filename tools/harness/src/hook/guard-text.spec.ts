// Unit tests for the text the role-worktree path check must not read as paths: heredoc bodies and
// the string literals of inline code. Both are pure functions, so nothing here is mocked.

import { describe, expect, it } from "vitest";
import { codeStrings, withoutHeredocBodies } from "./guard-text.js";

describe("withoutHeredocBodies", () => {
  it("drops the body and terminator of a heredoc that only feeds a file, keeping the opening line and the commands after it", () => {
    expect(
      withoutHeredocBodies(
        "cat > notes.md <<'EOF'\nSee /elsewhere/kore/a.ts and cd ../..\nEOF\nrm old.md",
      ),
    ).toBe("cat > notes.md <<'EOF'\nrm old.md");
  });

  it("drops a <<- body whose terminator is tab-indented", () => {
    expect(
      withoutHeredocBodies(
        "cat <<-EOF > a.md\n\tcp a /elsewhere/b\n\tEOF\nrm b",
      ),
    ).toBe("cat <<-EOF > a.md\nrm b");
  });

  it("drops the bodies of several heredocs on one line, in the order they open", () => {
    expect(withoutHeredocBodies("cat <<A <<B\none\nA\ntwo\nB\nrm c")).toBe(
      "cat <<A <<B\nrm c",
    );
  });

  it("keeps the whole command when the body is run by a shell or an interpreter", () => {
    const shell = "bash <<'EOF'\nrm /elsewhere/b\nEOF";
    const piped = "cat <<'EOF' | sh\nrm /elsewhere/b\nEOF";
    const node = "node <<'EOF'\nrequire('fs').rmSync('/elsewhere/b')\nEOF";
    expect(withoutHeredocBodies(shell)).toBe(shell);
    expect(withoutHeredocBodies(piped)).toBe(piped);
    expect(withoutHeredocBodies(node)).toBe(node);
  });

  it("opens no heredoc at a << inside quotes, so the next line stays a command", () => {
    const quoted = 'echo "<<EOF"\nrm /elsewhere/b\nEOF';
    expect(withoutHeredocBodies(quoted)).toBe(quoted);
  });

  it("opens no heredoc at a here-string, which is one word", () => {
    const herestring = 'cat <<< "a"\nrm /elsewhere/b';
    expect(withoutHeredocBodies(herestring)).toBe(herestring);
  });

  it("drops everything after an unterminated heredoc, as the shell does", () => {
    expect(withoutHeredocBodies("cat <<EOF > a.md\nrm /elsewhere/b")).toBe(
      "cat <<EOF > a.md",
    );
  });

  it("returns a command with no heredoc unchanged", () => {
    expect(withoutHeredocBodies("cp a /elsewhere/b && rm c")).toBe(
      "cp a /elsewhere/b && rm c",
    );
  });
});

describe("codeStrings", () => {
  it("returns the contents of each string literal, which are the only paths inline code names", () => {
    expect(
      codeStrings("require('fs').readFileSync('/etc/hosts', `utf8`)"),
    ).toEqual(["fs", "/etc/hosts", "utf8"]);
  });

  it("reads no regex literal as a string, so a path-like regex is not a path", () => {
    expect(codeStrings("const re=/restrict|Pattern/i; re.test('x')")).toEqual([
      "x",
    ]);
  });

  it("reads a regex literal that holds a quote without starting a string", () => {
    expect(codeStrings("x=/'/; y('/a')")).toEqual(["/a"]);
  });

  it("reads a regex after return, and division as division", () => {
    expect(codeStrings("return /'/; a = b / c; d('/x')")).toEqual(["/x"]);
  });

  it("skips a line comment, which runs no code", () => {
    expect(codeStrings("// read('/etc/hosts')\nok('/x')")).toEqual(["/x"]);
  });

  it("keeps an escaped quote inside a literal", () => {
    expect(codeStrings("'it\\'s /a'")).toEqual(["it's /a"]);
  });
});
