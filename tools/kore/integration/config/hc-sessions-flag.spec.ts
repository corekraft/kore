import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";

// Docs: infra/plans/16-hc-native-sessions.md (Step 1, the hc-sessions flag)

const FLAG = "hc-sessions";

async function environmentNames(): Promise<string[]> {
  const root = await findRoot();
  const names: string[] = [];
  for (const name of await readdir(join(root, "infra/environments"))) {
    const overlay = join(root, "infra/environments", name, "environment.yaml");
    if (
      await access(overlay).then(
        () => true,
        () => false,
      )
    ) {
      names.push(name);
    }
  }
  return names.sort();
}

// local turned the flag on after a recorded live outcome under the owner waiver
// (#1887); every other overlay lists it off.
const ON = new Set(["local"]);

test("every environment overlay lists the hc-sessions flag, so the flag manifest is complete", async () => {
  const names = await environmentNames();
  assert.ok(names.length > 0, "at least one environment overlay exists");
  const listed: Record<string, unknown> = {};
  for (const name of names) {
    const { environment } = await loadRepository(name);
    listed[name] = environment.features?.[FLAG];
  }
  assert.deepEqual(
    listed,
    Object.fromEntries(names.map((name) => [name, ON.has(name)])),
  );
});
