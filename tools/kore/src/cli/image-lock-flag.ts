import { relative, resolve } from "node:path";
import type { ParsedArgs } from "./flags.js";

/**
 * The `--image-lock <file>` of `kore app up`: the release-automation lock to
 * deploy from. The lock loader joins its path onto the repository root, so an
 * absolute path is made root-relative.
 */
export function imageLockFlag(
  parsed: ParsedArgs,
  root: string,
): string | undefined {
  const value = parsed.flags.get("image-lock");
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(
      "--image-lock requires a file: the images.lock.json attached to a release",
    );
  }
  return relative(root, resolve(root, value));
}
