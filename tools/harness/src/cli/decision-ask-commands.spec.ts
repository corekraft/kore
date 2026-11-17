import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  askOwner,
  DecisionError,
  type Asked,
  type AskPorts,
} from "../decision/index.js";
import { IdeaRepository, issueTarget } from "../idea/index.js";
import { contextWith, fakeLedger } from "./command-support.js";
import { askCommands } from "./decision-ask-commands.js";
import { openLedger } from "./ledger-commands.js";

vi.mock("../decision/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../decision/index.js")>()),
  askOwner: vi.fn(),
  decisionFlagOn: vi.fn(),
}));
vi.mock("../idea/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../idea/index.js")>()),
  IdeaRepository: vi.fn(),
  issueTarget: vi.fn(),
}));
vi.mock("./ledger-commands.js");

const ROOT = "/repo";
const FLAGS = {
  idea: "8",
  category: "credentials",
  question: "Which token?",
  action: "Store it in the overlay.",
};
const ASKED: Asked = {
  idea: "0008",
  category: "credentials",
  issue: "https://github.com/corekraft/kore/issues/878",
  commentUrl: "https://github.com/corekraft/kore/issues/878#c2",
  signal: "reserved-category",
};

function fakeDeps() {
  return {
    root: vi.fn(() => Promise.resolve(ROOT)),
    runner: {
      run: vi.fn(() => Promise.resolve({ code: 0, stdout: "u", stderr: "" })),
    },
    clock: {
      now: vi.fn(() => new Date("2026-11-17T10:00:00Z")),
      sleep: vi.fn(() => Promise.resolve()),
    },
    fs: { readFile: vi.fn<(path: string) => Promise<string>>() },
    cwd: "/work",
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
    env: {},
  };
}

function missing(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
}

function context(options: Record<string, string | boolean>, json = false) {
  const deps = fakeDeps();
  return { ctx: contextWith(deps, options, json), deps };
}

/** The ports the command handed to askOwner. */
function portsOf(): AskPorts {
  return vi.mocked(askOwner).mock.calls[0]?.[0] as AskPorts;
}

const ask = askCommands["ask"];

beforeEach(() => {
  vi.mocked(askOwner).mockResolvedValue(ASKED);
  vi.mocked(openLedger).mockResolvedValue({ ledger: fakeLedger().ledger });
  vi.mocked(IdeaRepository).mockImplementation(
    () =>
      ({
        get: vi.fn(() => Promise.resolve({ number: "0008", issue: "878" })),
      }) as unknown as IdeaRepository,
  );
  vi.mocked(issueTarget).mockResolvedValue({
    number: "878",
    repo: "corekraft/kore",
  });
});

describe("decision ask", () => {
  it("asks the owner from the flags and says where the question was posted", async () => {
    const { ctx, deps } = context(FLAGS);

    expect(await ask?.run(ctx)).toBe(0);

    expect(askOwner).toHaveBeenCalledWith(expect.anything(), {
      idea: "8",
      category: "credentials",
      question: "Which token?",
      action: "Store it in the overlay.",
    });
    expect(deps.stdout).toHaveBeenCalledWith(
      "Asked the owner about idea 0008: https://github.com/corekraft/kore/issues/878#c2\n",
    );
  });

  it("prints the asked question as one JSON object under --json", async () => {
    const { ctx, deps } = context(FLAGS, true);

    await ask?.run(ctx);

    expect(deps.stdout).toHaveBeenCalledWith(`${JSON.stringify(ASKED)}\n`);
  });

  it("names the usage and exits 2 when --idea is missing, asking nobody", async () => {
    const { ctx, deps } = context({ ...FLAGS, idea: "" });

    expect(await ask?.run(ctx)).toBe(2);

    expect(askOwner).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledWith(
      expect.stringContaining("Missing --idea; run `harness decision ask"),
    );
  });

  it("prints a refusal, and exits 1, when the question is not the owner's to answer", async () => {
    vi.mocked(askOwner).mockRejectedValue(
      new DecisionError("The question is the advisor's, so it is not posted."),
    );
    const { ctx, deps } = context(FLAGS);

    expect(await ask?.run(ctx)).toBe(1);

    expect(deps.stderr).toHaveBeenCalledWith(
      "The question is the advisor's, so it is not posted.\n",
    );
  });
});

