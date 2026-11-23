import { describe, expect, it, vi } from "vitest";
import { hostDomains } from "./host.js";

// Factory mocks: the host table only names the three domains, so their modules
// must not load (importing them would cost the spec its time budget).
const fakes = vi.hoisted(() => ({
  hook: { guard: {} },
  session: { spawn: {} },
  skill: { audit: {} },
}));

vi.mock("../hook/index.js", () => ({ hook: fakes.hook }));
vi.mock("../session/index.js", () => ({ session: fakes.session }));
vi.mock("../skill/index.js", () => ({ skill: fakes.skill }));

describe("host domains", () => {
  it("maps the hook, session and skill domains to their own command tables", () => {
    expect(Object.keys(hostDomains)).toEqual(["hook", "session", "skill"]);
    expect(hostDomains["hook"]).toBe(fakes.hook);
    expect(hostDomains["skill"]).toBe(fakes.skill);
  });

  it("adds no command to the session domain: its table is the session barrel's own", () => {
    expect(hostDomains["session"]).toBe(fakes.session);
    expect(hostDomains["session"]).not.toHaveProperty("prompt-size");
  });
});
