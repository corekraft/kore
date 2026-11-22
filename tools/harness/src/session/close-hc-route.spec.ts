import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { close } from "./close.js";
import { closeHcSession } from "./close-hc-command.js";
import {
  WITHOUT_WORKTREE,
  asRegistry,
  fakeRegistry,
  scene,
} from "./close-support.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

vi.mock("./close-hc-command.js", () => ({ closeHcSession: vi.fn() }));
// A plain object, not the class: a static method reference would be an unbound method.
const opener = vi.hoisted(() => ({
  open: vi.fn<(deps: CliDeps) => Promise<SessionRegistry>>(),
}));
vi.mock("./registry.js", () => ({ SessionRegistry: opener }));

beforeEach(() => {
  vi.mocked(closeHcSession).mockResolvedValue(0);
});

describe("session close hands a starting hc record, which has no terminal, to hc instead of refusing it", () => {
  it("reaches closeHcSession, since routing would only send the caller back to this command", async () => {
    const starting = {
      ...WITHOUT_WORKTREE,
      backend: "hc",
      paneId: "",
      starting: true,
    } as unknown as SessionRecord;
    opener.open.mockResolvedValue(asRegistry(fakeRegistry(starting)));
    const s = scene();

    expect(await close(s.context)).toBe(0);

    expect(closeHcSession).toHaveBeenCalledExactlyOnceWith(
      s.context,
      expect.anything(),
      expect.anything(),
      starting,
    );
    expect(s.runner.run).not.toHaveBeenCalled();
  });
});
