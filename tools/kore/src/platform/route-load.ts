// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method
//
// The request load shared by the ingress measurement and the golden-path scale
// check: one parallel curl call per route, and the check of what it answered.
// Both send the same GETs, from the host, verifying the local CA.

/** A route the load exercises and the status every request must answer with. */
export interface LoadRoute {
  path: string;
  status: number;
}

export interface LoadTarget {
  hostname: string;
  port: number;
  /** The mkcert CAROOT directory; the load verifies the local CA. */
  caRoot: string;
  requestsPerRoute: number;
  concurrency: number;
}

/** The curl arguments of one round of a route: `requestsPerRoute` GETs, `concurrency` in flight. */
export function loadArgs(target: LoadTarget, path: string): string[] {
  const { hostname, port, caRoot, requestsPerRoute, concurrency } = target;
  return [
    "--silent",
    "--show-error",
    "--output",
    "/dev/null",
    "--write-out",
    "%{http_code}\\n",
    "--connect-timeout",
    "5",
    "--max-time",
    "60",
    "--cacert",
    `${caRoot}/rootCA.pem`,
    "--resolve",
    `${hostname}:${port}:127.0.0.1`,
    "--parallel",
    "--parallel-max",
    String(concurrency),
    // The glob is in the fragment: curl repeats the request, but the path
    // and query the Gateway routes and authorizes on stay exactly the route's.
    `https://${hostname}:${port}${path}#[1-${requestsPerRoute}]`,
  ];
}

/** Counts a round's requests; any wrong or missing status fails the round. */
export function countRound(
  route: LoadRoute,
  stdout: string,
  sent: number,
): number {
  const statuses = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(Number);
  const wrong = statuses.filter((status) => status !== route.status);
  if (wrong.length > 0) {
    throw new Error(
      `route ${route.path} answered ${wrong[0]} for ${wrong.length} of ${sent} requests, expected ${route.status}`,
    );
  }
  if (statuses.length !== sent) {
    throw new Error(
      `route ${route.path} completed ${statuses.length} of ${sent} requests`,
    );
  }
  return statuses.length;
}
