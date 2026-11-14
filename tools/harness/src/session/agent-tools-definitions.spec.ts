import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { undeclaredTools } from "./agent-tools.js";

const AGENTS = join(import.meta.dirname, "../../../../.claude/agents");

describe("every agent definition", () => {
  it.each(readdirSync(AGENTS).filter((file) => file.endsWith(".md")))(
    "%s sends the agent only to tools its tools line grants",
    (file) => {
      expect(undeclaredTools(readFileSync(join(AGENTS, file), "utf8"))).toEqual(
        [],
      );
    },
  );
});
