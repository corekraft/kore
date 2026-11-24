// A JSON Schema reader for the keywords the Kore record schemas use: the Service
// XRD's openAPIV3Schema (read from the platform-apis chart) and the ServiceRelease
// schema in infra/catalog/schemas. It needs no dependency (AGENTS.md, Minimal
// dependencies). Every object that declares `properties` is closed: a key it does
// not declare is an error, at every depth (ADR 0166, "the schema rejects any other
// field"). An object without `properties` takes any keys, for a reserved field.

/** A JSON Schema node; only the keywords this reader understands are typed. */
export interface SchemaNode {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minProperties?: number;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  $ref?: string;
  $defs?: Record<string, SchemaNode>;
  [keyword: string]: unknown;
}

export interface SchemaOptions {
  /**
   * Replaces the message for a key the schema does not declare. Returns
   * undefined for the default message, so a caller can name what a key belongs to.
   */
  unknownField?: (fieldPath: string, key: string) => string | undefined;
}

const articles: Record<string, string> = {
  object: "an object",
  array: "an array",
  string: "a string",
  boolean: "a boolean",
  integer: "an integer",
  number: "a number",
};

const join = (path: string, key: string): string =>
  path === "" ? key : `${path}.${key}`;

const suffix = (node: SchemaNode): string =>
  node.description === undefined ? "" : ` (${node.description})`;

function resolve(root: SchemaNode, node: SchemaNode): SchemaNode {
  if (node.$ref === undefined) {
    return node;
  }
  const name = node.$ref.replace(/^#\/\$defs\//, "");
  const target = root.$defs?.[name];
  if (target === undefined) {
    throw new Error(`schema $ref ${node.$ref} names no definition`);
  }
  return resolve(root, target);
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function matchesType(type: string, value: unknown): boolean {
  if (type === "integer") {
    return Number.isInteger(value);
  }
  if (type === "number") {
    return typeof value === "number";
  }
  return typeOf(value) === type;
}

function scalarErrors(
  node: SchemaNode,
  value: unknown,
  path: string,
): string[] {
  const errors: string[] = [];
  if (node.const !== undefined && value !== node.const) {
    errors.push(`${path} must be ${JSON.stringify(node.const)}`);
  }
  if (node.enum !== undefined && !node.enum.includes(value)) {
    errors.push(`${path} must be one of ${node.enum.join(", ")}`);
  }
  if (typeof value === "string") {
    // nosemgrep: kore-dynamic-regexp -- the pattern is a schema the repository owns (the chart's Service XRD or the catalog's ServiceRelease schema), never input from outside
    if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
      errors.push(`${path} must match ${node.pattern}${suffix(node)}`);
    }
    if (node.minLength !== undefined && value.length < node.minLength) {
      errors.push(`${path} must be at least ${node.minLength} characters`);
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      errors.push(`${path} must be at most ${node.maxLength} characters`);
    }
  }
  return errors;
}

function objectErrors(
  root: SchemaNode,
  node: SchemaNode,
  value: Record<string, unknown>,
  path: string,
  options: SchemaOptions,
): string[] {
  const errors: string[] = [];
  const properties = node.properties;
  for (const key of node.required ?? []) {
    if (!(key in value)) {
      const declared = properties?.[key];
      errors.push(
        `${join(path, key)} is required${declared === undefined ? "" : suffix(declared)}`,
      );
    }
  }
  if (
    node.minProperties !== undefined &&
    Object.keys(value).length < node.minProperties
  ) {
    errors.push(
      `${path} must have at least ${node.minProperties} field${node.minProperties === 1 ? "" : "s"}${suffix(node)}`,
    );
  }
  if (properties !== undefined) {
    const allowed = Object.keys(properties);
    for (const key of Object.keys(value)) {
      const fieldPath = join(path, key);
      if (!(key in properties)) {
        errors.push(
          options.unknownField?.(fieldPath, key) ??
            `${fieldPath} is not a field of this record; the fields here are ${allowed.length === 0 ? "none" : allowed.join(", ")}`,
        );
      }
    }
    for (const key of allowed) {
      if (key in value) {
        errors.push(
          ...nodeErrors(
            root,
            properties[key]!,
            value[key],
            join(path, key),
            options,
          ),
        );
      }
    }
  }
  return errors;
}

function nodeErrors(
  root: SchemaNode,
  raw: SchemaNode,
  value: unknown,
  path: string,
  options: SchemaOptions,
): string[] {
  const node = resolve(root, raw);
  if (node.type !== undefined && !matchesType(node.type, value)) {
    return [`${path} must be ${articles[node.type] ?? `a ${node.type}`}`];
  }
  const errors = scalarErrors(node, value, path);
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) {
      errors.push(`${path} must have at least ${node.minItems} items`);
    }
    if (node.maxItems !== undefined && value.length > node.maxItems) {
      errors.push(`${path} must have at most ${node.maxItems} items`);
    }
    if (node.items !== undefined) {
      value.forEach((item, index) => {
        errors.push(
          ...nodeErrors(root, node.items!, item, `${path}[${index}]`, options),
        );
      });
    }
  }
  if (typeOf(value) === "object") {
    errors.push(
      ...objectErrors(
        root,
        node,
        value as Record<string, unknown>,
        path,
        options,
      ),
    );
  }
  return errors;
}

/**
 * The problems of `value` against `schema`, each naming its path from `path`.
 * An empty list means the value conforms. Errors come in schema order, so the
 * same input always reads the same way.
 */
export function schemaErrors(
  schema: SchemaNode,
  value: unknown,
  path: string,
  options: SchemaOptions = {},
): string[] {
  return nodeErrors(schema, schema, value, path, options);
}
