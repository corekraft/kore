import { describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import type { CommandContext } from "../runtime/index.js";
import { domains } from "./domains.js";

// Factory mocks: the table only assembles the other domains' exports, so none of
// their modules load (importing them would cost the spec its time budget).
const fakes = vi.hoisted(() => ({
  adrCommands: { adr: {} },
  guardrailCommands: { guardrail: {} },
  planActive: vi.fn(),
  planTick: vi.fn(),
  planNext: vi.fn(),
  planClearNext: vi.fn(),
  hostDomains: { hook: {}, session: {}, skill: {} },
  measurement: { measure: {} },
  records: { record: {} },
}));

vi.mock("../adr/index.js", () => ({ adrCommands: fakes.adrCommands }));
vi.mock("../guardrail/index.js", () => ({
  guardrailCommands: fakes.guardrailCommands,
}));
vi.mock("../plan/index.js", () => ({
  planActive: fakes.planActive,
  planClearNext: fakes.planClearNext,
  planNext: fakes.planNext,
  planTick: fakes.planTick,
}));
vi.mock("./host.js", () => ({ hostDomains: fakes.hostDomains }));
vi.mock("./measurement.js", () => ({ measurement: fakes.measurement }));
vi.mock("./records.js", () => ({ records: fakes.records }));

function contextOf(json: boolean) {
  const stdout = vi.fn();
  const context = { json, deps: { stdout } } as unknown as CommandContext;
  return { context, stdout };
}

describe("domain table", () => {
  it("routes each domain to its own command table, and spreads the record and measurement domains in", () => {
    expect(domains.plan).toEqual({
      active: fakes.planActive,
      tick: fakes.planTick,
      next: fakes.planNext,
      "clear-next": fakes.planClearNext,
    });
    expect(domains.adr).toBe(fakes.adrCommands);
    expect(domains.guardrail).toBe(fakes.guardrailCommands);
    expect(domains.hook).toBe(fakes.hostDomains.hook);
    expect(domains.session).toBe(fakes.hostDomains.session);
    expect(domains.skill).toBe(fakes.hostDomains.skill);
    expect(domains).toEqual(
      expect.objectContaining({ ...fakes.records, ...fakes.measurement }),
    );
  });

  it("prints the package version as text by default", async () => {
    const { context, stdout } = contextOf(false);
    expect(await domains.harness?.version?.run(context)).toBe(0);
    expect(stdout).toHaveBeenCalledWith(`harness ${pkg.version}\n`);
  });

  it("prints the package version as JSON under --json", async () => {
    const { context, stdout } = contextOf(true);
    await domains.harness?.version?.run(context);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({ version: pkg.version })}\n`,
    );
  });
});