describe("decision ask takes the question and action from files", () => {
  it("asks the owner with the text the files hold, the same as the inline flags give", async () => {
    const { ctx, deps } = context({
      idea: "8",
      category: "credentials",
      "question-file": "q.md",
      "action-file": "a.md",
    });
    vi.mocked(deps.fs.readFile).mockImplementation((path) =>
      Promise.resolve(
        path === "/work/q.md"
          ? "  Which token?\n"
          : "Store it in the overlay.\n",
      ),
    );

    expect(await ask?.run(ctx)).toBe(0);

    expect(askOwner).toHaveBeenCalledWith(expect.anything(), {
      idea: "8",
      category: "credentials",
      question: "Which token?",
      action: "Store it in the overlay.",
    });
  });

  it("refuses --question with --question-file, naming both, and asks nobody", async () => {
    const { ctx, deps } = context({
      ...FLAGS,
      "question-file": "q.md",
    });

    expect(await ask?.run(ctx)).toBe(1);

    expect(askOwner).not.toHaveBeenCalled();
    expect(deps.fs.readFile).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledWith(
      "--question and --question-file together are refused. Pass the text with --question <text> or the path with --question-file <path>, not both.\n",
    );
  });

  it("refuses a missing --action-file with its path and the fix, and asks nobody", async () => {
    const { ctx, deps } = context({
      idea: "8",
      category: "credentials",
      question: "Which token?",
      "action-file": "a.md",
    });
    vi.mocked(deps.fs.readFile).mockRejectedValue(missing("/work/a.md"));

    expect(await ask?.run(ctx)).toBe(1);

    expect(askOwner).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledWith(
      "--action-file a.md does not exist. Write the action to that path with the Write tool, then rerun `harness decision ask`.\n",
    );
  });

  it("refuses an empty --question-file with its path and the fix, and asks nobody", async () => {
    const { ctx, deps } = context({
      idea: "8",
      category: "credentials",
      "question-file": "q.md",
      action: "Store it in the overlay.",
    });
    vi.mocked(deps.fs.readFile).mockResolvedValue("  \n");

    expect(await ask?.run(ctx)).toBe(1);

    expect(askOwner).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledWith(
      "--question-file q.md is empty. Write the question into it with the Write tool, then rerun `harness decision ask`.\n",
    );
  });
});

describe("decision ask ports", () => {
  it("labels the issue, then posts the comment, on the idea's repository", async () => {
    const { ctx, deps } = context(FLAGS);
    await ask?.run(ctx);
    const ports = portsOf();

    await ports.label(
      { idea: "0008", number: "878", repo: "corekraft/kore" },
      "needs-info",
    );
    await ports.post(
      { idea: "0008", number: "878", repo: "corekraft/kore" },
      "BODY",
    );

    expect(deps.runner.run).toHaveBeenNthCalledWith(
      1,
      "gh",
      [
        "issue",
        "edit",
        "878",
        "--repo",
        "corekraft/kore",
        "--add-label",
        "needs-info",
      ],
      { cwd: ROOT },
    );
    expect(deps.runner.run).toHaveBeenNthCalledWith(
      2,
      "gh",
      ["issue", "comment", "878", "--repo", "corekraft/kore", "--body", "BODY"],
      { cwd: ROOT },
    );
  });

  it("names the failing gh label call and the fix when the label cannot be added", async () => {
    const { ctx, deps } = context(FLAGS);
    await ask?.run(ctx);
    vi.mocked(deps.runner.run).mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "no such label",
    });

    await expect(
      portsOf().label(
        { idea: "0008", number: "878", repo: "corekraft/kore" },
        "needs-info",
      ),
    ).rejects.toThrow(
      "gh issue edit failed for issue #878: no such label. Check `gh auth status`, then rerun the same command.",
    );
  });
});

describe("decision ask ledger", () => {
  it("records decision.routed as a claude event with the posting pane and the issue number, so the stall check can see it (#854)", async () => {
    const fake = fakeLedger();
    vi.mocked(openLedger).mockResolvedValue({ ledger: fake.ledger });
    const { ctx } = context(FLAGS);
    await ask?.run(ctx);

    await portsOf().record({
      idea: "0008",
      label: "credentials",
      route: "owner",
      signal: "reserved-category",
      number: 878,
      pane: "w3:p1",
    });

    expect(fake.write).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "claude",
        kind: "decision.routed",
        route: "owner",
        number: 878,
        pane: "w3:p1",
      }),
    );
  });
});
