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

  it("returns a command with no heredoc unchanged", () => {
    expect(shellOutsideBodies("ls -la")).toBe("ls -la");
  });
});
