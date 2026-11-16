import type { Runner } from "../runtime/index.js";
import { HarnessCliError } from "./harness-cli.js";
import type { Proposal } from "./retro-proposals.js";

const HARNESS = "skills/bin/harness.mjs";

/** The filing ports over the real tools: every call is one `harness` command through the runner. */
export class RetroFilingCli {
  constructor(
    private readonly runner: Runner,
    private readonly root: string,
    private readonly now: () => string,
  ) {}

  /** `idea new --slug <key>`: an existing slug is returned untouched, so a rerun creates nothing. */
  async file(
    slug: string,
    p: Proposal,
  ): Promise<{ created: boolean; number: string }> {
    const out = await this.harness(
      "idea",
      "new",
      "--slug",
      slug,
      "--title",
      p.title,
      "--hypothesis",
      p.hypothesis,
      "--expected-outcome",
      p.expectedOutcome,
      "--measurement",
      p.measurement,
      "--safety-pattern",
      p.safetyPattern,
      "--kind",
      "harness",
      "--metric",
      p.metric,
      "--direction",
      p.direction,
      "--window",
      p.window,
      "--json",
    );
    const made = JSON.parse(out) as { created: boolean; number: string };
    return { created: made.created, number: made.number };
  }

  async recordFiled(number: string, key: string): Promise<void> {
    await this.harness(
      "ledger",
      "record",
      "--source",
      "claude",
      "--kind",
      "idea.filed",
      "--occurred-at",
      this.now(),
      "--idea",
      number,
      "--label",
      key,
    );
  }

  /** Records the cap's drops once per trigger, so a rerun never counts them twice. */
  async recordDropped(trigger: string, count: number): Promise<void> {
    const listed = JSON.parse(
      await this.harness("ledger", "list", "--kind", "retro.dropped", "--json"),
    ) as { events: { label?: string }[] };
    if (listed.events.some((e) => e.label === trigger)) {
      return;
    }
    await this.harness(
      "ledger",
      "record",
      "--source",
      "claude",
      "--kind",
      "retro.dropped",
      "--occurred-at",
      this.now(),
      "--label",
      trigger,
      "--number",
      String(count),
    );
  }

  private async harness(...args: string[]): Promise<string> {
    const done = await this.runner.run("node", [HARNESS, ...args], {
      cwd: this.root,
    });
    if (done.code !== 0) {
      throw new HarnessCliError(
        `\`harness ${args
          .filter((a) => a !== "--json")
          .slice(0, 4)
          .join(
            " ",
          )}\` failed: ${done.stderr.trim() || "no output"}. Fix that, then rerun.`,
      );
    }
    return done.stdout;
  }
}
