import type { Runner } from "./runner.js";

/** Where the host draws its power: the mains, its battery, or neither could be read. */
export type Power = "ac" | "battery" | "unknown";

const AC = /Now drawing from 'AC Power'/;
const BATTERY = /Now drawing from 'Battery Power'/;

/**
 * Reads the power source through `pmset -g batt` on macOS. Anything that cannot be
 * read, including a host with no pmset, is `unknown`, which callers treat as battery.
 */
export async function readPower(
  runner: Runner,
  platform: NodeJS.Platform = process.platform,
): Promise<Power> {
  if (platform !== "darwin") {
    return "unknown";
  }
  let stdout: string;
  try {
    const result = await runner.run("pmset", ["-g", "batt"]);
    if (result.code !== 0) {
      return "unknown";
    }
    stdout = result.stdout;
  } catch {
    return "unknown";
  }
  if (AC.test(stdout)) {
    return "ac";
  }
  return BATTERY.test(stdout) ? "battery" : "unknown";
}
