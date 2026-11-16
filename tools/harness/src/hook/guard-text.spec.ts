// Unit tests for the text the role-worktree path check must not read as paths: heredoc bodies and
// the string literals of inline code. Both are pure functions, so nothing here is mocked.

import { describe, expect, it } from "vitest";
import { codeStrings, withoutHeredocBodies } from "./guard-text.js";

const body = "See /elsewhere/kore/a.ts and rm /elsewhere/b && cd ../..";

describe("withoutHeredocBodies drops a body that is only text", () => {
  it("drops the body and terminator of a lone cat or tee that only writes a file, keeping the opening line", () => {
    expect(withoutHeredocBodies(`cat > notes.md <<'EOF'\n${body}\nEOF`)).toBe(
      "cat > notes.md <<'EOF'",
    );
    expect(withoutHeredocBodies(`tee -a n.md <<EOF\n${body}\nEOF`)).toBe(
      "tee -a n.md <<EOF",
    );
  });

  it("drops a <<- body whose terminator is tab-indented", () => {
    expect(
      withoutHeredocBodies("cat <<-EOF > a.md\n\tcp a /elsewhere/b\n\tEOF"),
    ).toBe("cat <<-EOF > a.md");
  });

  it("drops the bodies of several heredocs on one line, in the order they open", () => {
    expect(withoutHeredocBodies("cat <<A <<B > c.md\none\nA\ntwo\nB")).toBe(
      "cat <<A <<B > c.md",
    );
  });

  it("drops everything after an unterminated heredoc, as the shell does", () => {
    expect(withoutHeredocBodies("cat <<EOF > a.md\nrm /elsewhere/b")).toBe(
      "cat <<EOF > a.md",
    );
  });

  it("drops a body with a substitution when the terminator is quoted, since the shell leaves it as text", () => {
    expect(
      withoutHeredocBodies("cat > a.md <<'EOF'\n$(rm /elsewhere/b)\nEOF"),
    ).toBe("cat > a.md <<'EOF'");
    expect(
      withoutHeredocBodies('cat > a.md <<"EOF"\n`rm /elsewhere/b`\nEOF'),
    ).toBe('cat > a.md <<"EOF"');
    expect(
      withoutHeredocBodies("cat > a.md <<\\EOF\n$(rm /elsewhere/b)\nEOF"),
    ).toBe("cat > a.md <<\\EOF");
  });
});

describe("withoutHeredocBodies keeps the command whole when anything else could run", () => {
  it("keeps the whole command when any other command word follows, whatever it is", () => {
    for (const after of [
      "ls",
      "mv a.md b.md",
      "sh<a.sh",
      "bash<a.sh",
      "node<a.js",
      "./a.sh",
      "/tmp/a.sh",
      "source a.sh",
      ". a.sh",
      "exec sh a.sh",
      'eval "$(cat a.sh)"',
      "xargs sh <a.sh",
      "cat a.sh | env sh",
    ]) {
      const command = `cat > a.sh <<'EOF'\n${body}\nEOF\n${after}`;
      expect(withoutHeredocBodies(command)).toBe(command);
    }
  });

  it("keeps the whole command when a command word follows on the opening line", () => {
    for (const joiner of [";", "&&", "||", "|", "&"]) {
      const command = `cat <<EOF > a.md ${joiner} sh a.md\n${body}\nEOF`;
      expect(withoutHeredocBodies(command)).toBe(command);
    }
  });

  it("keeps the whole command when a command hides in a substitution on the opening line", () => {
    for (const opening of [
      "cat <<EOF > $(sh a.md)",
      "cat <<EOF > `sh a.md`",
      "cat <<EOF > >(sh)",
      "cat <<EOF > a.md $(sh)",
    ]) {
      const command = `${opening}\n${body}\nEOF`;
      expect(withoutHeredocBodies(command)).toBe(command);
    }
  });
});

describe("withoutHeredocBodies keeps the command whole when the opening line or terminator is odd", () => {
  it("keeps the whole command for a first word that only looks like cat or tee", () => {
    for (const first of [
      "bash",
      "sh",
      "node",
      "FOO=1 cat",
      "env cat",
      "/bin/cat",
      "./cat",
      "tee2",
    ]) {
      const command = `${first} > a.md <<'EOF'\n${body}\nEOF`;
      expect(withoutHeredocBodies(command)).toBe(command);
    }
  });

  it("keeps the whole command when an unquoted terminator lets the body run a substitution", () => {
    for (const run of ["$(rm /elsewhere/b)", "`rm /elsewhere/b`"]) {
      const command = `cat > a.md <<EOF\n${run}\nEOF`;
      expect(withoutHeredocBodies(command)).toBe(command);
    }
  });

  it("keeps the whole command when the opening line continues onto the next, which would hide a redirect", () => {
    const command = "cat <<EOF \\\n> /elsewhere/b\nx\nEOF";
    expect(withoutHeredocBodies(command)).toBe(command);
  });

  it("keeps the whole command when the terminator is partly quoted, so the terminator read is not the shell's", () => {
    const command = 'cat > a.md <<E"O"F\nx\nEOF\nrm /elsewhere/b';
    expect(withoutHeredocBodies(command)).toBe(command);
  });

  it("opens no heredoc at a << inside quotes, so the next line stays a command", () => {
    const quoted = 'echo "<<EOF"\nrm /elsewhere/b\nEOF';
    expect(withoutHeredocBodies(quoted)).toBe(quoted);
  });

  it("opens no heredoc at a here-string, which is one word", () => {
    const herestring = 'cat <<< "a"\nrm /elsewhere/b';
    expect(withoutHeredocBodies(herestring)).toBe(herestring);
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

  it("reads the strings in a comment too, since a comment cannot be told from code hiding in it", () => {
    expect(codeStrings("// read('/etc/hosts')\nok('/x')")).toEqual([
      "/etc/hosts",
      "/x",
    ]);
    expect(codeStrings("/* read('/etc/hosts') */ ok('/x')")).toEqual([
      "/etc/hosts",
      "/x",
    ]);
  });

  it("reads a slash after ++ or -- as division, so the code after it is not hidden in a regex", () => {
    expect(codeStrings("a++ / 2; read('/etc/hosts'); b / 3")).toEqual([
      "/etc/hosts",
    ]);
    expect(codeStrings("a-- / 2; read('/etc/hosts'); b / 3")).toEqual([
      "/etc/hosts",
    ]);
  });

  it("reads a keyword used as a property name as a name, so a slash after it is division", () => {
    expect(codeStrings("a.of / 2; read('/etc/hosts'); b / 3")).toEqual([
      "/etc/hosts",
    ]);
    expect(codeStrings("a.return / 2; read('/etc/hosts'); b / 3")).toEqual([
      "/etc/hosts",
    ]);
  });

  it("keeps an escaped quote inside a literal", () => {
    expect(codeStrings("'it\\'s /a'")).toEqual(["it's /a"]);
  });
});
