import assert from "node:assert/strict";
import { describe, test } from "vitest";

// The test-related task runs the typecheck, lint and related unit tests of the
// packages the given files belong to, with the commit hook's related-tests plan.

interface Step {
  cwd: string;
  args: string[];
}
const modulePath = "../../.husky/test-related.mjs";
const { commands, run } = (await import(modulePath)) as {
  commands: (files: string[]) => Step[];
  run: (
    files: string[],
    exec: (cmd: string, args: string[]) => { status: number },
  ) => number;
};

describe("test-related", () => {
  test("a kore source file runs the kore typecheck, lint and only its related tests", () => {
    assert.deepEqual(commands(["tools/kore/src/a/b.ts"]), [
      { cwd: "tools/kore", args: ["run", "check", "--silent"] },
      { cwd: "tools/kore", args: ["run", "lint", "--silent"] },
      {
        cwd: "tools/kore",
        args: ["run", "test:related", "--silent", "--", "src/a/b.ts"],
      },
    ]);
  });

  test("a harness source file runs the harness steps, not kore's", () => {
    const out = commands(["tools/harness/src/x.ts"]);
    assert.deepEqual(
      out.map((step) => step.cwd),
      ["tools/harness", "tools/harness", "tools/harness"],
    );
    assert.deepEqual(out[2]?.args, [
      "run",
      "test:related",
      "--silent",
      "--",
      "src/x.ts",
    ]);
  });

  test("a config change runs the whole unit suite, as the hook does", () => {
    assert.deepEqual(commands(["tools/kore/package.json"])[2], {
      cwd: "tools/kore",
      args: ["run", "test:unit", "--silent"],
    });
  });

  test("files outside both packages run nothing", () => {
    assert.deepEqual(commands(["README.md", "docs/index.md"]), []);
  });

  test("it never starts an integration or live run", () => {
    const all = JSON.stringify(
      commands(["tools/kore/src/a.ts", "tools/harness/package.json"]),
    );
    assert.doesNotMatch(all, /integration|live|k3d|cluster/);
  });

  test("a failing step does not stop the later ones, and the first failure's code is returned", () => {
    const seen: string[][] = [];
    const statuses = [0, 3, 4];
    const code = run(["tools/kore/src/a.ts"], (_cmd, args) => {
      seen.push(args);
      return { status: statuses[seen.length - 1] ?? 0 };
    });
    assert.equal(code, 3);
    assert.equal(seen.length, 3);
    assert.equal(seen[2]?.[1], "test:related");
  });
});
