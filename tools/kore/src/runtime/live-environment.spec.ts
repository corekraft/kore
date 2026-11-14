import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSet, liveEnvironment } from "./live-environment.js";

vi.mock("node:fs");
vi.mock("node:path");

const ROOT = "/repo";

/** A repository with the named environments (plus a `common` directory with none). */
function repositoryWith(...names: string[]): void {
  const files = new Set([
    `${ROOT}/infra/catalog/components.yaml`,
    ...names.map(
      (name) => `${ROOT}/infra/environments/${name}/environment.yaml`,
    ),
  ]);
  vi.mocked(existsSync).mockImplementation((path) => files.has(String(path)));
  vi.mocked(readdirSync).mockReturnValue(
    [...names, "common"].map((name) => ({
      name,
      isDirectory: () => true,
    })) as never,
  );
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(resolve).mockImplementation((path) => path);
  vi.mocked(dirname).mockImplementation(
    (path) => path.slice(0, path.lastIndexOf("/")) || "/",
  );
  process.env.KORE_ROOT = ROOT;
});

afterEach(() => {
  delete process.env.KORE_LIVE_ENVIRONMENT;
  delete process.env.KORE_INTEGRATION_ENVIRONMENT;
  delete process.env.KORE_ROOT;
});

describe("liveEnvironment", () => {
  it("tests the local environment when the variable is unset", () => {
    repositoryWith("local", "scratch");

    expect(liveEnvironment()).toBe("local");
  });

  it("counts an empty KORE_LIVE_ENVIRONMENT as unset", () => {
    repositoryWith("local", "scratch");
    process.env.KORE_LIVE_ENVIRONMENT = "";

    expect(liveEnvironment()).toBe("local");
  });

  it("tests the environment KORE_LIVE_ENVIRONMENT names", () => {
    repositoryWith("local", "scratch");
    process.env.KORE_LIVE_ENVIRONMENT = "scratch";

    expect(liveEnvironment()).toBe("scratch");
  });

  it("refuses the retired KORE_INTEGRATION_ENVIRONMENT, naming its replacement, and never reads it as local", () => {
    repositoryWith("local", "scratch");
    process.env.KORE_INTEGRATION_ENVIRONMENT = "scratch";

    expect(() => liveEnvironment()).toThrow(
      /KORE_INTEGRATION_ENVIRONMENT is retired; set KORE_LIVE_ENVIRONMENT/,
    );
  });

  it("refuses an environment the repository does not define, naming the variable and the valid ones", () => {
    repositoryWith("scratch", "local");
    process.env.KORE_LIVE_ENVIRONMENT = "nope";

    expect(() => liveEnvironment()).toThrow(
      'KORE_LIVE_ENVIRONMENT="nope" is not an environment of this repository; use one of: local, scratch, or unset it for local',
    );
  });

  it("lists only directories that define an environment, and never the shared common one", () => {
    repositoryWith("local");
    process.env.KORE_LIVE_ENVIRONMENT = "common";

    expect(() => liveEnvironment()).toThrow(/use one of: local,/);
  });

  it("reads the environments under KORE_ROOT when it is set", () => {
    repositoryWith("local");

    liveEnvironment("/somewhere/else");

    expect(readdirSync).toHaveBeenCalledWith(`${ROOT}/infra/environments`, {
      withFileTypes: true,
    });
  });

  it("finds the repository by walking up from the start directory", () => {
    delete process.env.KORE_ROOT;
    repositoryWith("local");
    vi.mocked(existsSync).mockImplementation(
      (path) =>
        path === "/work/kore/infra/catalog/components.yaml" ||
        path === "/work/kore/infra/environments/local/environment.yaml",
    );
    vi.mocked(readdirSync).mockReturnValue([
      { name: "local", isDirectory: () => true },
    ] as never);

    expect(liveEnvironment("/work/kore/tools/kore")).toBe("local");
    expect(readdirSync).toHaveBeenCalledWith("/work/kore/infra/environments", {
      withFileTypes: true,
    });
  });

  it("refuses to run outside a Kore repository, naming how to point at one", () => {
    delete process.env.KORE_ROOT;
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => liveEnvironment("/tmp/elsewhere")).toThrow(
      "not inside a Kore repository (set KORE_ROOT to override)",
    );
  });
});

describe("isSet", () => {
  it("counts a variable with a value as set, and one that is unset or empty as not", () => {
    expect(isSet("x")).toBe(true);
    expect(isSet("")).toBe(false);
    expect(isSet(undefined)).toBe(false);
  });
});
