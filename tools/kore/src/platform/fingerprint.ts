import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { absolute, type Component, type Repository } from "../config/index.js";
import { helmUpgradeArgs } from "./helm.js";

const prefix = "kore desired-state sha256:";

function chartFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? chartFiles(join(directory, entry.name))
        : [join(directory, entry.name)],
    )
    .sort();
}

/**
 * A digest of everything kore would hand Helm for a component: the chart,
 * version, --set/--set-string arguments, the content of each values file, and,
 * for a local chart, the content of every file in the chart directory. Paths
 * are made relative so another checkout of the same content yields the same
 * digest. Kore stores it as the Helm revision description on upgrade, so the
 * release itself is the single owner of what it was deployed from.
 */
export function desiredFingerprint(
  repository: Repository,
  component: Component,
): string {
  const args = helmUpgradeArgs(repository, component);
  const hash = createHash("sha256");
  const part = (label: string, value: string | Buffer) =>
    hash.update(`${label}\0${value.length}\0`).update(value).update("\0");
  args.forEach((arg, index) => {
    if (arg === "--values") {
      return;
    }
    if (args[index - 1] === "--values") {
      // A missing file is left for Helm to report; it names the file itself.
      part("values", existsSync(arg) ? readFileSync(arg) : "missing");
      return;
    }
    part("arg", arg);
  });
  if (component.kind === "local-chart") {
    const chart = absolute(repository, component.chart!);
    if (existsSync(chart) && statSync(chart).isDirectory()) {
      for (const file of chartFiles(chart)) {
        part("file", relative(chart, file));
        part("content", readFileSync(file));
      }
    }
  }
  return `${prefix}${hash.digest("hex")}`;
}
