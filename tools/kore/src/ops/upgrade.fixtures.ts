import type { Runner, RunOptions, RunResult } from "../runtime/index.js";

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

export interface Snapshot {
  kubernetes: string;
  components: Record<string, string>;
  owns?: Record<string, string[]>;
  xrd?: unknown;
}

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

/** Serves `git show <ref>:<path>` from fixtures and `yq` as an identity on JSON. */
export class GitFakeRunner implements Runner {
  calls: { command: string; args: readonly string[] }[] = [];
  constructor(
    private readonly refs: Record<string, Record<string, string>>,
    private readonly tags: string[] = [],
  ) {}
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args });
    const ok = (stdout: string): RunResult => ({ stdout, stderr: "", code: 0 });
    if (command === "yq") {
      return ok(options?.input ?? "");
    }
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
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  }
}
