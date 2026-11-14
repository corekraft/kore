import { describe, expect, it } from "vitest";
import { buildBrief } from "./brief.js";

describe("buildBrief", () => {
  it("gives every brief a review follow-up section with the four rules and the notify broadcast, between the name and the finish instructions", () => {
    expect(
      buildBrief({
        task: "Do the thing.",
        name: "image-trust-writer",
        callerPane: "w3:p1",
      }),
    ).toBe(
      [
        "Do the thing.",
        "",
        "You are image-trust-writer; your session name is image-trust-writer.",
        "",
        "Review follow-up:",
        "- After each fix push, wait for CI to pass before the next change.",
        "- Never merge; only the judge merges.",
        "- Broadcast each new head SHA with `node skills/bin/harness.mjs session notify w3:p1 --outcome done`; the notify line carries only the outcome, so put the SHA in your printed summary.",
        "- While a live proof is pinned to a head, change no code, because a change invalidates that proof.",
        "",
        "When you finish, broadcast to pane `w3:p1`. Print your summary and a final line with the word RESULT, a colon, then done or blocked. Then, as your very last action, run this one line with the outcome word (done or blocked) in place of <done|blocked>; the command fills in your own name and pane, and must carry no secrets or output beyond the outcome word:",
        "",
        "node skills/bin/harness.mjs session notify w3:p1 --outcome <done|blocked>",
      ].join("\n"),
    );
  });
});
