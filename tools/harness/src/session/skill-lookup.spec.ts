import { describe, expect, it } from "vitest";
import { extractPaths, skillsForPaths } from "./skill-lookup.js";

describe("skillsForPaths", () => {
  it.each([
    ["tools/kore/src/cli/local.ts", "add-command"],
    ["infra/policies/image/policy.rego", "add-policy"],
    [".mise.toml", "pin-upgrade"],
    ["infra/catalog/versions.yaml", "pin-upgrade"],
    ["infra/catalog/components.yaml", "pin-upgrade"],
    ["infra/charts/kore-rbac/Chart.yaml", "pin-upgrade"],
    ["docs/decisions/0101-x.md", "write-adr"],
  ])("maps %s to %s, as the writer.md table did", (path, skill) => {
    expect(skillsForPaths([path])).toEqual([skill]);
  });

  it("returns no skill when no path is given", () => {
    expect(skillsForPaths([])).toEqual([]);
  });

  it("returns no skill for a path no area covers", () => {
    expect(skillsForPaths(["README.md"])).toEqual([]);
  });

  it("lists every skill when paths come from two areas, once each, in table order", () => {
    expect(
      skillsForPaths([
        "infra/charts/a/values.yaml",
        "tools/kore/src/cli/a.ts",
        ".mise.toml",
      ]),
    ).toEqual(["add-command", "pin-upgrade"]);
  });

  it("does not match a sibling directory that only shares a prefix", () => {
    expect(skillsForPaths(["infra/policies-old/a.rego"])).toEqual([]);
  });
});

describe("extractPaths", () => {
  it("finds paths named in prose and backticks, without trailing punctuation", () => {
    expect(
      extractPaths("Edit `tools/kore/src/cli/a.ts`, then .mise.toml."),
    ).toEqual(["tools/kore/src/cli/a.ts", ".mise.toml"]);
  });

  it("returns nothing for text with no path", () => {
    expect(extractPaths("Do the thing.")).toEqual([]);
  });
});
