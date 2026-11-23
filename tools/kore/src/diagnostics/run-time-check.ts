// Docs: docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md
import {
  loadRunTimeFile,
  missingRunTimeValues,
  platformDomainOrigin,
  platformDomainVariable,
  RunTimeFileError,
  runTimeDomainErrors,
  runTimeFilePath,
  runTimeNeededBy,
  runTimeValues,
  type RunTimeFile,
} from "../config/index.js";
import type { Environment } from "../config/index.js";
import type { Check } from "./doctor.js";

/** Reads the run-time file at a path; the default reads the machine's file. */
export type RunTimeFileLoader = (
  path: string,
) => Promise<RunTimeFile | undefined>;

const domainName = "platform-domain";
const valuesName = "run-time values";

/**
 * The platform domain as doctor reports it, never with its value: placeholder
 * while the managed overlay's placeholder is in force, set otherwise. A malformed
 * run-time value fails, because validate refuses it too.
 */
function domainCheck(environment: Environment, env: NodeJS.ProcessEnv): Check {
  if (platformDomainOrigin(environment, env) === "run-time") {
    const [refusal] = runTimeDomainErrors(environment, env);
    return refusal === undefined
      ? {
          name: domainName,
          status: "pass",
          required: false,
          message: `set: from ${platformDomainVariable}`,
        }
      : {
          name: domainName,
          status: "fail",
          required: true,
          message: `invalid: ${refusal}`,
        };
  }
  return environment.provider === "managed"
    ? {
        name: domainName,
        status: "warn",
        required: false,
        message: `placeholder: the overlay's placeholder is in force; set ${platformDomainVariable} in the shell that runs kore to the platform domain`,
      }
    : {
        name: domainName,
        status: "pass",
        required: false,
        message: "set: the local platform domain is in the environment overlay",
      };
}

/**
 * The run-time values the flags that are on need, and whether the environment
 * or the owner-only file supplies each one. The file is read only when a flag
 * that is on needs a value, so a machine with none reads nothing.
 */
async function valuesCheck(
  environment: Environment,
  env: NodeJS.ProcessEnv,
  home: string,
  load: RunTimeFileLoader,
): Promise<Check> {
  const needed = runTimeNeededBy(environment);
  if (needed.length === 0) {
    return {
      name: valuesName,
      status: "pass",
      required: false,
      message: "no flag that is on needs a run-time value",
    };
  }
  const path = runTimeFilePath(home);
  let values: Record<string, string>;
  try {
    values = runTimeValues(await load(path));
  } catch (error) {
    if (error instanceof RunTimeFileError) {
      return {
        name: valuesName,
        status: "warn",
        required: false,
        message: error.message,
      };
    }
    throw error;
  }
  const missing = missingRunTimeValues(needed, env, values);
  return missing.length === 0
    ? {
        name: valuesName,
        status: "pass",
        required: false,
        message: "every run-time value the flags that are on need is set",
      }
    : {
        name: valuesName,
        status: "warn",
        required: false,
        message: `missing run-time values: ${missing.map(({ name, flag }) => `${name} (for ${flag})`).join(", ")}; set each in the shell that runs kore or in ${path}`,
      };
}

/** The run-time checks doctor appends: the platform domain and the run-time values. */
export async function runTimeChecks(
  environment: Environment,
  env: NodeJS.ProcessEnv,
  home: string,
  load: RunTimeFileLoader = loadRunTimeFile,
): Promise<Check[]> {
  return [
    domainCheck(environment, env),
    await valuesCheck(environment, env, home, load),
  ];
}
