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
    expect(hostDomains).toEqual({
      hook: fakes.hook,
      session: fakes.session,
      skill: fakes.skill,
    });
    expect(Object.keys(hostDomains)).toEqual(["hook", "session", "skill"]);
  });
});
