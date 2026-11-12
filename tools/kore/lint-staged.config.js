import { fileURLToPath } from "node:url";

// lint-staged runs from the repository root, where oxlint cannot find the
// type-aware linter on its own; spawned commands inherit this path. The harness
// pins the same oxlint-tsgolint as kore, so its lint uses this binary too.
process.env.OXLINT_TSGOLINT_PATH = fileURLToPath(
  new URL("node_modules/.bin/tsgolint", import.meta.url),
);

export default {
  "tools/kore/src/**/*.ts": [
    "tools/kore/node_modules/.bin/oxlint --type-aware --fix --deny-warnings",
    "tools/kore/node_modules/.bin/prettier --write",
  ],
  "tools/kore/{package.json,tsconfig.json,.oxlintrc.json,.prettierrc.json,commitlint.config.js,lint-staged.config.js}":
    ["tools/kore/node_modules/.bin/prettier --write"],
  "tools/harness/{src,tests}/**/*.ts": [
    "tools/harness/node_modules/.bin/oxlint --type-aware --fix --deny-warnings",
    "tools/harness/node_modules/.bin/prettier --write",
  ],
  "tools/harness/{package.json,tsconfig.json,.oxlintrc.json,.prettierrc.json,vitest.config.ts}":
    ["tools/harness/node_modules/.bin/prettier --write"],
};
