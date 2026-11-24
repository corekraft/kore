// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errno, fakeFileSystem } from "./flag-support.js";
import { parseWindow, type AppWindow } from "./app-window-record.js";
import { platformWindows } from "./app-window-store.js";
import { FlagError } from "./overlay.js";

vi.mock("./app-window-record.js");

const ROOT = "/repo";
const DIR = "infra/app-outcomes/local/leads.new-checkout";
const FIRST = `${DIR}/20261123T100000000Z_20261123T110000000Z.json`;
const SECOND = `${DIR}/20261124T100000000Z_20261124T110000000Z.json`;

/** A parsed window for the given flag and environment, with the verdict it holds. */
const parsed = (
  flag: string,
  environment: string,
  result: AppWindow["result"],
): AppWindow => ({ flag, environment, result }) as unknown as AppWindow;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseWindow).mockImplementation(
    (text) => JSON.parse(text) as AppWindow,
  );
});

describe("platformWindows lists the windows recorded for a flag", () => {
  it("returns each record under the flag's directory with its path, flag, environment, kind and result", async () => {
    const fs = fakeFileSystem({
      [`${ROOT}/${FIRST}`]: JSON.stringify({
        flag: "leads.new-checkout",
        environment: "local",
        kind: "verification",
        result: "confirmed",
      }),
    });
    expect(
      await platformWindows(ROOT, fs).list("leads.new-checkout", "local"),
    ).toEqual([
      {
        path: FIRST,
        flag: "leads.new-checkout",
        environment: "local",
        kind: "verification",
        result: "confirmed",
      },
    ]);
  });
});

describe("platformWindows lists records in order and skips what is not a record", () => {
  it("lists the records in name order, so the order does not depend on the file system", async () => {
    const fs = fakeFileSystem({
      [`${ROOT}/${SECOND}`]: "second",
      [`${ROOT}/${FIRST}`]: "first",
    });
    vi.mocked(parseWindow).mockImplementation(
      (text) =>
        ({
          flag: "leads.new-checkout",
          environment: "local",
          kind: "verification",
          result: text === "first" ? "refuted" : "confirmed",
        }) as unknown as AppWindow,
    );
    const found = await platformWindows(ROOT, fs).list(
      "leads.new-checkout",
      "local",
    );
    expect(found.map((w) => w.path)).toEqual([FIRST, SECOND]);
    expect(found.map((w) => w.result)).toEqual(["refuted", "confirmed"]);
  });

  it("returns none for a flag with no window recorded, and none when the store is absent", async () => {
    expect(
      await platformWindows(ROOT, fakeFileSystem()).list(
        "leads.new-checkout",
        "local",
      ),
    ).toEqual([]);
  });

  it("reads only the flag and environment it was asked for", async () => {
    const fs = fakeFileSystem({
      [`${ROOT}/infra/app-outcomes/vps/leads.new-checkout/a.json`]: "other env",
      [`${ROOT}/infra/app-outcomes/local/leads.other/a.json`]: "other flag",
    });
    expect(
      await platformWindows(ROOT, fs).list("leads.new-checkout", "local"),
    ).toEqual([]);
    expect(parseWindow).not.toHaveBeenCalled();
  });

  it("skips a file that is not a record, since only .json files are windows", async () => {
    const fs = fakeFileSystem({
      [`${ROOT}/${DIR}/README.md`]: "notes",
      [`${ROOT}/${FIRST}`]: "window",
    });
    vi.mocked(parseWindow).mockReturnValue(
      parsed("leads.new-checkout", "local", "confirmed"),
    );
    const found = await platformWindows(ROOT, fs).list(
      "leads.new-checkout",
      "local",
    );
    expect(found.map((w) => w.path)).toEqual([FIRST]);
    expect(parseWindow).toHaveBeenCalledTimes(1);
  });
});

describe("platformWindows refuses to read what it cannot trust", () => {
  it("returns none for a flag or environment name that could leave the store", async () => {
    const fs = fakeFileSystem({
      [`${ROOT}/${FIRST}`]: "{}",
    });
    const store = platformWindows(ROOT, fs);
    expect(await store.list("../leads.new-checkout", "local")).toEqual([]);
    expect(await store.list("leads.new-checkout", "local/../vps")).toEqual([]);
    expect(parseWindow).not.toHaveBeenCalled();
  });

  it("refuses a record that does not parse, so a broken window is never read as no window", async () => {
    vi.mocked(parseWindow).mockImplementation(() => {
      throw new FlagError(`${FIRST} is not JSON`);
    });
    const fs = fakeFileSystem({ [`${ROOT}/${FIRST}`]: "result: confirmed" });
    await expect(
      platformWindows(ROOT, fs).list("leads.new-checkout", "local"),
    ).rejects.toThrow(`${FIRST} is not JSON`);
  });

  it("refuses a record that names another flag or environment than its directory", async () => {
    vi.mocked(parseWindow).mockReturnValue(
      parsed("leads.other", "local", "confirmed"),
    );
    const fs = fakeFileSystem({ [`${ROOT}/${FIRST}`]: "{}" });
    await expect(
      platformWindows(ROOT, fs).list("leads.new-checkout", "local"),
    ).rejects.toThrow(
      `${FIRST} records flag leads.other in local, not leads.new-checkout in local`,
    );
  });

  it("rethrows a store it cannot read, rather than treating it as empty", async () => {
    const fs = fakeFileSystem(
      {},
      {
        readdir: () => Promise.reject(errno("EACCES", "EACCES: store")),
      },
    );
    await expect(
      platformWindows(ROOT, fs).list("leads.new-checkout", "local"),
    ).rejects.toThrow("EACCES: store");
  });
});
