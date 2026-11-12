import type { Runner } from "../runtime/index.js";
import { RulesetError } from "./declared.js";

/** A gh call that exited non-zero; the stderr stays available for callers that classify it. */
export class GitHubError extends RulesetError {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

/** One page of rule suites; a full page means older suites were not read. */
export const PAGE = 100;

/** Reads and writes rulesets through the injectable runner, never the shell. */
export class GitHubRulesets {
  constructor(
    private readonly runner: Runner,
    private readonly repo: string,
  ) {}

  private async gh(args: string[], input?: string): Promise<unknown> {
    const result = await this.runner.run(
      "gh",
      args,
      input === undefined ? {} : { input },
    );
    if (result.code !== 0) {
      throw new GitHubError(
        `gh ${args.join(" ")} failed: ${result.stderr.trim() || `exit ${result.code}`}. Check \`gh auth status\` and that you may administer ${this.repo}.`,
        result.stderr,
      );
    }
    try {
      return result.stdout.trim() === "" ? {} : JSON.parse(result.stdout);
    } catch {
      throw new RulesetError(
        `gh ${args.join(" ")} did not return JSON: ${result.stdout.slice(0, 80)}. Check \`gh --version\` and \`gh auth status\`, then rerun.`,
      );
    }
  }

  /** The live ruleset with this name, in full, or undefined when GitHub has none. */
  private async list(args: string[]): Promise<Json[]> {
    const value = await this.gh(args);
    if (!Array.isArray(value)) {
      throw new RulesetError(
        `gh ${args.join(" ")} did not return a list. Check that ${this.repo} is an owner/name repository you can read.`,
      );
    }
    return value as Json[];
  }

  async find(name: string): Promise<Json | undefined> {
    const list = await this.list(["api", `repos/${this.repo}/rulesets`]);
    const hit = list.find((r) => r["name"] === name);
    return hit === undefined
      ? undefined
      : ((await this.gh([
          "api",
          `repos/${this.repo}/rulesets/${String(hit["id"])}`,
        ])) as Json);
  }

  /** The only mutations: a create or an update of one ruleset. */
  async save(id: number | undefined, body: Json): Promise<void> {
    const [method, path] =
      id === undefined
        ? ["POST", `repos/${this.repo}/rulesets`]
        : ["PUT", `repos/${this.repo}/rulesets/${String(id)}`];
    await this.gh(
      ["api", "-X", method as string, path as string, "--input", "-"],
      JSON.stringify(body),
    );
  }

  async suites(period: string): Promise<Json[]> {
    return await this.list([
      "api",
      `repos/${this.repo}/rulesets/rule-suites?time_period=${period}&per_page=${String(PAGE)}`,
    ]);
  }

  async suite(id: number): Promise<Json> {
    return (await this.gh([
      "api",
      `repos/${this.repo}/rulesets/rule-suites/${String(id)}`,
    ])) as Json;
  }
}
