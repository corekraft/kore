import { describe, expect, it } from "vitest";
import type { RootView } from "./view.js";
import { renderJson } from "./render-json.js";

const root: RootView = {
  level: "root",
  what: "The harness runs the delivery loop.",
  domains: [{ name: "plan", purpose: "Reads and edits the plan files." }],
  flows: [],
  deeper: "Run harness <domain> --help.",
};

describe("the JSON renderer", () => {
  it("prints the help structure as one JSON object on one line, with a newline", () => {
    expect(renderJson(root)).toBe(
      '{"level":"root","what":"The harness runs the delivery loop.","domains":[{"name":"plan","purpose":"Reads and edits the plan files."}],"flows":[],"deeper":"Run harness <domain> --help."}\n',
    );
  });

  it("gives back the same object the prose was built from, so an agent reads the same facts", () => {
    expect(JSON.parse(renderJson(root))).toEqual(root);
  });
});
