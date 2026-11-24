import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";

// Docs: docs/decisions/0167-application-secrets-come-from-openbao-behind-the-platform-secrets-contract-one-path-per-suborg.md
// Docs: docs/decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md

/** The OpenBao StatefulSet the openbao component declares; its single pod is openbao-0. */
const RESOURCE = "statefulset/openbao";
const POD = "openbao-0";
const CONTAINER = "openbao";
/** Where self-initialization enables the file audit device (the vps openbao values). */
const AUDIT_FILE = "/openbao/audit/audit.log";
/** The pod is not there, not started or not accepting exec yet: wait for it. */
const NOT_RUNNING =
  /not found|container not found|is not running|ContainerCreating|PodInitializing|cannot exec in a stopped container|unable to upgrade connection/i;

/** What the check reads from: the runner and the kubectl scope of the component. */
export interface OpenbaoContext {
  runner: Runner;
  base: string[];
}

/** A readiness check: the condition it proves and a bounded evaluation. */
export interface OpenbaoCheck {
  condition: string;
  run: (timeout: string) => Promise<void>;
}

/**
 * Proves the OpenBao pod is initialised, unsealed and has its audit device, and
 * fails closed otherwise. The chart's own pod probe only passes or
 * fails on the seal state: it names no cause and never reads the audit device. Each failure names its own cause (uninitialised,
 * sealed, no audit device) so a person never reads a bare timeout. Undefined for
 * any other resource.
 */
export function openbaoCheck(
  context: OpenbaoContext,
  resource: string,
): OpenbaoCheck | undefined {
  if (resource !== RESOURCE) {
    return undefined;
  }
  return {
    condition: "initialised, unsealed and writing its audit log",
    run: (timeout) => pollUntil(timeout, () => notReadyReason(context)),
  };
}

/** Runs a shell command in the openbao container of openbao-0 and returns its output. */
async function inPod(
  { runner, base }: OpenbaoContext,
  command: string,
): Promise<string> {
  const result = await runner.run(
    "kubectl",
    [
      ...base,
      "exec",
      POD,
      "--container",
      CONTAINER,
      "--",
      "/bin/sh",
      "-c",
      command,
    ],
    { capture: true },
  );
  return result.stdout.trim();
}

/**
 * The seal and initialisation state from `bao status -format=json`, which prints
 * its JSON even when it exits 2 for a sealed server, so the exit code is ignored
 * and an unreadable answer is the failure. Undefined when the answer lacks either field.
 */
function parseStatus(
  output: string,
): { initialized: boolean; sealed: boolean } | undefined {
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("initialized" in parsed) ||
      !("sealed" in parsed)
    ) {
      return undefined;
    }
    const { initialized, sealed } = parsed;
    return typeof initialized === "boolean" && typeof sealed === "boolean"
      ? { initialized, sealed }
      : undefined;
  } catch {
    return undefined;
  }
}

async function notReadyReason(
  context: OpenbaoContext,
): Promise<string | undefined> {
  let output: string;
  try {
    output = await inPod(context, "bao status -format=json || true");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (NOT_RUNNING.test(message)) {
      return `${POD} is not running yet: ${message}`;
    }
    throw error;
  }
  const status = parseStatus(output);
  if (status === undefined) {
    return `OpenBao did not answer with its status (bao status printed ${output === "" ? "nothing" : "something that is not its JSON status"}); the server is not listening yet, or its configuration did not load: read \`kubectl logs ${POD}\``;
  }
  // Uninitialised comes first: an uninitialised OpenBao reports sealed too.
  if (!status.initialized) {
    return `OpenBao is uninitialised: self-initialization has not run, so there is no audit device and no way in. The initialize block of the server configuration runs once on the first start; read \`kubectl logs ${POD}\` for its error. Nothing here initialises it by hand`;
  }
  if (status.sealed) {
    return `OpenBao is sealed: the static seal did not unseal it. Check that /etc/kore/openbao/static-seal.key is on the node and is the key this storage was sealed with (ADR 0168), and that the place-seal-key init container copied it; read \`kubectl logs ${POD}\``;
  }
  const audit = await inPod(
    context,
    `if [ -s ${AUDIT_FILE} ]; then echo audit; else echo none; fi`,
  );
  if (audit !== "audit") {
    return `OpenBao has no audit device: ${AUDIT_FILE} is missing or empty, so requests are not audited. Self-initialization enables the file audit device there on the first start; an OpenBao without it is not to be used`;
  }
  return undefined;
}
