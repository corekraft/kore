// package.json
var package_default = {
  name: "@corekraft/harness",
  version: "0.1.0",
  private: true,
  description: "Agent harness tools: one bundled CLI that skills and hooks call",
  type: "module",
  scripts: {
    build: "esbuild src/main.ts --bundle --platform=node --format=esm --target=node26 --legal-comments=none --outfile=../../skills/bin/harness.mjs",
    check: "tsc -p tsconfig.json --noEmit",
    format: 'prettier --write "src/**/*.ts" "tests/**/*.ts" package.json tsconfig.json .oxlintrc.json .prettierrc.json vitest.config.ts',
    "format:check": 'prettier --check "src/**/*.ts" "tests/**/*.ts" package.json tsconfig.json .oxlintrc.json .prettierrc.json vitest.config.ts',
    lint: "oxlint --type-aware --deny-warnings src tests",
    test: "vitest run --coverage",
    "test:unit": "vitest run"
  },
  devDependencies: {
    "@types/node": "26.6.6",
    "@vitest/coverage-v8": "5.1.0",
    esbuild: "0.28.2",
    oxlint: "1.92.0",
    "oxlint-tsgolint": "7.0.2006",
    prettier: "3.9.10",
    typescript: "7.0.2",
    vitest: "5.1.0"
  },
  engines: {
    node: ">=26.8.2"
  }
};

// src/cli/domains.ts
var version = {
  summary: "print the harness version",
  run({ json, deps }) {
    deps.stdout(
      json ? `${JSON.stringify({ version: package_default.version })}
` : `harness ${package_default.version}
`
    );
    return Promise.resolve(0);
  }
};
var domains = {
  harness: { version }
};

// src/cli/cli.ts
var USAGE_ERROR = 2;
function usage() {
  const lines = ["Usage: harness <domain> <command> [--json]", "", "Commands:"];
  for (const [domain, commands] of Object.entries(domains)) {
    for (const [name, command] of Object.entries(commands)) {
      lines.push(`  harness ${domain} ${name}  ${command.summary}`);
    }
  }
  lines.push(
    "",
    "Flags:",
    "  --json  print machine-readable output",
    "  --help  show this usage"
  );
  return `${lines.join("\n")}
`;
}
function fail(deps, message) {
  deps.stderr(`${message}

${usage()}`);
  return USAGE_ERROR;
}
function names(commands) {
  return Object.keys(commands).join(", ");
}
async function run(argv, deps) {
  const flags = argv.filter((a) => a.startsWith("-"));
  const words = argv.filter((a) => !a.startsWith("-"));
  const unknown = flags.find((f) => !["--json", "--help", "-h"].includes(f));
  if (unknown !== void 0) {
    return fail(deps, `Unknown flag "${unknown}".`);
  }
  const help = flags.includes("--help") || flags.includes("-h");
  const [domain, name] = words;
  if (domain === void 0) {
    deps.stdout(usage());
    return 0;
  }
  const commands = domains[domain];
  if (commands === void 0) {
    return fail(
      deps,
      `Unknown domain "${domain}". Domains: ${Object.keys(domains).join(", ")}.`
    );
  }
  if (help) {
    deps.stdout(usage());
    return 0;
  }
  if (name === void 0) {
    return fail(
      deps,
      `Missing command for domain "${domain}". Commands: ${names(commands)}.`
    );
  }
  const command = commands[name];
  if (command === void 0) {
    return fail(
      deps,
      `Unknown command "${name}" for domain "${domain}". Commands: ${names(commands)}.`
    );
  }
  return await command.run({ json: flags.includes("--json"), deps });
}

// src/runtime/clock.ts
var systemClock = {
  now: () => /* @__PURE__ */ new Date()
};

// src/runtime/filesystem.ts
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
var nodeFileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  async writeFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  },
  readdir: (path) => readdir(path)
};

// src/runtime/runner.ts
import { spawn } from "node:child_process";
var ProcessRunner = class {
  async run(command, args, options = {}) {
    return await new Promise((resolve) => {
      const child = spawn(command, [...args], {
        ...options.cwd === void 0 ? {} : { cwd: options.cwd },
        stdio: [
          options.input === void 0 ? "ignore" : "pipe",
          "pipe",
          "pipe"
        ]
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        resolve({ stdout, stderr: error.message, code: 127 });
      });
      child.on("close", (code) => {
        resolve({ stdout, stderr, code: code ?? 1 });
      });
      if (options.input !== void 0) {
        child.stdin?.end(options.input);
      }
    });
  }
};

// src/main.ts
process.exitCode = await run(process.argv.slice(2), {
  runner: new ProcessRunner(),
  clock: systemClock,
  fs: nodeFileSystem,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
});
