import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CliDeps, FileSystem } from "../runtime/index.js";
import { parseDefinition, readTier, resolveTier } from "./agent-definition.js";

vi.mock("node:path");

const WRITER = "/repo/.claude/agents/writer.md";
const DEFINITION = [
  "---",
  "name: writer",
  "model: claude-opus-5-5",
  "effort: high",
  "tools: Read, Edit ,Bash",
  "---",
  "You write code.",
].join("\n");

const missing = () =>
  Promise.reject(Object.assign(new Error("no such file"), { code: "ENOENT" }));

/** Deps for the definition reads: a repository at /repo, and a file system whose readFile answers `read`. */
function depsReading(read: (path: string) => Promise<string>) {
  const readFile = vi.fn<FileSystem["readFile"]>(read);
  const root = vi.fn<CliDeps["root"]>(() => Promise.resolve("/repo"));
  // Only what the definition reads; the rest of CliDeps is never read.
  const deps = {
    fs: { readFile } as Pick<FileSystem, "readFile"> as FileSystem,
    root,
  } as unknown as CliDeps;
  return { deps, readFile, root };
}

describe("parseDefinition reads the launch settings from the frontmatter", () => {
  it("reads model, effort and tools, splitting and trimming the tool list", () => {
    expect(parseDefinition(DEFINITION)).toEqual({
      model: "claude-opus-5-5",
      effort: "high",
      tools: ["Read", "Edit", "Bash"],
    });
  });

  it("strips one matching pair of quotes around a value", () => {
    const quoted = "---\nmodel: \"claude-sonnet-5-5\"\neffort: 'low'\n---";
    expect(parseDefinition(quoted)).toEqual({
      model: "claude-sonnet-5-5",
      effort: "low",
    });
  });

  it("omits a setting the frontmatter leaves empty or does not declare", () => {
    expect(parseDefinition("---\nmodel:\neffort: high\n---\n")).toEqual({
      effort: "high",
    });
  });

  it("reads only the frontmatter block, never the body", () => {
    expect(
      parseDefinition("---\neffort: high\n---\nmodel: claude-opus-5-5"),
    ).toEqual({ effort: "high" });
  });

  it("reads nothing from a file with no frontmatter, and never throws", () => {
    expect(parseDefinition("model: claude-opus-5-5\n")).toEqual({});
    expect(parseDefinition("")).toEqual({});
  });
});

describe("readTier reads a role's definition from the agents directory", () => {
  it("reads .claude/agents/<role>.md under the repository root", async () => {
    vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
    const { deps, readFile } = depsReading(() => Promise.resolve(DEFINITION));
    expect(await readTier(deps, "writer")).toEqual({
      model: "claude-opus-5-5",
      effort: "high",
      tools: ["Read", "Edit", "Bash"],
    });
    expect(join).toHaveBeenCalledWith("/repo", ".claude/agents", "writer.md");
    expect(readFile).toHaveBeenCalledWith(WRITER);
  });

  it.each(["../secrets", "Writer", "writer/x", "writer.md", ""])(
    "reads no file and returns nothing for the role %j, which could point outside the agents directory",
    async (role) => {
      const { deps, readFile } = depsReading(() => Promise.resolve(DEFINITION));
      expect(await readTier(deps, role)).toEqual({});
      expect(readFile).not.toHaveBeenCalled();
    },
  );

  it("returns nothing when the role has no definition file", async () => {
    const { deps } = depsReading(missing);
    expect(await readTier(deps, "writer")).toEqual({});
  });

  it("rethrows a read failure that is not a missing file", async () => {
    const denied = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const { deps } = depsReading(() => Promise.reject(denied));
    await expect(readTier(deps, "writer")).rejects.toBe(denied);
  });
});

describe("resolveTier picks the model and effort to launch at", () => {
  it("uses the definition's model and effort when no flag is given", async () => {
    const { deps } = depsReading(() => Promise.resolve(DEFINITION));
    expect(await resolveTier(deps, "writer", {})).toEqual({
      model: "claude-opus-5-5",
      effort: "high",
    });
  });

  it("lets an explicit flag win over the definition, one setting at a time", async () => {
    const { deps } = depsReading(() => Promise.resolve(DEFINITION));
    expect(
      await resolveTier(deps, "writer", { model: "claude-haiku-5-5" }),
    ).toEqual({ model: "claude-haiku-5-5", effort: "high" });
  });

  it("launches from the flags alone when the role has no definition", async () => {
    const { deps } = depsReading(missing);
    expect(
      await resolveTier(deps, "writer", {
        model: "claude-sonnet-5-5",
        effort: "low",
      }),
    ).toEqual({ model: "claude-sonnet-5-5", effort: "low" });
  });

  it("names the missing model and the file to fix when neither flag nor definition gives one", async () => {
    const { deps } = depsReading(missing);
    expect(await resolveTier(deps, "writer", {})).toEqual({
      error:
        "Missing --model, and .claude/agents/writer.md does not declare it. Pass --model or add `model:` to that definition's frontmatter.",
    });
  });

  it("names the missing effort when only the model is declared", async () => {
    const { deps } = depsReading(() =>
      Promise.resolve("---\nmodel: claude-opus-5-5\n---"),
    );
    expect(await resolveTier(deps, "writer", {})).toEqual({
      error:
        "Missing --effort, and .claude/agents/writer.md does not declare it. Pass --effort or add `effort:` to that definition's frontmatter.",
    });
  });
});
