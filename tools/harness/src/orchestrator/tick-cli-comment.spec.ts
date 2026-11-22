import { describe, expect, it, vi } from "vitest";
import { TickCli } from "./tick-cli.js";

const REPO = "/repo";

function cli(code: number, stderr = "") {
  const run = vi.fn().mockResolvedValue({ code, stdout: "", stderr });
  return {
    run,
    tick: new TickCli({ run } as never, REPO, {} as never, {
      sessions: "/sessions",
      plans: "/plans",
      checkout: REPO,
    }),
  };
}

describe("TickCli.commentIssue", () => {
  it("posts the body as one comment on the issue through gh, in the checkout", async () => {
    const c = cli(0);

    expect(
      await c.tick.commentIssue(
        20,
        "sender: the main session (orchestrate tick)\nbody",
      ),
    ).toBeUndefined();
    expect(c.run).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "comment",
        "20",
        "--body",
        "sender: the main session (orchestrate tick)\nbody",
      ],
      { cwd: REPO },
    );
  });

  it("returns gh's error text when the comment is refused, so nothing is recorded as posted", async () => {
    const c = cli(1, "HTTP 502\n");

    expect(await c.tick.commentIssue(20, "body")).toBe("HTTP 502");
  });
});
