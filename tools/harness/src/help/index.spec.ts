import { describe, expect, it } from "vitest";
import * as help from "./index.js";

describe("help barrel", () => {
  it("exposes the guides, the views, the two renderers, the registry check and the document reader, and nothing else", () => {
    expect(Object.keys(help).sort()).toEqual([
      "commandView",
      "domainGuides",
      "domainView",
      "harnessMentions",
      "registryProblems",
      "renderJson",
      "renderText",
      "rootGuide",
      "rootView",
      "undocumented",
    ]);
  });
});
