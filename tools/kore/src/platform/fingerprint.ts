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
 * A digest of everything kore hands Helm for a release: the arguments, the
 * content of each `--values` file and, when a chart directory is given, the
 * content of every file in it. Paths are made relative so another checkout of
 * the same content yields the same digest. Only content that kore reproduces
 * from the repository goes in; a secret is never an argument, so none is hashed
 * or printed here. Kore stores the digest as the Helm revision description on
 * upgrade, so the release itself is the single owner of what it was deployed
 * from.
 */
export function argsFingerprint(
  args: readonly string[],
  chartDirectory?: string,
): string {
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
  if (
    chartDirectory !== undefined &&
    existsSync(chartDirectory) &&
    statSync(chartDirectory).isDirectory()
  ) {
    for (const file of chartFiles(chartDirectory)) {
      part("file", relative(chartDirectory, file));
      part("content", readFileSync(file));
    }
  }
  return `${prefix}${hash.digest("hex")}`;
}

/** The fingerprint of a platform component's Helm release. */
export function desiredFingerprint(
  repository: Repository,
  component: Component,
): string {
  return argsFingerprint(
    helmUpgradeArgs(repository, component),
    component.kind === "local-chart"
      ? absolute(repository, component.chart!)
      : undefined,
  );
}
