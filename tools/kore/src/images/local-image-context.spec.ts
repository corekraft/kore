import { beforeEach, expect, test, vi } from "vitest";
import { contextInputs, sourceTagOf } from "./local-image-context.js";

// Docs: AGENTS.md "Deploy what was verified." (a stale tag must never be reused)

type Node =
  | { kind: "file"; content: string; mode: number }
  | { kind: "link"; target: string; mode: number };

const disk = vi.hoisted(() => ({
  nodes: new Map<string, unknown>(),
  failure: undefined as NodeJS.ErrnoException | undefined,
}));

vi.mock("node:fs/promises", () => {
  const nodes = disk.nodes as Map<string, Node>;
  const absent = (): never => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
  const children = (directory: string): string[] => {
    const prefix = directory.endsWith("/") ? directory : `${directory}/`;
    const names = new Set<string>();
    for (const path of nodes.keys()) {
      if (path.startsWith(prefix)) {
        names.add(path.slice(prefix.length).split("/")[0]!);
      }
    }
    return [...names];
  };
  const statsOf = (path: string) => {
    const node = nodes.get(path);
    const isDir = node === undefined && children(path).length > 0;
    if (node === undefined && !isDir) {
      return absent();
    }
    return {
      mode: node?.mode ?? 0o755,
      isSymbolicLink: () => node?.kind === "link",
      isFile: () => node?.kind === "file",
      isDirectory: () => isDir,
    };
  };
  return {
    readdir: vi.fn(async (directory: string) =>
      children(directory).map((name) => ({
        name,
        isDirectory: () => statsOf(directory + "/" + name).isDirectory(),
      })),
    ),
    lstat: vi.fn(async (path: string) => statsOf(path)),
    readlink: vi.fn(async (path: string) => {
      const node = nodes.get(path);
      return node?.kind === "link" ? node.target : absent();
    }),
    readFile: vi.fn(async (path: string, encoding?: string) => {
      if (disk.failure !== undefined && path.endsWith(".dockerignore")) {
        throw disk.failure;
      }
      const node = nodes.get(path);
      if (node?.kind !== "file") {
        return absent();
      }
      return encoding === undefined ? Buffer.from(node.content) : node.content;
    }),
  };
});

const root = "/context";

function put(path: string, content: string, mode = 0o644): void {
  disk.nodes.set(`${root}/${path}`, { kind: "file", content, mode });
}

function link(target: string): void {
  disk.nodes.set(`${root}/link`, { kind: "link", target, mode: 0o777 });
}

/** A context directory; its `.dockerignore` is the second argument. */
function context(
  files: Record<string, string>,
  dockerignore = "node_modules\n.git\n",
): void {
  put("Dockerfile", "FROM scratch\n");
  put(".dockerignore", dockerignore);
  for (const [path, content] of Object.entries(files)) {
    put(path, content);
  }
}

const hash = async () => (await contextInputs(root)).hash;

beforeEach(() => {
  disk.nodes.clear();
  disk.failure = undefined;
});

test("the same content hashes the same, whatever order it was written in", async () => {
  context({ "src/a.ts": "a", "package.json": "{}" });
  const first = await hash();
  disk.nodes.clear();
  context({ "package.json": "{}", "src/a.ts": "a" });

  expect(await hash()).toBe(first);
});

test("the Dockerfile text is returned with the hash", async () => {
  context({});

  expect((await contextInputs(root)).dockerfile).toBe("FROM scratch\n");
});

test("a file's bytes cannot be reframed as another file: NUL bytes in content never collide", async () => {
  context({ a: "x\0b\0y" });
  const joined = await hash();
  disk.nodes.clear();
  context({ a: "x", b: "y" });
  const split = await hash();
  disk.nodes.clear();
  context({ "a\0x": "b\0y" });

  expect(joined).not.toBe(split);
  expect(await hash()).not.toBe(joined);
});

