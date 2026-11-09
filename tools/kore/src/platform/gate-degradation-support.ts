import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Repository } from "../config/index.js";

// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md
// Shared by the live degradation proofs (gate-degradation.integration.spec.ts,
// gate-interrupt.integration.spec.ts).

/**
 * The prerequisite the proofs degrade: External Secrets' controller. The
 * readiness manifest requires it (the `secrets` requirement), it is not part
 * of the gate's own machinery (Gatekeeper, the registry and Policy Controller
 * stay up, so the gate can still be read, written and enforced), and scaling
 * it to zero touches no application workload.
 */
const degradedComponent = "external-secrets";

export interface DegradationTarget {
  component: string;
  namespace: string;
  deployment: string;
  /** The readiness requirement that names the component. */
  requirement: string;
}

export function degradationTarget(repository: Repository): DegradationTarget {
  const component = repository.catalog.components.find(
    ({ name }) => name === degradedComponent,
  );
  const requirement = repository.readiness.requirements.find(({ components }) =>
    components?.includes(degradedComponent),
  );
  const deployment = component?.readiness
    .find((check) => check.startsWith("deployment/"))
    ?.split("/")[1];
  if (!component || !requirement || !deployment) {
    throw new Error(
      `${degradedComponent} must be a catalog component with a deployment readiness check that the readiness manifest requires`,
    );
  }
  return {
    component: component.name,
    namespace: component.namespace,
    deployment,
    requirement: requirement.name,
  };
}

export interface KoreResult {
  code: number;
  stdout: string;
  stderr: string;
}

const cli = fileURLToPath(new URL("../cli/cli.js", import.meta.url));

/** Starts the built `kore` CLI as a child process (the real binary, not a fake). */
export function startKore(args: readonly string[]): {
  child: ChildProcess;
  done: Promise<KoreResult>;
  output: () => string;
} {
  const child = spawn(process.execPath, [cli, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const done = new Promise<KoreResult>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve({ code: code ?? (signal ? 143 : 1), stdout, stderr }),
    );
  });
  return { child, done, output: () => stdout + stderr };
}

export async function runKore(args: readonly string[]): Promise<KoreResult> {
  return await startKore(args).done;
}

/** Polls until `attempt` returns a value; fails with what it waited for. */
export async function until<T>(
  description: string,
  attempt: () => Promise<T | undefined>,
  seconds = 300,
): Promise<T> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await attempt();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`timed out after ${seconds}s waiting for ${description}`);
}
