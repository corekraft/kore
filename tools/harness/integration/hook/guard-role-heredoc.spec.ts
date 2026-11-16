import { describe, it } from "vitest";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const bash = (role: string, command: string) =>
  decide({ agent_type: role, tool_name: "Bash", tool_input: { command } });

describe("role-worktree: heredoc bodies and node -e regex literals are text, not paths", () => {
  it("allows a heredoc that writes inside the worktree, whose body names paths outside it", async () => {
    allowed(
      await bash(
        "writer",
        "cat > notes.md <<'EOF'\nSee /elsewhere/kore/a.ts and run cp a /elsewhere/b\nEOF",
      ),
    );
    allowed(
      await bash(
        "writer",
        "cat > notes.md <<-EOF\n\tcd ../../x && rm /elsewhere/b\n\tEOF\nmv notes.md docs.md",
      ),
    );
  });

  it("still refuses a heredoc whose redirect, or whose body a shell runs, reaches outside", async () => {
    blocked(
      await bash("writer", "cat > /elsewhere/b <<'EOF'\nx\nEOF"),
      "role-worktree",
    );
    blocked(
      await bash("writer", "bash <<'EOF'\nrm /elsewhere/b\nEOF"),
      "role-worktree",
    );
    blocked(
      await bash("writer", "cat <<'EOF' | sh\nrm /elsewhere/b\nEOF"),
      "role-worktree",
    );
  });

  it("does not take a quoted << for a heredoc, so the line after it is still a command", async () => {
    blocked(
      await bash("writer", 'echo "<<EOF"\nrm /elsewhere/b\nEOF'),
      "role-worktree",
    );
  });

  it("allows a node -e regex literal, even one that names an outside path", async () => {
    allowed(
      await bash(
        "writer",
        `node -e "const re=/restrict|Pattern/i; console.log(re.test('abc'))"`,
      ),
    );
    allowed(
      await bash(
        "writer",
        `node -e "console.log(/\\/elsewhere\\/kore/.test('x'))"`,
      ),
    );
  });

  it("refuses a node -e read of a path outside the worktree", async () => {
    blocked(
      await bash(
        "writer",
        `node -e "console.log(require('fs').readFileSync('/elsewhere/kore/a.ts','utf8'))"`,
      ),
      "role-worktree",
    );
    blocked(
      await bash(
        "writer",
        `node -e "require('fs').readFileSync('../../../secret')"`,
      ),
      "role-worktree",
    );
  });
});
