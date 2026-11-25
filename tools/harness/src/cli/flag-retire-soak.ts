// The retirement soak, read from the harness config the rest of the harness reads (ADR 0149). Split out of flag-retire-command.ts to keep each module within the lint cap.

import { FlagError } from "../flag/index.js";
import { HARNESS_CONFIG, parseHarnessConfig } from "../flow/index.js";
import type { FileSystem } from "../runtime/index.js";

/**
 * The soak, in whole days, that the harness config sets for `harness flag
 * retire`. It is configuration: a config that leaves it out is refused, never
 * given a default, so no flag is retired on a guessed soak (ADR 0149).
 */
export async function readRetireSoakDays(
  fs: FileSystem,
  base: string,
): Promise<number> {
  const text = await fs
    .readFile(`${base}/${HARNESS_CONFIG}`)
    .catch((cause: unknown) => {
      throw new FlagError(
        `Cannot read ${HARNESS_CONFIG} (${cause instanceof Error ? cause.message : String(cause)}); the retirement soak is configured there (ADR 0149). Restore it, then rerun.`,
      );
    });
  const config = parseHarnessConfig(text, HARNESS_CONFIG);
  if ("error" in config) {
    throw new FlagError(config.error);
  }
  if (config.retireSoakDays === undefined) {
    throw new FlagError(
      `${HARNESS_CONFIG} must set retireSoakDays, the soak in whole days a retired feature flag needs first (ADR 0149). Set it, then rerun.`,
    );
  }
  return config.retireSoakDays;
}
