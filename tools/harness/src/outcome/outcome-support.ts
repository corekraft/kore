import { run } from "../cli/index.js";
import { harness, NEW } from "../idea/idea-support.js";

export const PATH = "docs/ideas/0001-cache-the-probe-results.md";
export const LEDGER = "/repo/.kore/state/ledger.jsonl";
export const ISSUE = "https://github.com/corekraft/kore/issues/300";

export type Harness = ReturnType<typeof harness>;

export interface FakeIssue {
  state: "OPEN" | "CLOSED";
  labels: string[];
  comments: string[];
}

/** A stateful gh: answers repo and issue views from `issue`, and applies comment, edit and close calls. */
export function fakeGh(h: Harness, issue: FakeIssue) {
  h.runner.run = (command, args, options) => {
    h.runner.calls.push({ command, args, options });
    const ok = (stdout = "") =>
      Promise.resolve({ stdout, stderr: "", code: 0 });
    if (command !== "gh") {
      return ok();
    }
    const values = (flag: string) =>
      args.flatMap((a, i) => (a === flag ? [args[i + 1] ?? ""] : []));
    if (args[0] === "repo") {
      return ok(JSON.stringify({ nameWithOwner: "corekraft/kore" }));
    }
    switch (args[1]) {
      case "view":
        return ok(
          JSON.stringify({
            state: issue.state,
            labels: issue.labels.map((name) => ({ name })),
            comments: issue.comments.map((body) => ({ body })),
          }),
        );
      case "comment":
        issue.comments.push(options?.input ?? "");
        return ok();
      case "edit":
        issue.labels = [
          ...issue.labels.filter((l) => !values("--remove-label").includes(l)),
          ...values("--add-label"),
        ];
        return ok();
      case "close":
        issue.state = "CLOSED";
        return ok();
      default:
        return ok();
    }
  };
}

/** gh calls that change the issue. */
export function ghWrites(h: Harness) {
  return h.runner.calls.filter(
    (c) =>
      c.command === "gh" &&
      c.args[0] === "issue" &&
      c.args[1] !== undefined &&
      ["comment", "edit", "close", "create"].includes(c.args[1]),
  );
}

/** A repository with idea 0001 linked to issue 300 and a stateful open issue. */
export async function linked(
  overrides: Partial<FakeIssue> = {},
): Promise<{ h: Harness; issue: FakeIssue }> {
  const h = harness();
  await run([...NEW, "--issue", "300"], h.deps);
  const issue: FakeIssue = {
    state: "OPEN",
    labels: ["ready-for-agent"],
    comments: [],
    ...overrides,
  };
  fakeGh(h, issue);
  return { h, issue };
}

export function record(extra: string[] = []): string[] {
  return [
    "outcome",
    "record",
    "--idea",
    "1",
    "--kind",
    "experiment",
    "--source",
    "comparison",
    "--evidence",
    "kore local up p50 41s before, 29s after, ledger runs 12 to 40",
    "--result",
    "confirmed",
    "--summary",
    "Up time fell from 41s to 29s.",
    "--ledger",
    LEDGER,
    ...extra,
  ];
}

/** Replaces the value following `flag` in an argv. */
export function withFlag(
  argv: string[],
  flag: string,
  value: string,
): string[] {
  const out = [...argv];
  out[out.indexOf(flag) + 1] = value;
  return out;
}
