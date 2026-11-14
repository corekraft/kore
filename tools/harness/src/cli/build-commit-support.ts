declare const __HARNESS_COMMIT__: string | undefined;

/** The commit the bundle was built at, stamped by build.mjs; undefined when run from source. */
export function bundleCommit(): string | undefined {
  return typeof __HARNESS_COMMIT__ === "string" && __HARNESS_COMMIT__ !== ""
    ? __HARNESS_COMMIT__
    : undefined;
}
