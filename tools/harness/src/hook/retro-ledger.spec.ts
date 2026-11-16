// The ledger as the retro scan reads it for bare sends: the role each session name
// was launched as. The ledger and the main checkout are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger, type LedgerEvent } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { sessionRoles } from "./retro-ledger.js";

vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));
vi.mock("../ledger/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ledger/index.js")>()),
  Ledger: vi.fn(),
}));

const list = vi.fn<Ledger["list"]>();
const deps = {} as CliDeps;

const launch = (
  recordedAt: string,
  agent: string | undefined,
  role: string | undefined,
  kind = "session.launch",
) =>
  ({
    id: "e",
    kind,
    recordedAt,
    ...(agent === undefined ? {} : { agent }),
    ...(role === undefined ? {} : { role }),
  }) as LedgerEvent;

beforeEach(() => {
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(Ledger).mockImplementation(function () {
    return { list } as unknown as Ledger;
  });
  list.mockResolvedValue({ events: [], skipped: 0 });
});

describe("sessionRoles", () => {
  it("maps each launched session name to its role, the later launch winning a name used twice", async () => {
    list.mockResolvedValue({
      events: [
        launch("2026-11-12T00:00:00Z", "writer-a", "writer"),
        launch("2026-11-10T00:00:00Z", "fixer-b", "fixer"),
        launch("2026-11-13T00:00:00Z", "writer-a", "judge"),
      ],
      skipped: 0,
    });
    expect(await sessionRoles(deps)).toEqual({
      "fixer-b": "fixer",
      "writer-a": "judge",
    });
  });

  it("leaves out events that are not launches and launches that name no session or role", async () => {
    list.mockResolvedValue({
      events: [
        launch("2026-11-12T00:00:00Z", "writer-a", "writer", "guard.block"),
        launch("2026-11-12T00:00:00Z", undefined, "writer"),
        launch("2026-11-12T00:00:00Z", "fixer-b", undefined),
      ],
      skipped: 0,
    });
    expect(await sessionRoles(deps)).toEqual({});
  });

  it("is empty without a main checkout, and reads no ledger", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);
    expect(await sessionRoles(deps)).toEqual({});
    expect(list).not.toHaveBeenCalled();
  });
});
