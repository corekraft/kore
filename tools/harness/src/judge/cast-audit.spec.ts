import { describe, expect, it } from "vitest";
import { castAudit } from "./cast-audit.js";
import type { ChangedFile } from "./diff.js";

// The cast item is pure over the diff, so no collaborator is mocked: each test states the added
// lines it reads and the findings it must, and must not, produce.
const FIX =
  "replace the cast with a type guard or a corrected declared type (AGENTS.md, Strict types)";

const changed = (
  path: string,
  addedLines: { line: number; text: string }[],
  options: { deleted?: boolean; after?: ChangedFile["after"] } = {},
): ChangedFile => ({
  path,
  previousPath: path,
  deleted: options.deleted ?? false,
  added: addedLines.map((a) => a.text),
  addedLines,
  removed: 0,
  netRemoved: 0,
  after: options.after ?? [],
  trail: [],
});

const SRC = "tools/harness/src/judge/a.ts";

describe("castAudit names each type cast on an added line, with its file, line and fix", () => {
  it("names an added `as never` with its file, its line and the fix", () => {
    expect(
      castAudit([
        changed(SRC, [{ line: 7, text: "  const v = raw as never;" }]),
      ]),
    ).toEqual([
      { item: "type-cast", file: SRC, line: 7, detail: "as never", fix: FIX },
    ]);
  });

  it("names an added `as unknown as` once, as one cast", () => {
    expect(
      castAudit([
        changed(SRC, [{ line: 3, text: "const v = raw as unknown as Foo;" }]),
      ]),
    ).toEqual([
      {
        item: "type-cast",
        file: SRC,
        line: 3,
        detail: "as unknown as",
        fix: FIX,
      },
    ]);
  });

  it("names any other `as` assertion, such as `as Foo`", () => {
    expect(
      castAudit([changed(SRC, [{ line: 4, text: "const v = raw as Foo;" }])]),
    ).toEqual([
      { item: "type-cast", file: SRC, line: 4, detail: "as Foo", fix: FIX },
    ]);
  });

  it("flags a cast on the right of an export, because that is no alias", () => {
    expect(
      castAudit([
        changed(SRC, [{ line: 5, text: "export const v = raw as Foo;" }]),
      ]),
    ).toEqual([
      { item: "type-cast", file: SRC, line: 5, detail: "as Foo", fix: FIX },
    ]);
  });

  it("flags a multi-line `as never` argument, which reads like an alias but names a built-in type", () => {
    expect(
      castAudit([changed(SRC, [{ line: 9, text: "  raw as never," }])]),
    ).toEqual([
      { item: "type-cast", file: SRC, line: 9, detail: "as never", fix: FIX },
    ]);
  });

  it("reports each cast on each added line, in the order the lines are added", () => {
    expect(
      castAudit([
        changed(SRC, [
          { line: 2, text: "const a = x as never;" },
          { line: 6, text: "const b = y as Foo;" },
        ]),
      ]).map((f) => [f.line, f.detail]),
    ).toEqual([
      [2, "as never"],
      [6, "as Foo"],
    ]);
  });
});

describe("castAudit does not flag `as const` or an import or export alias", () => {
  it("produces no finding for `as const`", () => {
    expect(
      castAudit([
        changed(SRC, [{ line: 1, text: 'const xs = ["a"] as const;' }]),
      ]),
    ).toEqual([]);
  });

  it("produces no finding for a named import alias", () => {
    expect(
      castAudit([
        changed(SRC, [{ line: 1, text: 'import { a as b } from "./x.js";' }]),
      ]),
    ).toEqual([]);
  });

  it("produces no finding for a named re-export alias", () => {
    expect(
      castAudit([
        changed(SRC, [{ line: 1, text: 'export { a as b } from "./x.js";' }]),
      ]),
    ).toEqual([]);
  });

  it("produces no finding for a namespace import alias", () => {
    expect(
      castAudit([
        changed(SRC, [{ line: 1, text: 'import * as ns from "./x.js";' }]),
      ]),
    ).toEqual([]);
  });

  it("produces no finding for an alias on its own line of a multi-line import", () => {
    expect(
      castAudit([changed(SRC, [{ line: 2, text: "  renamed as local," }])]),
    ).toEqual([]);
  });
});

describe("castAudit reads only the lines the PR adds, in TypeScript files that are not deleted", () => {
  it("produces no finding for a cast on a context line the PR did not add", () => {
    const file = changed(SRC, [], {
      after: [{ added: false, text: "const v = raw as never;" }],
    });
    expect(castAudit([file])).toEqual([]);
  });

  it("produces no finding for a cast written in a comment or in a string", () => {
    expect(
      castAudit([
        changed(SRC, [
          { line: 1, text: "// falls back to as never here" },
          { line: 2, text: 'const s = "value as never";' },
        ]),
      ]),
    ).toEqual([]);
  });

  it("flags a cast in a test file, as the repository's strict-types rule has no test exemption", () => {
    const spec = "tools/harness/src/judge/a.spec.ts";
    expect(
      castAudit([
        changed(spec, [{ line: 8, text: "const v = raw as never;" }]),
      ]),
    ).toEqual([
      { item: "type-cast", file: spec, line: 8, detail: "as never", fix: FIX },
    ]);
  });

  it("produces no finding in a file that is not TypeScript", () => {
    expect(
      castAudit([
        changed("docs/guides/contributor.md", [
          { line: 3, text: "use raw as never here" },
        ]),
      ]),
    ).toEqual([]);
  });

  it("produces no finding in a deleted TypeScript file", () => {
    expect(
      castAudit([
        changed(SRC, [{ line: 1, text: "const v = raw as never;" }], {
          deleted: true,
        }),
      ]),
    ).toEqual([]);
  });
});
