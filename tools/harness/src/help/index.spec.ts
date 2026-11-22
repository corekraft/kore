import { describe, expect, it } from "vitest";
import * as help from "./index.js";

describe("help barrel", () => {
  it("exposes the guides, the views, the two renderers and the registry check, and nothing else", () => {
    expect(Object.keys(help).sort()).toEqual([
      "commandView",
      "domainGuides",
      "domainView",
      "registryProblems",
      "renderJson",
      "renderText",
      "rootGuide",
      "rootView",
    ]);
  });
});
