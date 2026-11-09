type Schema = Record<string, unknown>;

function schema(value: unknown): Schema {
  return value !== null && typeof value === "object" ? (value as Schema) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function at(path: string, name: string): string {
  return path === "" ? name : `${path}.${name}`;
}

function scalarProblems(path: string, before: Schema, after: Schema): string[] {
  const problems: string[] = [];
  if (before.type !== after.type) {
    problems.push(
      `${path}: type changed from ${String(before.type)} to ${String(after.type)}`,
    );
  }
  const enumBefore = strings(before.enum);
  const enumAfter = new Set(strings(after.enum));
  if (after.enum !== undefined) {
    for (const value of enumBefore.filter((v) => !enumAfter.has(v))) {
      problems.push(`${path}: enum value ${value} removed`);
    }
  }
  if (before.pattern !== after.pattern) {
    problems.push(`${path}: pattern changed`);
  }
  return problems;
}

/**
 * Ways `after` rejects a resource `before` accepted: removed or retyped
 * properties, newly required fields, narrowed enums or patterns. Additive
 * changes are compatible. `path` names the property in the messages.
 */
export function schemaProblems(
  before: unknown,
  after: unknown,
  path = "",
): string[] {
  const old = schema(before);
  const next = schema(after);
  const problems = path === "" ? [] : scalarProblems(path, old, next);
  const label = path === "" ? "schema" : path;
  const required = new Set(strings(old.required));
  for (const field of strings(next.required).filter((f) => !required.has(f))) {
    problems.push(`${label}: field ${field} became required`);
  }
  const oldProps = schema(old.properties);
  const newProps = schema(next.properties);
  for (const name of Object.keys(oldProps)) {
    const child = at(path, name);
    if (!(name in newProps)) {
      problems.push(`${child}: property removed`);
      continue;
    }
    problems.push(...schemaProblems(oldProps[name], newProps[name], child));
  }
  return problems;
}
