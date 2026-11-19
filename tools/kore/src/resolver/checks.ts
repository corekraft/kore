// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { ClusterUnavailableError, k3dClusterInfo } from "../cluster/index.js";
import { isLocalProvider, platformPlan } from "../config/index.js";
import type { Environment } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  isPrivateUseDomain,
  resolverState,
  resolverTarget,
  type ResolverHost,
  type ResolverTarget,
} from "./resolver.js";

/** A doctor finding; doctor never requires one of these to pass. */
export interface ResolverFinding {
  name: string;
  status: "pass" | "warn";
  required: false;
  message: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  return code ?? errorText(error);
}

async function fileFinding(
  target: ResolverTarget,
  environmentName: string,
  host: ResolverHost,
): Promise<ResolverFinding> {
  const name = "host:resolver";
  let current: string | undefined;
  try {
    current = await host.read(target.path);
  } catch (error) {
    // An unreadable file is a finding, not a crash; a failure with no code is not expected, so it is rethrown.
    if (typeof (error as NodeJS.ErrnoException).code !== "string") {
      throw error;
    }
    return {
      name,
      status: "warn",
      required: false,
      message: `${target.path} could not be read (${errorCode(error)}); check its permissions`,
    };
  }
  const state = resolverState(target, current);
  const fix = `run kore dns install --environment ${environmentName}`;
  switch (state) {
    case "current":
      return {
        name,
        status: "pass",
        required: false,
        message: `${target.path} sends ${target.zone} to ${target.nameserver}:${target.port}`,
      };
    case "absent":
      return {
        name,
        status: "warn",
        required: false,
        message: `${target.path} is missing; ${fix}`,
      };
    case "outdated":
      return {
        name,
        status: "warn",
        required: false,
        message: `${target.path} differs from what environment ${environmentName} expects; ${fix}`,
      };
    default:
      return {
        name,
        status: "warn",
        required: false,
        message: `${target.path} was not written by kore; move it aside, then ${fix}`,
      };
  }
}

function domainFinding(zone: string): ResolverFinding {
  const name = "host:platform-domain";
  return isPrivateUseDomain(zone)
    ? {
        name,
        status: "warn",
        required: false,
        message: `${zone} is not registered in public DNS, so its names resolve only on this host`,
      }
    : {
        name,
        status: "pass",
        required: false,
        message: `${zone} is not a private-use name`,
      };
}

/** Only a running cluster serves the platform DNS; a listing that fails is not running. */
async function clusterRunning(
  environment: Environment,
  runner: Runner,
): Promise<boolean> {
  try {
    const { state } = await k3dClusterInfo(environment, runner);
    return state === "running";
  } catch (error) {
    // A missing k3d or a failed listing is reported by doctor's own checks; here it only means no probe.
    if (
      error instanceof CommandError ||
      error instanceof ClusterUnavailableError
    ) {
      return false;
    }
    throw error;
  }
}

async function dnsFinding(
  target: ResolverTarget,
  probeName: string,
  host: ResolverHost,
): Promise<ResolverFinding> {
  const name = "host:platform-dns";
  const server = `${target.nameserver}:${target.port}`;
  try {
    const addresses = await host.probe(probeName, {
      address: target.nameserver,
      port: target.port,
    });
    if (addresses.includes(target.nameserver)) {
      return {
        name,
        status: "pass",
        required: false,
        message: `${target.zone} answers on ${server}`,
      };
    }
    return {
      name,
      status: "warn",
      required: false,
      message: `platform DNS on ${server} answered ${probeName} with ${addresses.join(", ") || "no address"}, not ${target.nameserver}`,
    };
  } catch (error) {
    return {
      name,
      status: "warn",
      required: false,
      message: `platform DNS on ${server} did not answer (${errorCode(error)}); run kore local up`,
    };
  }
}

/**
 * Read-only doctor checks for the host resolver file, the platform domain and,
 * while the cluster runs, the platform DNS. None mutates; none is required.
 * A missing or broken overlay is a warning, so doctor still reports the rest.
 */
export async function resolverChecks(
  environment: Environment,
  runner: Runner,
  host: ResolverHost,
): Promise<ResolverFinding[]> {
  if (!isLocalProvider(environment)) {
    return [];
  }
  const { domain, organizationId } = platformPlan(environment);
  const domainCheck = domainFinding(domain);
  let target: ResolverTarget;
  try {
    target = resolverTarget(environment);
  } catch (error) {
    return [
      {
        name: "host:resolver",
        status: "warn",
        required: false,
        message: errorText(error),
      },
      domainCheck,
    ];
  }
  const findings = [
    await fileFinding(target, environment.name, host),
    domainCheck,
  ];
  if (await clusterRunning(environment, runner)) {
    findings.push(
      await dnsFinding(target, `${organizationId}.${domain}`, host),
    );
  }
  return findings;
}
