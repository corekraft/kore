// What the harness config parsers share: the failure shape, a plain-object check, and the one
// message form that names the file, the key and the fix.

export type Failure = { error: string };
export type Raw = Record<string, unknown>;

export const isObject = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function bad(file: string, key: string, fix: string): Failure {
  return { error: `Invalid ${file}: key "${key}" ${fix}` };
}
