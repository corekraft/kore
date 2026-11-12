import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { INDEX, NEW, harness } from "./idea-support.js";

const PATH = "docs/ideas/0001-cache-the-probe-results.md";
const URL = "https://github.com/corekraft/kore/issues/300";

async function setup(withIssue?: string) {
  const files = { "docs/index.md": INDEX };
  const h = harness(files);
  await run(
    [...NEW, ...(withIssue === undefined ? [] : ["--issue", withIssue])],
    h.deps,
  );
  return h;
}

const lastJson = (h: Awaited<ReturnType<typeof setup>>) =>
  JSON.parse(h.out().trim().split("\n").at(-1) ?? "") as unknown;

function writes(h: Awaited<ReturnType<typeof setup>>) {
  return h.runner.calls.filter(
    (c) =>
      c.command === "gh" && (c.args[1] === "create" || c.args[1] === "edit"),
  );
}

function fakeGh(h: Awaited<ReturnType<typeof setup>>) {
  // Swap in a stateful runner behaviour: create stores the issue, view returns it.
  let issue: { title: string; body: string } | undefined;
  h.runner.run = (command, args, options) => {
    h.runner.calls.push({ command, args, options });
    const verb = args[1];
    if (command !== "gh") {
      return Promise.resolve({ stdout: "", stderr: "", code: 0 });
    }
    const flag = (name: string) => args[args.indexOf(name) + 1];
    if (verb === "create") {
      issue = { title: flag("--title") ?? "", body: options?.input ?? "" };
      return Promise.resolve({ stdout: `${URL}\n`, stderr: "", code: 0 });
    }
    if (verb === "edit") {
      issue = { title: flag("--title") ?? "", body: options?.input ?? "" };
      return Promise.resolve({ stdout: URL, stderr: "", code: 0 });
    }
    if (issue === undefined) {
      return Promise.resolve({
        stdout: "",
        stderr:
          "GraphQL: Could not resolve to an Issue with the number of 300.",
        code: 1,
      });
    }
    return Promise.resolve({
      stdout: JSON.stringify(issue),
      stderr: "",
      code: 0,
    });
  };
  return {
    get issue() {
      return issue;
    },
    set issue(value) {
      issue = value;
    },
  };
}

describe("harness idea sync", () => {
  it("creates the issue on first sync and records its link in the idea", async () => {
    const h = await setup();
    fakeGh(h);
    expect(await run(["idea", "sync", "--idea", "1", "--json"], h.deps)).toBe(
      0,
    );
    const [create] = writes(h);
    expect(create?.args.slice(0, 2)).toEqual(["issue", "create"]);
    expect(create?.args).toContain("--title");
    expect(create?.options?.input).toContain("## Hypothesis");
    expect(create?.options?.input).toContain("Caching probes cuts up time.");
    expect(h.get(PATH)).toContain(`issue: ${URL}\n`);
    expect(lastJson(h)).toMatchObject({ action: "created", issue: URL });
  });

  it("issues no gh write when the markdown is unchanged", async () => {
    const h = await setup();
    fakeGh(h);
    await run(["idea", "sync", "--idea", "1"], h.deps);
    const before = writes(h).length;
    expect(await run(["idea", "sync", "--idea", "1", "--json"], h.deps)).toBe(
      0,
    );
    expect(writes(h)).toHaveLength(before);
    expect(lastJson(h)).toMatchObject({ action: "unchanged" });
  });

  it("updates the body when the markdown changed", async () => {
    const h = await setup();
    fakeGh(h);
    await run(["idea", "sync", "--idea", "1"], h.deps);
    h.set(PATH, (h.get(PATH) ?? "").replace("cuts up time", "halves up time"));
    await run(["idea", "sync", "--idea", "1"], h.deps);
    const calls = writes(h);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.slice(0, 3)).toEqual(["issue", "edit", "300"]);
    expect(calls[1]?.options?.input).toContain("halves up time");
  });

  it("overwrites a hand-edited body and never reads it back into the file", async () => {
    const h = await setup();
    const gh = fakeGh(h);
    await run(["idea", "sync", "--idea", "1"], h.deps);
    const file = h.get(PATH);
    gh.issue = {
      title: gh.issue?.title ?? "",
      body: "HAND EDITED hypothesis: nope",
    };
    await run(["idea", "sync", "--idea", "1"], h.deps);
    expect(writes(h)).toHaveLength(2);
    expect(gh.issue?.body).not.toContain("HAND EDITED");
    expect(h.get(PATH)).toBe(file);
  });

  it("recreates the issue from the file when it was lost", async () => {
    const h = await setup("300");
    const gh = fakeGh(h);
    expect(gh.issue).toBeUndefined();
    expect(await run(["idea", "sync", "--idea", "1"], h.deps)).toBe(0);
    expect(writes(h)[0]?.args.slice(0, 2)).toEqual(["issue", "create"]);
    expect(h.get(PATH)).toContain(`issue: ${URL}\n`);
    expect(h.get(PATH)).not.toContain("issue: 300\n");
  });
});

describe("harness idea sync safety", () => {
  it("never touches labels or assignees", async () => {
    const h = await setup();
    fakeGh(h);
    await run(["idea", "sync", "--idea", "1"], h.deps);
    h.set(PATH, (h.get(PATH) ?? "").replace("cuts", "trims"));
    await run(["idea", "sync", "--idea", "1"], h.deps);
    const flags = h.runner.calls.flatMap((c) => [...c.args]).join(" ");
    expect(flags).not.toMatch(/label|assignee|--add-|--remove-/);
  });

  it("fails with the gh message when the view fails for another reason", async () => {
    const h = await setup("300");
    h.runner.run = (command, args, options) => {
      h.runner.calls.push({ command, args, options });
      return Promise.resolve({
        stdout: "",
        stderr: "gh: not logged in",
        code: 4,
      });
    };
    expect(await run(["idea", "sync", "--idea", "1"], h.deps)).toBe(1);
    expect(h.err()).toContain("not logged in");
    expect(writes(h)).toHaveLength(0);
  });

  it("fails clearly when --idea is missing or unknown", async () => {
    const h = await setup();
    expect(await run(["idea", "sync"], h.deps)).toBe(1);
    expect(h.err()).toContain("--idea");
    expect(await run(["idea", "sync", "--idea", "9"], h.deps)).toBe(1);
  });

  it("does not recreate the issue when gh cannot resolve the repository", async () => {
    const h = await setup("300");
    h.runner.run = (command, args, options) => {
      h.runner.calls.push({ command, args, options });
      return Promise.resolve({
        stdout: "",
        stderr:
          "GraphQL: Could not resolve to a Repository with the name 'x/y'.",
        code: 1,
      });
    };
    expect(await run(["idea", "sync", "--idea", "1"], h.deps)).toBe(1);
    expect(writes(h)).toHaveLength(0);
  });

  it("recreates a lost issue in the repository its recorded link names", async () => {
    const link = "https://github.com/other/repo/issues/5";
    const h = await setup(link);
    fakeGh(h);
    await run(["idea", "sync", "--idea", "1"], h.deps);
    expect(writes(h)[0]?.args).toEqual(
      expect.arrayContaining(["--repo", "other/repo"]),
    );
  });

  it("fails when gh create does not print an issue link", async () => {
    const h = await setup();
    expect(await run(["idea", "sync", "--idea", "1"], h.deps)).toBe(1);
    expect(h.err()).toContain("issue link");
    expect(h.get(PATH)).not.toContain("issue:");
  });
});
