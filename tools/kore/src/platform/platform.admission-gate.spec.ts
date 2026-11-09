import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

const events = vi.hoisted(() => [] as string[]);

vi.mock("./bootstrap.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bootstrap.js")>()),
  bootstrapControllers: async () => {
    events.push("bootstrap");
  },
}));
vi.mock("./reconcile.js", () => ({
  reconcileConfiguration: async (
    _r: unknown,
    _n: unknown,
    component: { name: string },
  ) => {
    events.push(`configure:${component.name}`);
  },
}));
vi.mock("../security/index.js", () => ({
  installLocalTrust: async () => {
    events.push("trust");
  },
}));
vi.mock("../tunnel/index.js", () => ({
  startLocalTunnel: async () => {
    events.push("tunnel");
  },
}));

import { platformUp } from "./up.js";

function recordingRunner(inputs: string[]): Runner {
  return {
    async run(command, args, options) {
      if (args.includes("apply")) {
        events.push("apply-gate");
        inputs.push(options?.input ?? "");
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
}

test("platform up finishes the foundation with the application admission gate closed, before it reports ready", async () => {
  events.length = 0;
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-gate-"));
  const repository = { ...base, root };
  const inputs: string[] = [];
  try {
    await platformUp(repository, recordingRunner(inputs));

    const lastConfiguration = events.findLastIndex((event) =>
      event.startsWith("configure:"),
    );
    expect(lastConfiguration).toBeGreaterThan(-1);
    expect(events.indexOf("apply-gate")).toBeGreaterThan(lastConfiguration);
    expect(inputs).toHaveLength(1);
    expect(JSON.parse(inputs[0]!)).toMatchObject({
      kind: "KoreApplicationAdmission",
      spec: { parameters: { state: "closed" } },
    });
    const state = JSON.parse(
      await readFile(join(root, ".kore", "state", "local.json"), "utf8"),
    ) as { status: string };
    expect(state.status).toBe("ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform up never opens the gate", async () => {
  events.length = 0;
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-gate-"));
  const inputs: string[] = [];
  try {
    await platformUp({ ...base, root }, recordingRunner(inputs));
    expect(inputs.join("")).not.toContain('"state":"open"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
