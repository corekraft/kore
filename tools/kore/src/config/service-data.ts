// Whether a service has data (ADR 0155): it claims a database, or it declares any
// secret name. The one rule both gate facts read: the record-bump eval and the
// ConfigMap. It fails closed: a field the schema would refuse still counts as data,
// and a record whose spec cannot be read has data. Pure: the caller parses the file.
// Docs: docs/decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A field declares data unless it is absent or an empty list; anything else, even a malformed value, counts. */
const declares = (value: unknown): boolean =>
  value !== undefined && !(Array.isArray(value) && value.length === 0);

/**
 * Whether the parsed spec file's service has data: `spec.databases` or `spec.secrets`
 * declares an entry. A record whose spec is not an object cannot be read, so it is
 * taken as having data rather than as having none.
 */
export function serviceHasData(manifest: unknown): boolean {
  const spec = isRecord(manifest) ? manifest.spec : undefined;
  if (!isRecord(spec)) {
    return true;
  }
  return declares(spec.databases) || declares(spec.secrets);
}
