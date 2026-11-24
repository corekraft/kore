import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Digest } from "./digest.js";
import { RolloutError, readRolloutLocks } from "./locks.js";

vi.mock("./digest.js");

const SIGNER =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v1.4.0";
const ENTRY_DIGEST = `sha256:${"b".repeat(64)}`;

const chartLock = (signers: unknown, entries?: unknown) =>
  JSON.stringify({
    version: 1,
    authorizedSigners: signers,
    entries: entries ?? {
      "cert-manager": {
        chart: "ghcr.io/corekraft/charts/cert-manager",
        version: "v1.19.1",
        digest: ENTRY_DIGEST,
        signer: SIGNER,
      },
    },
  });
const imageLock = (signers: unknown) =>
  JSON.stringify({ version: 1, authorizedSigners: signers, entries: {} });

const read = (
  chart = chartLock([SIGNER]),
  image = imageLock([SIGNER]),
  tag = "v1.4.0",
) => readRolloutLocks({ tag, chart, image });

beforeEach(() => {
  vi.mocked(sha256Digest).mockImplementation(
    (text) => `sha256:${text.length.toString(16).padStart(64, "0")}`,
  );
});

describe("readRolloutLocks", () => {
  it("returns the digest of each lock file and each chart's name, version and entry digest", () => {
    const chart = chartLock([SIGNER]);
    const image = imageLock([SIGNER]);

    expect(read(chart, image)).toEqual({
      chartLock: sha256Digest(chart),
      imageLock: sha256Digest(image),
      charts: [
        { name: "cert-manager", version: "v1.19.1", digest: ENTRY_DIGEST },
      ],
    });
    expect(sha256Digest).toHaveBeenCalledWith(chart);
    expect(sha256Digest).toHaveBeenCalledWith(image);
  });
});

describe("readRolloutLocks refuses a lock that is not the release's", () => {
  it.each([
    [
      "a main chart lock signed by a branch identity",
      chartLock([
        "https://github.com/corekraft/kore/.github/workflows/main.yaml@refs/heads/main",
      ]),
      imageLock([SIGNER]),
      "chart lock",
    ],
    [
      "a lock that names no signer",
      chartLock([]),
      imageLock([SIGNER]),
      "chart lock",
    ],
    [
      "a lock whose signer list is missing",
      chartLock(undefined),
      imageLock([SIGNER]),
      "chart lock",
    ],
    [
      "an image lock signed at another tag",
      chartLock([SIGNER]),
      imageLock([SIGNER.replace("v1.4.0", "v1.3.0")]),
      "image lock",
    ],
    [
      "a lock where only one of two signers is the release",
      chartLock([SIGNER, "https://example.com/other@refs/tags/v1.4.0"]),
      imageLock([SIGNER]),
      "chart lock",
    ],
    [
      "a signer from another workflow at the tag",
      chartLock([SIGNER.replace("release.yaml", "build.yaml")]),
      imageLock([SIGNER]),
      "chart lock",
    ],
  ])("refuses %s, naming which lock", (_title, chart, image, which) => {
    expect(() => read(chart, image)).toThrow(RolloutError);
    expect(() => read(chart, image)).toThrow(which);
    expect(() => read(chart, image)).toThrow("release.yaml@refs/tags/v1.4.0");
  });
});

describe("readRolloutLocks refuses a malformed input", () => {
  it.each(["main", "v1.4", "1.4.0", "v1.4.0-rc1"])(
    "refuses the tag %s before reading either lock",
    (tag) => {
      expect(() => read(chartLock([SIGNER]), imageLock([SIGNER]), tag)).toThrow(
        "release tag",
      );
      expect(sha256Digest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["not JSON", "{nope", "chart lock"],
    ["not a version 1 lock", JSON.stringify({ version: 2 }), "chart lock"],
    [
      "a chart with no version",
      chartLock([SIGNER], { x: { digest: ENTRY_DIGEST } }),
      "chart lock",
    ],
    [
      "a chart with a malformed digest",
      chartLock([SIGNER], { x: { version: "1.0.0", digest: "abc" } }),
      "chart lock",
    ],
    ["an empty set of charts", chartLock([SIGNER], {}), "chart lock"],
  ])("refuses a chart lock that is %s", (_title, chart, which) => {
    expect(() => read(chart)).toThrow(which);
  });

  it("refuses an image lock that is not JSON", () => {
    expect(() => read(chartLock([SIGNER]), "{nope")).toThrow("image lock");
  });
});
