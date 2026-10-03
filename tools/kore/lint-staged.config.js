export default {
  "tools/kore/src/**/*.ts": [
    "tools/kore/node_modules/.bin/oxlint --fix --deny-warnings",
    "tools/kore/node_modules/.bin/prettier --write",
  ],
  "tools/kore/{package.json,tsconfig.json,.oxlintrc.json,.prettierrc.json,commitlint.config.js,lint-staged.config.js}":
    ["tools/kore/node_modules/.bin/prettier --write"],
};
