// The internal zone of a suborg (spec #1612, issue #1629): the name it owns under the
// internal domain, beside its public zone. A suborg states its internal zone in its
// record, as it states its public zone: the Organization XRD cannot default a suborg's
// zone by its name, so the XRD's own rules refuse any other value. This check mirrors
// them for kore validate, while the platform-hostname-ownership flag is on.
// Docs: docs/decisions/0042-organization-domains-by-delegation.md

import { featureEnabled, platformHostnameOwnershipFlag } from "./features.js";
import { internalDomainOf, platformPlan } from "./platform-domain.js";
import { suborgDefaultZone } from "./suborg-names.js";
import type { Environment } from "./types.js";

/** The internal zone a suborg takes by default: <organization>.<internal domain>. */
export const internalZoneDefault = (
  organization: string,
  internalDomain: string,
): string => `${organization}.${internalDomain}`;

export interface InternalZoneInput {
  /** The record's repository path, which the messages begin with. */
  file: string;
  /** The suborg's name: the file name without .json. */
  organization: string;
  /** The record as read, whose spec.internalZone is checked. */
  manifest: unknown;
  /** The public zone in force, <organization>.<platform domain>. */
  zone: string;
  /** The platform domain in force. */
  domain: string;
  /** The internal domain in force: the platform domain, or internal.<domain> with an external Gateway. */
  internalDomain: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One suborg record as the directory check reads it, with the environment its zones are in. */
export interface SuborgInternalZoneInput {
  environment: Environment;
  env?: NodeJS.ProcessEnv | undefined;
  file: string;
  organization: string;
  manifest: unknown;
}

/**
 * The internal-zone refusals of one suborg record in its environment. The field is
 * rendered only while platform-hostname-ownership is on (spec #1612), so off, none
 * is checked. The public zone in force is the suborg's default zone, which the XRD
 * enforces for every suborg.
 */
export function suborgInternalZoneErrors(
  input: SuborgInternalZoneInput,
): string[] {
  const { environment, env, file, organization, manifest } = input;
  if (!featureEnabled(environment, platformHostnameOwnershipFlag)) {
    return [];
  }
  const { domain } = platformPlan(environment, env);
  return internalZoneErrors({
    file,
    organization,
    manifest,
    zone: suborgDefaultZone(organization, domain),
    domain,
    internalDomain: internalDomainOf(environment, env),
  });
}

/**
 * The refusals of one suborg's internal zone, each naming its field, the rule and the
 * value to set. A record that is not an object is left to the record's own rules.
 * On a platform with an external Gateway the two zones never coincide; on a one-domain
 * platform the default internal zone is the public zone, by design.
 */
export function internalZoneErrors(input: InternalZoneInput): string[] {
  const { file, organization, manifest, zone, domain, internalDomain } = input;
  if (!isRecord(manifest)) {
    return [];
  }
  const spec = isRecord(manifest.spec) ? manifest.spec : {};
  const declared = spec.internalZone;
  const fallback = internalZoneDefault(organization, internalDomain);
  const at = `${file}.spec.internalZone`;
  const setDefault = `set it to ${fallback}, the suborg's default internal zone`;
  if (declared === undefined) {
    return [
      `${at}: is required while platform-hostname-ownership is on; ${setDefault}`,
    ];
  }
  if (typeof declared !== "string") {
    return [`${at}: must be a string, ${setDefault}`];
  }
  if (internalDomain !== domain && declared === zone) {
    return [
      `${at} "${declared}" equals the public zone ${zone}: the two zones of one organization never coincide on a platform with an external Gateway; ${setDefault}`,
    ];
  }
  if (!declared.endsWith(`.${internalDomain}`)) {
    return [
      `${at} "${declared}" is outside the internal domain ${internalDomain}: ${setDefault}`,
    ];
  }
  if (declared !== fallback) {
    return [
      `${at} "${declared}" must be the suborg's default internal zone ${fallback}: a suborg's internal zone is <suborg>.${internalDomain}; set it to ${fallback}`,
    ];
  }
  return [];
}
