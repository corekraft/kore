import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Ledger,
  firstIdeaStateChange,
  isName,
  type IdeaState,
} from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { ideaWaits, readIdeaTarget } from "./wait-idea-target.js";

vi.mock("../ledger/index.js", () => ({
  DEFAULT_LEDGER: ".kore/state/ledger.jsonl",
  Ledger: vi.fn(),
  firstIdeaStateChange: vi.fn(),
  isName: vi.fn(),
}));
vi.mock("../runtime/index.js", () => ({ mainRoot: vi.fn() }));

const SINCE = "2026-01-02T03:04:05.000Z";
const list = vi.fn();
const deps = {
  root: () => Promise.resolve("/checkout"),
  fs: {},
  clock: {},
  ids: {},
} as unknown as CliDeps;

beforeEach(() => {
  vi.resetAllMocks();
  list.mockResolvedValue({ events: [], skipped: 0 });
  vi.mocked(Ledger).mockImplementation(function () {
    return { list } as unknown as Ledger;
  });
  vi.mocked(mainRoot).mockResolvedValue("/main");
});

describe("readIdeaTarget reads the main checkout's ledger once for a state change", () => {
  it("reads the ledger under the main checkout and settles on the first change it shows", async () => {
    const change: IdeaState = {
      idea: "0007",
      state: "outcome:confirmed",
      at: "2026-01-02T04:00:00.000Z",
    };
    vi.mocked(firstIdeaStateChange).mockReturnValue(change);

    expect(await readIdeaTarget(deps, { idea: "0007" }, SINCE)).toStrictEqual({
      kind: "settled",
      idea: "0007",
      state: "outcome:confirmed",
    });
    expect(Ledger).toHaveBeenCalledWith(
      deps.fs,
      deps.clock,
      deps.ids,
      join("/main", ".kore/state/ledger.jsonl"),
    );
    expect(firstIdeaStateChange).toHaveBeenCalledWith([], SINCE, "0007");
  });

  it("passes no idea when the target is any idea, so a change to any idea counts", async () => {
    const events = [{ kind: "idea.filed" }];
    list.mockResolvedValue({ events, skipped: 0 });
    vi.mocked(firstIdeaStateChange).mockReturnValue({
      idea: "#7",
      state: "approved",
      at: SINCE,
    });

    expect(
      await readIdeaTarget(deps, { idea: undefined }, SINCE),
    ).toStrictEqual({
      kind: "settled",
      idea: "#7",
      state: "approved",
    });
    expect(firstIdeaStateChange).toHaveBeenCalledWith(events, SINCE, undefined);
  });

  it("reports pending when the ledger shows no state change after the wait began", async () => {
    vi.mocked(firstIdeaStateChange).mockReturnValue(undefined);

    expect(await readIdeaTarget(deps, { idea: "0007" }, SINCE)).toStrictEqual({
      kind: "pending",
    });
  });

  it("falls back to the checkout root when there is no main checkout to keep the ledger in", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);
    vi.mocked(firstIdeaStateChange).mockReturnValue(undefined);

    await readIdeaTarget(deps, { idea: undefined }, SINCE);

    expect(Ledger).toHaveBeenCalledWith(
      deps.fs,
      deps.clock,
      deps.ids,
      join("/checkout", ".kore/state/ledger.jsonl"),
    );
  });
});

describe("ideaWaits turns the --idea names and --any-idea into the waits to run, or the usage to refuse", () => {
  it("gives one wait per named idea, in the order given", () => {
    vi.mocked(isName).mockReturnValue(true);

    expect(ideaWaits(["0007", "#7"], false)).toStrictEqual({
      waits: [{ idea: "0007" }, { idea: "#7" }],
    });
  });

  it("gives one wait on any idea for --any-idea, and none when no idea is named", () => {
    expect(ideaWaits([], true)).toStrictEqual({ waits: [{ idea: undefined }] });
    expect(ideaWaits([], false)).toStrictEqual({ waits: [] });
  });

  it("refuses --idea and --any-idea together, since they name different waits", () => {
    expect(ideaWaits(["0007"], true)).toStrictEqual({
      usage:
        "Give either --idea <name> or --any-idea, not both: --idea waits on one idea, --any-idea on any.",
    });
  });

  it("refuses an idea name the ledger would refuse, naming it", () => {
    vi.mocked(isName).mockReturnValue(false);

    expect(ideaWaits(["bad name"], false)).toStrictEqual({
      usage:
        'Invalid --idea "bad name": give an idea name, such as --idea 0007 or --idea #7.',
    });
  });
});
