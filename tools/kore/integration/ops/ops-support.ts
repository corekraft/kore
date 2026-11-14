// Fakes and fixtures shared by the ops integration specs. A support file is not
// a spec, so vitest.integration.config.ts matches only `*.spec.ts` (ADR 0098).
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import type { RunOptions, RunResult, Runner } from "../../src/runtime/index.js";

export interface Snapshot {
  kubernetes: string;
  components: Record<string, string>;
  owns?: Record<string, string[]>;
  xrd?: unknown;
}

export const XRD = (
  extraProps: Record<string, unknown> = {},
  required = ["size"],
) => ({
  spec: {
    versions: [
      {
        name: "v1alpha1",
        schema: {
          openAPIV3Schema: {
            type: "object",
            properties: {
              spec: {
                type: "object",
                required,
                properties: { size: { type: "string" }, ...extraProps },
              },
            },
          },
        },
      },
    ],
  },
});

/** The three repository files an upgrade check reads, as JSON text. */
export function snapshotFiles(snapshot: Snapshot): Record<string, string> {
  const names = Object.keys(snapshot.components);
  return {
    "infra/catalog/versions.yaml": JSON.stringify({
      kubernetes: snapshot.kubernetes,
      components: snapshot.components,
    }),
    "infra/catalog/components.yaml": JSON.stringify({
      components: names.map((name) => ({
        name,
        version: name,
        ownsCRDs: snapshot.owns?.[name] ?? [],
      })),
    }),
    "infra/apis/postgresql/definitions/postgresqlinstance.yaml": JSON.stringify(
      snapshot.xrd ?? XRD(),
    ),
  };
}

export const crd = (version: string) => ({
  metadata: { name: "w.example.dev" },
  spec: {
    group: "example.dev",
    versions: [{ name: version, served: true, storage: true }],
  },
});

export const previous: Snapshot = {
  kubernetes: "1.36.0",
  components: { crossplane: "2.4.0", istio: "1.31.0" },
  owns: { crossplane: ["a.crossplane.io"] },
};

/**
 * A fake CLI: `git show` serves the snapshot at each release tag, `git tag`
 * lists the tags, `helm template` echoes its version and `yq` renders the CRD
 * the test chooses for that version (JSON passes through unchanged).
 */
export class FakeCli implements Runner {
  calls: { command: string; args: readonly string[] }[] = [];
  constructor(
    private readonly refs: Record<string, Record<string, string>>,
    private readonly crdFor: (version: string) => unknown = () => crd("v1"),
    private readonly tags: string[] = ["v0.4.0"],
  ) {}
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args });
    const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0 });
    if (command === "git" && args[0] === "tag") {
      return ok(this.tags.join("\n"));
    }
    if (command === "git" && args[0] === "show") {
      const [ref, path] = String(args[1]).split(":") as [string, string];
      const content = this.refs[ref]?.[path];
      if (content === undefined) {
        throw new Error(`fatal: path '${path}' does not exist in '${ref}'`);
      }
      return ok(content);
    }
    if (command === "helm") {
      return ok(`version=${args[args.indexOf("--version") + 1]}`);
    }
    if (command === "yq") {
      const input = options?.input ?? "";
      return ok(
        input.startsWith("version=")
          ? `${JSON.stringify(this.crdFor(input.slice(8)))}\n`
          : input,
      );
    }
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  }
}

/** Temporary working trees, removed after each test of the calling spec. */
export function useWorkingTrees(): {
  write: (files: Record<string, string>) => Promise<string>;
} {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });
  return {
    async write(files) {
      const root = await mkdtemp(join(tmpdir(), "kore-upgrade-"));
      roots.push(root);
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
      }
      return root;
    },
  };
}
