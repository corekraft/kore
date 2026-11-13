import { expect, test } from "vitest";
import { RecordingRunner } from "./runner.js";
import { helmDeadlineMs, withHelmDeadline } from "./helm-timeout.js";

const margin = 120_000;

async function deadline(args: string[], timeoutMs?: number) {
  const inner = new RecordingRunner();
  await withHelmDeadline(inner).run(
    "helm",
    args,
    timeoutMs === undefined ? {} : { timeoutMs },
  );
  return inner.calls[0]!.options?.timeoutMs;
}

test("a mutation may run twice its --timeout plus a margin, since a rollback waits again", async () => {
  expect(await deadline(["upgrade", "x", "--timeout", "10m"])).toBe(
    2 * 600_000 + margin,
  );
  expect(await deadline(["uninstall", "x", "--timeout=90s"])).toBe(
    2 * 90_000 + margin,
  );
  expect(await deadline(["rollback", "x", "1", "--timeout", "1h"])).toBe(
    2 * 3_600_000 + margin,
  );
});

test("an explicit timeoutMs, a read, and other tools are left alone", async () => {
  expect(await deadline(["upgrade", "--timeout", "10m"], 5)).toBe(5);
  expect(await deadline(["get", "values", "x", "--timeout", "10m"])).toBe(
    undefined,
  );
  const inner = new RecordingRunner();
  await withHelmDeadline(inner).run("kubectl", ["apply", "--timeout=10m"]);
  expect(inner.calls[0]!.options).toBeUndefined();
});

test("helmDeadlineMs parses s, m and h and rejects anything else", () => {
  expect(helmDeadlineMs("30s")).toBe(2 * 30_000 + margin);
  expect(helmDeadlineMs("5x")).toBeUndefined();
  expect(helmDeadlineMs("")).toBeUndefined();
});
