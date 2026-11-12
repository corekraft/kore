import type { Repository } from "../config/index.js";
import { minikubeCluster } from "../config/index.js";
import { terminateMatching, type ProcessControl } from "../runtime/index.js";

const ISTIO_STATUS_PORT = 15021;

/**
 * Whether a full command line is the `ssh -L` forward minikube starts for this
 * profile's tunnel: the ssh binary, the profile's machine key, and the Gateway
 * and status-port forwards. Matched on the whole line, never on a pid.
 */
export function isTunnelSshForward(
  command: string,
  profile: string,
  gatewayPort: number,
): boolean {
  // Plain string checks: a RegExp built from the port is a dynamic pattern.
  const tokens = command.split(/\s+/);
  const specs = tokens.flatMap((token, index) => {
    if (token === "-L") {
      return [tokens[index + 1] ?? ""];
    }
    return token.startsWith("-L") ? [token.slice(2)] : [];
  });
  const forwards = (port: number) =>
    specs.some((spec) => {
      const parts = spec.split(":");
      // [bind:]port:host:hostport
      return parts.length >= 3 && parts.at(-3) === String(port);
    });
  return (
    /(?:^|\/)ssh\s/.test(command) &&
    command.includes(`/.minikube/machines/${profile}/`) &&
    forwards(gatewayPort) &&
    forwards(ISTIO_STATUS_PORT)
  );
}

/**
 * Whether a full command line is a `minikube tunnel` leader for exactly this
 * profile: the minikube binary, the `tunnel` subcommand, and the profile as the
 * value of `--profile` or `-p` (an exact token, never a prefix).
 */
export function isTunnelLeader(command: string, profile: string): boolean {
  const tokens = command.split(/\s+/).filter((token) => token !== "");
  const binary = tokens[0] ?? "";
  if (binary !== "minikube" && !binary.endsWith("/minikube")) {
    return false;
  }
  if (tokens[1] !== "tunnel") {
    return false;
  }
  return tokens.some(
    (token, index) =>
      (token === "--profile" || token === "-p") &&
      tokens[index + 1] === profile,
  );
}

/**
 * Terminates tunnel processes no state file records, reporting each: `ssh -L`
 * forwards that outlived a dead leader and may hold the Gateway port, and a
 * `minikube tunnel` leader for this profile (minikube permits one per profile,
 * so a leftover, e.g. from another checkout, makes a new tunnel exit at once).
 * Anything else, including other profiles' tunnels, never matches.
 */
export async function stopOrphanedForwards(
  repository: Repository,
  dependencies: ProcessControl = {},
): Promise<number[]> {
  const profile = minikubeCluster(repository.environment).profile;
  const port = repository.environment.gateway.port;
  return await terminateMatching(
    (entry) =>
      isTunnelSshForward(entry.command, profile, port) ||
      isTunnelLeader(entry.command, profile),
    (entry) =>
      isTunnelLeader(entry.command, profile)
        ? `stopped unrecorded minikube tunnel ${entry.pid} for profile ${profile}`
        : `stopped orphaned minikube ssh forward ${entry.pid} for profile ${profile}`,
    dependencies,
  );
}
