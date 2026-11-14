import { describe, expect, it } from "vitest";
import { isTooling } from "./tooling.js";
import { add, ctx, del, file } from "./tooling.fixtures.js";

describe("isTooling: tools/kore/package-lock.json", () => {
  const path = "tools/kore/package-lock.json";
  const entry = (name: string) => ctx(`    "node_modules/${name}": {`);

  it("is tooling when every changed package entry is dev only", () => {
    expect(
      isTooling(
        file(path, [
          [
            entry("vitest"),
            add('      "version": "4.0.1",'),
            ctx('      "dev": true,'),
          ],
        ]),
      ),
    ).toBe(true);
  });

  it("is tooling for a dev package added whole", () => {
    expect(
      isTooling(
        file(path, [
          [
            add('    "node_modules/vitest": {'),
            add('      "version": "4.0.1",'),
            add('      "dev": true,'),
            add("    },"),
          ],
        ]),
      ),
    ).toBe(true);
  });

  it("is tooling when only the root entry's devDependencies change", () => {
    expect(
      isTooling(
        file(path, [
          [
            ctx('    "": {'),
            ctx('      "devDependencies": {'),
            del('        "vitest": "4.0.0",'),
            add('        "vitest": "4.0.1",'),
          ],
        ]),
      ),
    ).toBe(true);
  });
});

describe("isTooling: tools/kore/package-lock.json, product changes", () => {
  const path = "tools/kore/package-lock.json";
  const entry = (name: string) => ctx(`    "node_modules/${name}": {`);

  it("is product when the root entry's runtime dependencies change", () => {
    expect(
      isTooling(
        file(path, [
          [
            ctx('    "": {'),
            ctx('      "dependencies": {'),
            add('        "left-pad": "1.0.0",'),
          ],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when another root entry field changes", () => {
    expect(
      isTooling(
        file(path, [
          [
            ctx('    "": {'),
            add('      "version": "1.2.3",'),
            ctx('      "license": "MIT"'),
          ],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when a changed package entry is not dev only", () => {
    expect(
      isTooling(
        file(path, [
          [
            entry("left-pad"),
            add('      "version": "1.0.0",'),
            ctx('      "license": "MIT"'),
          ],
        ]),
      ),
    ).toBe(false);
  });
});

describe("isTooling: tools/kore/package-lock.json, unplaceable changes", () => {
  const path = "tools/kore/package-lock.json";
  const entry = (name: string) => ctx(`    "node_modules/${name}": {`);

  it("is product when a runtime package is flagged dev in place", () => {
    expect(
      isTooling(
        file(path, [
          [
            entry("yaml"),
            ctx('      "version": "2.0.0",'),
            add('      "dev": true,'),
          ],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when a later hunk has no package entry in view", () => {
    expect(
      isTooling(
        file(path, [
          [
            entry("vitest"),
            add('      "version": "4.0.1",'),
            ctx('      "dev": true,'),
          ],
          [add('      "version": "1.0.0",'), ctx('      "dev": true,')],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when a change has no package entry in view", () => {
    expect(isTooling(file(path, [[add('      "version": "1.0.0",')]]))).toBe(
      false,
    );
  });
});

describe("isTooling: tools/kore/package-lock.json, entry boundaries", () => {
  const path = "tools/kore/package-lock.json";
  const devEntry = [
    ctx('    "node_modules/vitest": {'),
    add('      "version": "4.0.1",'),
    ctx('      "dev": true,'),
    ctx("    },"),
  ];

  it.each([
    ['    "packages/runtime": {'],
    ['    "../shared": {'],
    ['     "node_modules/left-pad": {'],
  ])("is product when a runtime entry %s follows a dev entry", (header) => {
    expect(
      isTooling(
        file(path, [
          [...devEntry, ctx(header), add('      "version": "1.0.0",')],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when a touched runtime entry is followed by a top-level key", () => {
    expect(
      isTooling(
        file(path, [
          [
            ctx('    "node_modules/left-pad": {'),
            add('      "version": "1.0.0",'),
            ctx("    },"),
            ctx('  "requires": true'),
          ],
        ]),
      ),
    ).toBe(false);
  });

  it("is tooling when a dev entry closes and a later hunk starts a new dev entry", () => {
    expect(
      isTooling(
        file(path, [
          devEntry,
          [
            ctx('    "node_modules/oxlint": {'),
            add('      "version": "1.0.0",'),
            ctx('      "dev": true,'),
          ],
        ]),
      ),
    ).toBe(true);
  });

  it("is product when the diff has no hunks", () => {
    expect(isTooling(file(path))).toBe(false);
  });
});

describe("isTooling: tools/kore/package-lock.json, entries with no close line in view", () => {
  const path = "tools/kore/package-lock.json";
  const devEntry = [
    ctx('    "node_modules/vitest": {'),
    add('      "version": "4.0.1",'),
    ctx('      "dev": true,'),
  ];

  it.each([
    ['    "packages/runtime": {'],
    ['    "../shared": {'],
    ['     "node_modules/left-pad": {'],
  ])("is product when a runtime entry %s follows a dev entry", (header) => {
    expect(
      isTooling(
        file(path, [
          [...devEntry, ctx(header), add('      "version": "1.0.0",')],
        ]),
      ),
    ).toBe(false);
  });

  it("is product when a change follows a top-level key that ends a dev entry", () => {
    expect(
      isTooling(
        file(path, [
          [...devEntry, ctx('  "requires": true'), add('      "version": "1"')],
        ]),
      ),
    ).toBe(false);
  });
});
