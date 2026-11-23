import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  evaluateApp,
  gitAppSource,
  type EvalReport,
} from "../delivery/index.js";
import { evalCommand } from "./commands-delivery.js";
import { fakeContext, parsedArgs } from "./cli-support.js";
import { print } from "./output.js";

// The eval reads the repository through its own barrel and prints through output;
// both are mocked, so the command's own choices are what the tests observe (ADR 0098).
vi.mock("node:fs/promises");
vi.mock("../delivery/index.js");
vi.mock("./output.js");

const digest = `sha256:${"a".repeat(64)}`;
const flags = {
  base: "main",
  version: "1.2.3+abc1234",
  digest,
  today: "2026-11-23",
};

const report: EvalReport = {
  verdict: "pass",
  version: "1.2.3+abc1234",
  digest,
  failures: [],
  warnings: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(evaluateApp).mockResolvedValue(report);
  vi.mocked(gitAppSource).mockReturnValue({
    flagsText: async () => undefined,
    baseFlagsText: async () => undefined,
    changedPaths: async () => [],
    headMessage: async () => "",
  });
});

describe("eval refuses an invocation it cannot evaluate, naming what to add", () => {
  test("without an application directory it names the whole command", async () => {
    await expect(
      evalCommand(fakeContext({ parsed: parsedArgs(flags) })),
    ).rejects.toThrow(
      "eval needs the app directory: kore eval <dir> --base <ref> --version <semver>+<sha> --digest sha256:<hex>",
    );
    expect(evaluateApp).not.toHaveBeenCalled();
  });

  test("without --base it names the commit the candidate is compared with", async () => {
    const { base: _base, ...withoutBase } = flags;
    await expect(
      evalCommand(
        fakeContext({ parsed: parsedArgs(withoutBase, ["/work/leads"]) }),
      ),
    ).rejects.toThrow(
      "eval needs --base <ref>, the commit the candidate is compared with",
    );
  });

  test("without --version it names the version form", async () => {
    const { version: _version, ...withoutVersion } = flags;
    await expect(
      evalCommand(
        fakeContext({ parsed: parsedArgs(withoutVersion, ["/work/leads"]) }),
      ),
    ).rejects.toThrow(
      "eval needs --version <semver>+<sha>, such as 1.2.3+abc1234",
    );
  });

  test("without --digest it names the image digest it needs", async () => {
    const { digest: _digest, ...withoutDigest } = flags;
    await expect(
      evalCommand(
        fakeContext({ parsed: parsedArgs(withoutDigest, ["/work/leads"]) }),
      ),
    ).rejects.toThrow(
      "eval needs --digest sha256:<hex> of the candidate image",
    );
  });
});

test("a passing eval prints its report as JSON and exits 0", async () => {
  const code = await evalCommand(
    fakeContext({ parsed: parsedArgs(flags, ["/work/leads"]) }),
  );
  expect(code).toBe(0);
  expect(print).toHaveBeenCalledWith(report, true);
});

test("a failing eval prints its report and exits 1, so the pipeline stops", async () => {
  const failed: EvalReport = {
    ...report,
    verdict: "fail",
    failures: [
      "flag leads.new-checkout: default must be false; every flag ships off",
    ],
  };
  vi.mocked(evaluateApp).mockResolvedValue(failed);
  const code = await evalCommand(
    fakeContext({ parsed: parsedArgs(flags, ["/work/leads"]) }),
  );
  expect(code).toBe(1);
  expect(print).toHaveBeenCalledWith(failed, true);
});

test("the repository is read through git with the runner, the base and the app directory", async () => {
  const context = fakeContext({ parsed: parsedArgs(flags, ["/work/leads"]) });
  await evalCommand(context);
  expect(gitAppSource).toHaveBeenCalledWith(
    expect.objectContaining({
      runner: context.runner,
      dir: "/work/leads",
      base: "main",
    }),
  );
});

test("the candidate's version, digest and --today date are passed to the evaluation", async () => {
  await evalCommand(
    fakeContext({ parsed: parsedArgs(flags, ["/work/leads"]) }),
  );
  expect(evaluateApp).toHaveBeenCalledWith(expect.anything(), {
    version: "1.2.3+abc1234",
    digest,
    published: undefined,
    today: "2026-11-23",
  });
});

test("--published is read as a JSON map of version to digest", async () => {
  vi.mocked(readFile).mockResolvedValue(
    `{"1.2.2+def5678": "sha256:${"b".repeat(64)}"}`,
  );
  await evalCommand(
    fakeContext({
      parsed: parsedArgs({ ...flags, published: "published.json" }, [
        "/work/leads",
      ]),
    }),
  );
  expect(readFile).toHaveBeenCalledWith("published.json", "utf8");
  expect(evaluateApp).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      published: { "1.2.2+def5678": `sha256:${"b".repeat(64)}` },
    }),
  );
});

test("--published that is not a JSON object of strings is refused, naming the shape it needs", async () => {
  vi.mocked(readFile).mockResolvedValue('["1.2.2+def5678"]');
  await expect(
    evalCommand(
      fakeContext({
        parsed: parsedArgs({ ...flags, published: "published.json" }, [
          "/work/leads",
        ]),
      }),
    ),
  ).rejects.toThrow(
    'eval: --published published.json must be a JSON object of version to digest, such as {"1.2.2+def5678": "sha256:<hex>"}',
  );
  expect(evaluateApp).not.toHaveBeenCalled();
});
