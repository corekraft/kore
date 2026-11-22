import { describe, expect, it } from "vitest";
import { fakeDeps } from "./deps-support.js";
import { agentsJson, parseAgentEntry, readRoleAgent } from "./exec-agent.js";

const MAIN = "/repo";
const WRITER = `---
name: writer
description: "Changes files: one piece of work, and opens a PR."
model: claude-haiku-5-5
effort: medium
tools: Bash, Edit, Glob, Read
---

You change files.
Then report.
`;

describe("parseAgentEntry: the frontmatter and the body", () => {
  it("keeps a quoted description whole, with its colon and comma, and the body as the prompt", () => {
    expect(parseAgentEntry(WRITER)).toStrictEqual({
      description: "Changes files: one piece of work, and opens a PR.",
      prompt: "You change files.\nThen report.",
      tools: ["Bash", "Edit", "Glob", "Read"],
      model: "claude-haiku-5-5",
      effort: "medium",
    });
  });

  it("omits the model, effort and tools a definition does not declare", () => {
    expect(
      parseAgentEntry("---\ndescription: Reads.\n---\nYou read.\n"),
    ).toStrictEqual({
      description: "Reads.",
      prompt: "You read.",
    });
  });

  it("keeps regex metacharacters in a value as plain text, not as a pattern", () => {
    expect(
      parseAgentEntry(
        '---\ndescription: "Matches (a|b)+ [x] $ ^end.* and {n}+?"\ntools: Bash, Edit\n---\nYou read.\n',
      ),
    ).toStrictEqual({
      description: "Matches (a|b)+ [x] $ ^end.* and {n}+?",
      prompt: "You read.",
      tools: ["Bash", "Edit"],
    });
  });

  it("refuses a definition with no description, so no entry is built", () => {
    expect(parseAgentEntry("---\nmodel: m\n---\nYou read.\n")).toBeUndefined();
  });

  it("refuses a file with no frontmatter at all", () => {
    expect(parseAgentEntry("You read.\n")).toBeUndefined();
  });
});

describe("agentsJson: one entry keyed by the role", () => {
  it("builds the exact JSON object claude's --agents takes", () => {
    expect(
      agentsJson("reader", { description: "Reads.", prompt: "You read." }),
    ).toBe('{"reader":{"description":"Reads.","prompt":"You read."}}');
  });
});

describe("readRoleAgent: the role's definition from the main checkout", () => {
  it("reads only the main checkout's agents directory and returns the --agents JSON for the role", async () => {
    const deps = fakeDeps();
    deps.fs.readFile.mockResolvedValue(WRITER);

    const result = await readRoleAgent(deps, MAIN, "writer");

    expect(deps.fs.readFile).toHaveBeenCalledTimes(1);
    expect(deps.fs.readFile).toHaveBeenCalledWith(
      "/repo/.claude/agents/writer.md",
    );
    expect(result).toStrictEqual({
      ok: true,
      json: '{"writer":{"description":"Changes files: one piece of work, and opens a PR.","prompt":"You change files.\\nThen report.","tools":["Bash","Edit","Glob","Read"],"model":"claude-haiku-5-5","effort":"medium"}}',
    });
  });

  it("refuses a role with no file under the main checkout, naming the role and the file, and says nothing was started", async () => {
    const deps = fakeDeps();
    deps.fs.readFile.mockRejectedValue(
      Object.assign(new Error("no such file"), { code: "ENOENT" }),
    );

    const result = await readRoleAgent(deps, MAIN, "reader");

    expect(result).toStrictEqual({
      ok: false,
      message:
        "The reader role has no agent definition: /repo/.claude/agents/reader.md was not found in the main checkout /repo. Add it there, then rerun. Nothing was started.\n",
    });
  });

  it("refuses a definition with no description, naming the role and the file", async () => {
    const deps = fakeDeps();
    deps.fs.readFile.mockResolvedValue("---\nmodel: m\n---\nYou read.\n");

    const result = await readRoleAgent(deps, MAIN, "reader");

    expect(result).toStrictEqual({
      ok: false,
      message:
        "/repo/.claude/agents/reader.md has no description in its frontmatter, which claude needs to start the reader role. Add a description: line there, then rerun. Nothing was started.\n",
    });
  });

  it("refuses a role name that could point outside the agents directory, and reads no file", async () => {
    const deps = fakeDeps();

    const result = await readRoleAgent(deps, MAIN, "../../etc/passwd");

    expect(deps.fs.readFile).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      ok: false,
      message:
        "../../etc/passwd is not a role name: session exec reads the role's definition from .claude/agents/<role>.md, so a role is lowercase letters, digits and hyphens. Rerun with a defined role. Nothing was started.\n",
    });
  });

  it("rethrows a read error other than a missing file", async () => {
    const deps = fakeDeps();
    const denied = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    deps.fs.readFile.mockRejectedValue(denied);

    await expect(readRoleAgent(deps, MAIN, "writer")).rejects.toBe(denied);
  });
});
