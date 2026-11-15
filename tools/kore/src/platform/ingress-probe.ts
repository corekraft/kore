import type { Runner } from "../runtime/index.js";
import type { MeasurementOptions } from "./ingress-measurement.js";
import { ingressRoutes } from "./ingress-routes.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method

/** Times sequential GETs per route while the load runs, in milliseconds. */
export async function probeLatency(
  loadRunner: Runner,
  options: MeasurementOptions,
): Promise<number[]> {
  const probes = options.latencyProbesPerRoute ?? 0;
  const times: number[] = [];
  if (probes <= 0) {
    return times;
  }
  const { hostname, port, caRoot } = options;
  for (const route of ingressRoutes) {
    const { stdout } = await loadRunner.run(
      "curl",
      [
        "--silent",
        "--show-error",
        "--output",
        "/dev/null",
        "--write-out",
        "%{time_total}\\n",
        "--connect-timeout",
        "5",
        "--max-time",
        "60",
        "--cacert",
        `${caRoot}/rootCA.pem`,
        "--resolve",
        `${hostname}:${port}:127.0.0.1`,
        `https://${hostname}:${port}${route.path}#[1-${probes}]`,
      ],
      { capture: true },
    );
    for (const line of stdout.split("\n").map((l) => l.trim())) {
      if (line === "") {
        continue;
      }
      const seconds = Number(line);
      if (!Number.isFinite(seconds)) {
        throw new Error(
          `latency probe of ${route.path} returned an unreadable time '${line}'; check that curl reached https://${hostname}:${port}`,
        );
      }
      times.push(Math.round(seconds * 1000 * 10) / 10);
    }
  }
  return times;
}
