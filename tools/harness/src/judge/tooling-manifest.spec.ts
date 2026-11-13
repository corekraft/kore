import { describe, expect, it } from "vitest";
import { isTooling } from "./tooling.js";
import { add, ctx, del, file } from "./tooling.fixtures.js";

describe("isTooling: tools/kore/package.json", () => {
  const path = "tools/kore/package.json";

  it("is tooling when a script or devDependency changes", () => {
    expect(
      isTooling(
        file(path, [
          [
            ctx('  "devDependencies": {'),
            del('    "vitest": "4.0.0",'),
            add('    "vitest": "4.0.1",'),
            ctx("  },"),
          ],
        ]),
      ),
    ).toBe(true);
    expect(
      isTooling(
        file(path, [[ctx('  "scripts": {'), add('    "x": "y",'), ctx("  }")]]),
      ),
    ).toBe(true);
  });
});

describe("isTooling: tools/kore/package.json, product changes", () => {
  const path = "tools/kore/package.json";

  it.each([
    ['"type": "module",'],
    ['"version": "1.2.3",'],
    ['"dependencies": { "left-pad": "1.0.0" },'],
    ['"bin": "dist/kore.js",'],
  ])("is product when a top-level key line %s is added", (line) => {
    expect(
      isTooling(
        file(path, [
          [ctx('  "devDependencies": {'), ctx("  },"), add(`  ${line}`)],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when runtime dependencies change", () => {
    expect(
      isTooling(
        file(path, [
          [
            ctx('  "dependencies": {'),
            add('    "left-pad": "1.0.0"'),
            ctx("  }"),
          ],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when a package moves from dependencies to devDependencies", () => {
    expect(
      isTooling(
        file(path, [
          [
            ctx('  "dependencies": {'),
            del('    "yaml": "2.0.0",'),
            ctx("  },"),
          ],
          [ctx('  "devDependencies": {'), add('    "yaml": "2.0.0",')],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when a line removed from runtime dependencies is the only change", () => {
    expect(
      isTooling(
        file(path, [[ctx('  "dependencies": {'), del('    "yaml": "2.0.0",')]]),
      ),
    ).toBe(false);
  });

  it("is product when a hunk with no header in view follows a tooling hunk", () => {
    expect(
      isTooling(
        file(path, [
          [ctx('  "scripts": {'), add('    "x": "y",')],
          [add('    "left-pad": "1.0.0",')],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when a changed line has no section header in view", () => {
    expect(isTooling(file(path, [[add('    "vitest": "4.0.1",')]]))).toBe(
      false,
    );
    expect(isTooling(file(path, [[del('    "vitest": "4.0.1",')]]))).toBe(
      false,
    );
  });
});

describe("isTooling: tools/kore/package.json, no hunks", () => {
  it("is product when the diff has no hunks, as for a mode change or a binary diff", () => {
    expect(isTooling(file("tools/kore/package.json"))).toBe(false);
  });
});
