// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FlagError,
  progressOf,
  readManifest,
  readOverlay,
  recordedProofs,
  renderProgress,
  type ProgressReport,
} from "../flag/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { fakeContext } from "./command-support.js";
import { openLedger } from "./ledger-commands.js";
import { progress } from "./flag-progress-command.js";
import { flagCommands } from "./flag-commands.js";

vi.mock("../idea/index.js", () => ({ IdeaRepository: vi.fn() }));
vi.mock("./ledger-commands.js");
vi.mock("../flag/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flag/index.js")>()),
  progressOf: vi.fn(),
  readManifest: vi.fn(),
  readOverlay: vi.fn(),
  recordedProofs: vi.fn(),
  renderProgress: vi.fn(),
}));

const FAILED = 1;
const PATH = "infra/environments/vps/environment.yaml";
const MANIFEST = [
  {
    name: "in-cluster-ca",
    kind: "environment" as const,
    applies: ["vps"],
    requires: [],
    pending: false,
    notApplicable: [],
  },
];
const PROOFS = new Map();
const REPORT: ProgressReport = {
  environment: "vps",
  path: PATH,
  production: true,
  environmentFlags: [
    {
      flag: "in-cluster-ca",
      kind: "environment",
      on: true,
      proof: "none",
      waitsOn: [],
    },
  ],
  features: [],
  excluded: [],
  everyApplicableFlagOn: false,
  next: { flag: "in-cluster-ca", kind: "environment" },
};
const RELEASE_LOCK = JSON.stringify({
  version: 1,
  entries: {
    cilium: { chart: "cilium", version: "1.0.0", digest: "sha256:aa" },
  },
});

/** A progress command's context: the vps environment, with the given options. */
const progressContext = (overrides: Partial<CommandContext> = {}) =>
  fakeContext({ options: { environment: "vps" }, ...overrides });

function command(): Command {
  const found = flagCommands["progress"];
  if (found === undefined) {
    throw new Error("flag commands have no progress command");
  }
  return found;
}

beforeEach(() => {
  vi.mocked(readOverlay).mockResolvedValue({
    environment: "vps",
    path: PATH,
    text: "",
    features: { "in-cluster-ca": true },
    production: true,
  });
  vi.mocked(readManifest).mockResolvedValue(MANIFEST);
  vi.mocked(recordedProofs).mockResolvedValue(PROOFS);
  vi.mocked(progressOf).mockReturnValue(REPORT);
  vi.mocked(renderProgress).mockReturnValue("TEXT\n");
});

describe("flag progress refusals before any read of the report", () => {
  it("refuses a command with no --environment, naming the usage, and reads nothing", async () => {
    const { context, err, out } = progressContext({ options: {} });
    expect(await progress.run(context)).toBe(FAILED);
    expect(err()).toBe(
      "Missing --environment; run `harness flag progress --environment <env>`.\n",
    );
    expect(out()).toBe("");
    expect(readOverlay).not.toHaveBeenCalled();
  });

  it("refuses an environment with no overlay, naming it on stderr", async () => {
    vi.mocked(readOverlay).mockRejectedValue(
      new FlagError(
        'No environment "nope" has an overlay at infra/environments/nope/environment.yaml. Environments: vps.',
      ),
    );
    const { context, err, out } = progressContext({
      options: { environment: "nope" },
    });
    expect(await progress.run(context)).toBe(FAILED);
    expect(err()).toBe(
      'No environment "nope" has an overlay at infra/environments/nope/environment.yaml. Environments: vps.\n',
    );
    expect(out()).toBe("");
  });
});

describe("flag progress reads the overlay, the manifest and the recorded proofs", () => {
  it("prints the text report, built from the overlay's features and production mark, and writes nothing", async () => {
    const { context, out, writeFile } = progressContext();
    expect(await progress.run(context)).toBe(0);
    expect(progressOf).toHaveBeenCalledWith({
      environment: "vps",
      path: PATH,
      production: true,
      manifest: MANIFEST,
      features: { "in-cluster-ca": true },
      proofs: PROOFS,
    });
    expect(renderProgress).toHaveBeenCalledWith(REPORT);
    expect(out()).toBe("TEXT\n");
    expect(writeFile).not.toHaveBeenCalled();
    expect(openLedger).not.toHaveBeenCalled();
  });

  it("reads the proofs of the environment, with production as the overlay states it", async () => {
    const { context } = progressContext();
    await progress.run(context);
    expect(recordedProofs).toHaveBeenCalledWith(
      expect.anything(),
      "vps",
      undefined,
      true,
    );
  });

  it("compares the proofs with the release chart lock named by --chart-lock", async () => {
    const { context } = progressContext({
      options: {
        environment: "vps",
        "chart-lock": "platform-charts.lock.json",
      },
      deps: {
        ...fakeContext().deps,
        fs: {
          readFile: () => Promise.resolve(RELEASE_LOCK),
          writeFile: () => Promise.resolve(),
        } as unknown as CommandContext["deps"]["fs"],
      },
    });
    await progress.run(context);
    expect(recordedProofs).toHaveBeenCalledWith(
      expect.anything(),
      "vps",
      { cilium: { version: "1.0.0", digest: "sha256:aa" } },
      true,
    );
  });
});

describe("flag progress --json", () => {
  it("prints the report as one JSON object, the same data the text is printed from", async () => {
    const { context, out } = progressContext({ json: true });
    expect(await progress.run(context)).toBe(0);
    expect(out()).toBe(`${JSON.stringify(REPORT)}\n`);
    expect(renderProgress).not.toHaveBeenCalled();
  });
});

describe("flag progress registration", () => {
  it("is the progress command of the flag group, so harness flag progress runs it", () => {
    expect(command()).toBe(progress);
  });

  it("takes --environment and --chart-lock as strings, so the parser accepts them", () => {
    expect(progress.options).toEqual({
      environment: "string",
      "chart-lock": "string",
    });
  });
});
