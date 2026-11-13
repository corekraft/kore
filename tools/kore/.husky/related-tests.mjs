// Decides which unit tests the pre-commit hook runs for one package.
// Usage: printf '%s\n' "$staged" | node related-tests.mjs <kore|harness>
// Prints a mode on the first line, then one test-runner argument per line:
//   full     - run the whole suite (config or shared test setup changed)
//   related  - run `vitest related` on the listed files
//   none     - no test can be affected
// Docs: docs/guides/contributor.md (Commit hooks)

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const PACKAGES = {
  kore: {
    dir: "tools/kore",
    // A change here can affect every spec.
    full: [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "vitest.config.ts",
      "src/test-setup-support.ts",
    ],
    // Specs that read these repository paths by string, so the import graph misses them.
    readsRepository: true,
  },
  harness: {
    dir: "tools/harness",
    full: [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "vitest.config.ts",
    ],
  },
};

function specs(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...specs(path));
    } else if (
      entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".integration.spec.ts")
    ) {
      found.push(path);
    }
  }
  return found;
}

// A spec reads `infra/<dir>` or `apps/<dir>` by path, or scans the whole tree
// (`"infra"` or `"apps"` on their own); a staged file in that directory
// relates to each such spec.
function readers(pkgDir, staged) {
  const prefixes = new Set();
  for (const file of staged) {
    const [top, sub] = file.split("/");
    if (top === "infra" || top === "apps") {
      prefixes.add(sub === undefined ? top : `${top}/${sub}`);
    }
  }
  if (prefixes.size === 0) {
    return [];
  }
  const out = [];
  let list = [];
  try {
    list = specs(join(root, pkgDir, "src"));
  } catch {
    return out;
  }
  for (const spec of list) {
    const text = readFileSync(spec, "utf8");
    const hit = [...prefixes].some((p) => {
      const [top] = p.split("/");
      return (
        text.includes(p) ||
        text.includes(`"${top}"`) ||
        text.includes(`${top}/"`)
      );
    });
    if (hit) {
      out.push(relative(join(root, pkgDir), spec));
    }
  }
  return out;
}

export function plan(name, staged) {
  const pkg = PACKAGES[name];
  const prefix = `${pkg.dir}/`;
  const own = staged
    .filter((f) => f.startsWith(prefix))
    .map((f) => f.slice(prefix.length));
  if (own.some((f) => pkg.full.includes(f))) {
    return { mode: "full", files: [] };
  }
  const files = new Set(own.filter((f) => f.endsWith(".ts")));
  if (pkg.readsRepository) {
    for (const spec of readers(pkg.dir, staged)) {
      files.add(spec);
    }
  }
  return files.size === 0
    ? { mode: "none", files: [] }
    : { mode: "related", files: [...files].sort() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = readFileSync(0, "utf8").split("\n").filter(Boolean);
  const { mode, files } = plan(process.argv[2], input);
  process.stdout.write(`${[mode, ...files].join("\n")}\n`);
}
