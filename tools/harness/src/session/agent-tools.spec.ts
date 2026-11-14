import { describe, expect, it, vi } from "vitest";
import { parseDefinition } from "./agent-definition.js";
import { undeclaredTools } from "./agent-tools.js";

vi.mock("./agent-definition.js");

function declaring(tools: string[] | undefined) {
  vi.mocked(parseDefinition).mockReturnValue(
    tools === undefined ? {} : { tools },
  );
}

const DEFINITION = (body: string) => `---\ntools: x\n---\n${body}`;

describe("undeclaredTools finds tools a body names that its tools line omits", () => {
  it("names each missing tool in the order the body mentions it", () => {
    declaring(["Bash"]);
    expect(
      undeclaredTools(
        DEFINITION("Load `Monitor` through ToolSearch, then TaskStop it."),
      ),
    ).toEqual(["Monitor", "ToolSearch", "TaskStop"]);
  });

  it("names nothing when every mentioned tool is declared", () => {
    declaring(["Bash", "Skill"]);
    expect(undeclaredTools(DEFINITION("Run `Bash`; load a Skill."))).toEqual(
      [],
    );
  });

  it("ignores an ordinary word that is also a tool name unless backticked", () => {
    declaring(["Bash"]);
    expect(
      undeclaredTools(DEFINITION("Read AGENTS.md. Edit nothing.")),
    ).toEqual([]);
    expect(undeclaredTools(DEFINITION("Use `Read` first."))).toEqual(["Read"]);
  });

  it("does not read the frontmatter as body", () => {
    declaring(["Bash"]);
    expect(undeclaredTools("---\ntools: Monitor\n---\nNo tools here.")).toEqual(
      [],
    );
  });

  it("names nothing for a definition without a tools line, which inherits every tool", () => {
    declaring(undefined);
    expect(undeclaredTools(DEFINITION("Use Monitor."))).toEqual([]);
  });
});
