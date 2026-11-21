import { withSecretsRedacted } from "../images/index.js";
import type { Runner } from "../runtime/index.js";

/**
 * The headless-browser image the platform checks run in, pinned by digest: the
 * Playwright image of v1.65.1 on Ubuntu noble, which carries Node 26 and the
 * headless Chromium build that Playwright 1.65.1 drives. Its Playwright npm
 * package is not installed in the image, so the driver speaks DevTools directly.
 */
export const pinnedBrowserImage =
  "mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579";

export interface HeadlessBrowserRun {
  /** A digest-pinned image that carries Chromium and Node. */
  image: string;
  /**
   * The Node program the container runs. It is streamed on stdin, never passed
   * as an argument, so credentials in it stay out of the process list.
   */
  program: string;
  /** Values redacted from any failure message the run produces. */
  secrets?: readonly string[];
}

/**
 * Runs a program in a throwaway container of a pinned headless-browser image,
 * with host networking so it reaches the platform gateway, and returns the JSON
 * the program printed on its last stdout line. The container is removed on exit.
 */
export async function runHeadlessBrowser(
  runner: Runner,
  run: HeadlessBrowserRun,
): Promise<unknown> {
  const { stdout } = await withSecretsRedacted(run.secrets ?? [], () =>
    runner.run(
      "docker",
      [
        "run",
        "--rm",
        "--interactive",
        "--network",
        "host",
        "--ipc",
        "host",
        "--init",
        run.image,
        "node",
        "-",
      ],
      { capture: true, input: run.program },
    ),
  );
  const lastLine = stdout.trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(lastLine) as unknown;
  } catch {
    throw new Error(
      "the headless browser printed no JSON result as its last line; rerun the check, and if it repeats, read the browser's own output in the container",
    );
  }
}