test("a mode change alone changes the hash", async () => {
  context({ "bin/run.sh": "echo" });
  const before = await hash();

  put("bin/run.sh", "echo", 0o755);

  expect(await hash()).not.toBe(before);
});

test("a symlink target change changes the hash", async () => {
  context({ "src/a.ts": "a" });
  link("/nonexistent/one");
  const before = await hash();

  link("/nonexistent/two");

  expect(await hash()).not.toBe(before);
});

test("node_modules is excluded only at the root, as .dockerignore says", async () => {
  context({
    "node_modules/dep/index.js": "one",
    "src/node_modules/dep/index.js": "one",
  });
  const before = await hash();

  put("node_modules/dep/index.js", "two");
  expect(await hash()).toBe(before);

  put("src/node_modules/dep/index.js", "two");
  expect(await hash()).not.toBe(before);
});

test("a .dockerignore pattern with a wildcard, and a negation, decide what counts", async () => {
  context(
    { "a.log": "1", "keep.log": "1", "docs/b.log": "1", "src/x.ts": "1" },
    "*.log\n!keep.log\n",
  );
  const before = await hash();

  put("a.log", "2");
  expect(await hash()).toBe(before);
  put("keep.log", "2");
  expect(await hash()).not.toBe(before);
  const afterKeep = await hash();
  // `*` does not cross a slash, so a nested .log is not matched by `*.log`.
  put("docs/b.log", "2");
  expect(await hash()).not.toBe(afterKeep);
});

test("the Dockerfile and .dockerignore count even when .dockerignore would exclude them", async () => {
  context({ "src/x.ts": "1" }, "Dockerfile\n.dockerignore\n");
  const before = await hash();

  put("Dockerfile", "FROM scratch\nRUN true\n");

  expect(await hash()).not.toBe(before);
});

test("a missing directory has no hash, so the build names it instead of a stale reuse", async () => {
  await expect(contextInputs("/does-not-exist")).resolves.toEqual({
    hash: undefined,
    dockerfile: undefined,
  });
});

test("a context with no .dockerignore hashes everything, node_modules included", async () => {
  put("Dockerfile", "FROM scratch\n");
  put("node_modules/dep.js", "one");
  const before = await hash();

  put("node_modules/dep.js", "two");

  expect(await hash()).not.toBe(before);
});

test("a read failure other than a missing file is not hidden as a missing context", async () => {
  context({});
  disk.failure = Object.assign(new Error("EACCES"), { code: "EACCES" });

  await expect(contextInputs(root)).rejects.toThrow("EACCES");
});

test("the tag changes with the base image digest and with the platform", () => {
  const base = sourceTagOf(
    "a".repeat(64),
    ["node@sha256:" + "1".repeat(64)],
    "linux/arm64",
  );

  expect(base).toMatch(/^kore-src-[0-9a-f]{16}$/);
  expect(base).toBe(
    sourceTagOf(
      "a".repeat(64),
      ["node@sha256:" + "1".repeat(64)],
      "linux/arm64",
    ),
  );
  expect(
    sourceTagOf(
      "a".repeat(64),
      ["node@sha256:" + "2".repeat(64)],
      "linux/arm64",
    ),
  ).not.toBe(base);
  expect(
    sourceTagOf(
      "a".repeat(64),
      ["node@sha256:" + "1".repeat(64)],
      "linux/amd64",
    ),
  ).not.toBe(base);
  expect(
    sourceTagOf(
      "b".repeat(64),
      ["node@sha256:" + "1".repeat(64)],
      "linux/arm64",
    ),
  ).not.toBe(base);
});

test("`**/` matches whole directories only, so a file that merely resembles one still counts", async () => {
  context({ "a/b": "1", "a/x/y/b": "1", "a/xb": "1" }, "a/**/b\n");
  const before = await hash();

  put("a/b", "2");
  put("a/x/y/b", "2");
  expect(await hash()).toBe(before);

  put("a/xb", "2");
  expect(await hash()).not.toBe(before);
});
