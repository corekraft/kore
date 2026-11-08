function printList(items: unknown[]): void {
  for (const item of items) {
    console.log(
      typeof item === "object"
        ? Object.values(item as Record<string, unknown>).join("\t")
        : String(item as string),
    );
  }
}

function printRecord(record: Record<string, unknown>): void {
  for (const [key, item] of Object.entries(record)) {
    console.log(
      `${key}: ${typeof item === "string" ? item : JSON.stringify(item)}`,
    );
  }
}

export function print(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (Array.isArray(value)) {
    printList(value);
  } else if (typeof value === "object") {
    printRecord(value as Record<string, unknown>);
  } else {
    console.log(String(value as string | number | boolean | undefined));
  }
}
