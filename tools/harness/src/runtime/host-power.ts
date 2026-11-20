import { nodeFileSystem, type FileSystem } from "./filesystem.js";
import type { Runner } from "./runner.js";

/** Where the host draws its power: the mains, its battery, or neither could be read. */
export type Power = "ac" | "battery" | "unknown";

// The quoted source name alone: pmset prints "Now drawing from '<source>'", and the
// bundle's import scan would read that whole phrase as an import specifier.
const AC = /'AC Power'/;
const BATTERY = /'Battery Power'/;

const SUPPLIES = "/sys/class/power_supply";

/** The kernel's report for one supply: `Discharging` is the only status that is on battery. */
async function batteryPower(
  fs: Pick<FileSystem, "readFile">,
  supply: string,
): Promise<Power | undefined> {
  try {
    const kind = (await fs.readFile(`${SUPPLIES}/${supply}/type`)).trim();
    if (kind !== "Battery") {
      return undefined;
    }
    const status = (await fs.readFile(`${SUPPLIES}/${supply}/status`)).trim();
    if (status === "Discharging") {
      return "battery";
    }
    return status === "Unknown" ? "unknown" : "ac";
  } catch {
    return "unknown";
  }
}

/**
 * Reads /sys/class/power_supply on Linux: no battery is the mains (a server or desktop),
 * any discharging battery is battery, and a supply that cannot be read is `unknown`.
 */
async function readLinuxPower(
  fs: Pick<FileSystem, "readdir" | "readFile">,
): Promise<Power> {
  let supplies: string[];
  try {
    supplies = await fs.readdir(SUPPLIES);
  } catch {
    return "unknown";
  }
  const readings = await Promise.all(supplies.map((s) => batteryPower(fs, s)));
  if (readings.includes("battery")) {
    return "battery";
  }
  return readings.includes("unknown") ? "unknown" : "ac";
}

/**
 * Reads the power source: `pmset -g batt` on macOS, /sys/class/power_supply on Linux.
 * Anything that cannot be read, including any other host, is `unknown`, which callers
 * treat as battery.
 */
export async function readPower(
  runner: Runner,
  platform: NodeJS.Platform = process.platform,
  fs: Pick<FileSystem, "readdir" | "readFile"> = nodeFileSystem,
): Promise<Power> {
  if (platform === "linux") {
    return await readLinuxPower(fs);
  }
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
