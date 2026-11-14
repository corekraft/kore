// Docs: docs/decisions/0077-live-proof-gates-activation-not-merge.md
import { describe, expect, it } from "vitest";
import {
  environments,
  FlagError,
  readOverlay,
  withFlagOn,
  type Overlay,
} from "./overlay.js";
import { errno, fakeFileSystem } from "./flag-support.js";

const ROOT = "/repo";
const PATH = "infra/environments/local/environment.yaml";
const overlayPath = (environment: string) =>
  `${ROOT}/infra/environments/${environment}/environment.yaml`;

/** An overlay as prettier writes it, with the given features value. */
const text = (features: string) =>
  `{\n  "name": "local",\n  "features": ${features},\n  "imageInventory": "audit"\n}\n`;

const TWO_FLAGS = text(
  '{ "ingress-agentgateway": false, "other-flag": false }',
);

/** An overlay read from the given text; withFlagOn reads only its text and path. */
const overlayOf = (body: string): Overlay => ({
  environment: "local",
  path: PATH,
  text: body,
  features: {},
});

describe("environments", () => {
  it("lists the environments that have an overlay, in name order", async () => {
    const fs = fakeFileSystem({
      [overlayPath("managed-example")]: TWO_FLAGS,
      [overlayPath("local")]: TWO_FLAGS,
    });
    expect(await environments(fs, ROOT)).toEqual(["local", "managed-example"]);
  });

  it("treats a missing environments directory as having none", async () => {
    expect(await environments(fakeFileSystem(), ROOT)).toEqual([]);
  });

  it("skips a file beside the environment directories, which is not an environment", async () => {
    const fs = fakeFileSystem(
      {
        [overlayPath("local")]: TWO_FLAGS,
        [`${ROOT}/infra/environments/schema.json`]: "{}",
      },
      {
        exists: (path) =>
          path.includes("schema.json/")
            ? Promise.reject(errno("ENOTDIR"))
            : Promise.resolve(path === overlayPath("local")),
      },
    );
    expect(await environments(fs, ROOT)).toEqual(["local"]);
  });

  it("rethrows an error other than ENOTDIR when checking an entry", async () => {
    const fs = fakeFileSystem(
      { [overlayPath("local")]: TWO_FLAGS },
      { exists: () => Promise.reject(errno("EIO")) },
    );
    await expect(environments(fs, ROOT)).rejects.toMatchObject({ code: "EIO" });
  });

  it("names the directory and the cause when it cannot be read", async () => {
    const fs = fakeFileSystem(
      {},
      { readdir: () => Promise.reject(errno("EACCES", "permission denied")) },
    );
    await expect(environments(fs, ROOT)).rejects.toThrow(
      new FlagError(
        "Cannot read infra/environments (permission denied); fix its permissions, then rerun.",
      ),
    );
  });
});

describe("readOverlay", () => {
  it("reads the overlay's path, text and features map", async () => {
    const fs = fakeFileSystem({ [overlayPath("local")]: TWO_FLAGS });
    expect(await readOverlay(fs, ROOT, "local")).toEqual({
      environment: "local",
      path: PATH,
      text: TWO_FLAGS,
      features: { "ingress-agentgateway": false, "other-flag": false },
    });
  });

  it("reads an overlay without a features map as having none", async () => {
    const fs = fakeFileSystem({ [overlayPath("local")]: '{"name": "local"}' });
    expect((await readOverlay(fs, ROOT, "local")).features).toEqual({});
  });

  it("refuses an environment with no overlay, naming the ones that exist", async () => {
    const fs = fakeFileSystem({ [overlayPath("local")]: TWO_FLAGS });
    await expect(readOverlay(fs, ROOT, "nowhere")).rejects.toThrow(
      'No environment "nowhere" has an overlay at infra/environments/nowhere/environment.yaml. Environments: local.',
    );
  });

  it("says there are no environments when none has an overlay", async () => {
    await expect(readOverlay(fakeFileSystem(), ROOT, "local")).rejects.toThrow(
      "Environments: none.",
    );
  });

  it.each([
    ["text that is not JSON", "name: [unterminated"],
    ["a JSON array", "[]"],
    ["a JSON null", "null"],
  ])("refuses an overlay that is %s, naming the file", async (_, body) => {
    const fs = fakeFileSystem({ [overlayPath("local")]: body });
    await expect(readOverlay(fs, ROOT, "local")).rejects.toThrow(
      `${PATH} is not a JSON object`,
    );
  });

  it.each([
    ["a flag set to a string", '{ "a": "yes" }'],
    ["a flag set to a number", '{ "a": 1 }'],
    ["a features value that is not a map", '"on"'],
  ])("refuses a features map with %s (ADR 0077)", async (_, features) => {
    const fs = fakeFileSystem({ [overlayPath("local")]: text(features) });
    await expect(readOverlay(fs, ROOT, "local")).rejects.toThrow(
      "features map that is not flag name to boolean (ADR 0077)",
    );
  });
});

describe("withFlagOn", () => {
  it("turns one false flag on and leaves every other byte unchanged", () => {
    expect(withFlagOn(overlayOf(TWO_FLAGS), "ingress-agentgateway")).toBe(
      text('{ "ingress-agentgateway": true, "other-flag": false }'),
    );
  });

  it("matches the whole flag name, not a longer name that starts with it", () => {
    const before = text(
      '{ "ingress-agentgateway-extra": false, "ingress-agentgateway": false }',
    );
    expect(withFlagOn(overlayOf(before), "ingress-agentgateway")).toBe(
      text(
        '{ "ingress-agentgateway-extra": false, "ingress-agentgateway": true }',
      ),
    );
  });

  it("edits only the features map, never a key of the same name outside it", () => {
    const body = `{\n  "x": false,\n  "features": { "y": false }\n}\n`;
    expect(() => withFlagOn(overlayOf(body), "x")).toThrow(FlagError);
  });

  it("refuses a flag the features map writes as true", () => {
    expect(() =>
      withFlagOn(
        overlayOf(text('{ "ingress-agentgateway": true }')),
        "ingress-agentgateway",
      ),
    ).toThrow(
      `${PATH} does not write ingress-agentgateway as false inside its features map`,
    );
  });

  it("refuses a flag the features map does not write at all", () => {
    expect(() => withFlagOn(overlayOf(TWO_FLAGS), "missing-flag")).toThrow(
      FlagError,
    );
  });

  it("refuses an overlay with no features key", () => {
    expect(() =>
      withFlagOn(overlayOf('{\n  "name": "local"\n}\n'), "x"),
    ).toThrow(FlagError);
  });

  it("refuses a features map whose braces never close", () => {
    expect(() =>
      withFlagOn(overlayOf('{ "features": { "x": false'), "x"),
    ).toThrow(FlagError);
  });
});
