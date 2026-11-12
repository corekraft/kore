import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { harness } from "../testing/records-support.js";
import {
  LEDGER,
  OVERLAY,
  activate,
  overlay,
  provenIdea,
  repository,
} from "../testing/flag-support.js";

const events = (h: ReturnType<typeof harness>) =>
  (h.get(".kore/state/ledger.jsonl") ?? "")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("harness flag activate", () => {
  it("refuses a flag with no verification outcome and writes no overlay or event", async () => {
    const h = repository();
    const before = h.snapshot();
    expect(await run(activate(), h.deps)).toBe(1);
    expect(h.err()).toMatch(/no verification outcome/i);
    expect(h.err()).toMatch(/harness outcome record/);
    expect(h.snapshot()).toEqual(before);
  });

  it.each([
    ["a refuted result", { Result: "refuted" }],
    ["an experiment kind", { Kind: "experiment" }],
    ["a journal source", { Source: "journal" }],
    ["another flag", { Flag: "other-flag" }],
    ["another environment", { Environment: "managed-example" }],
  ])("refuses proof that is %s", async (_name, change) => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea(change) });
    const before = h.snapshot();
    expect(await run(activate(), h.deps)).toBe(1);
    expect(h.snapshot()).toEqual(before);
  });

  it("turns the flag on with confirmed live-run proof and records the event", async () => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea() });
    expect(await run([...activate(), "--json"], h.deps)).toBe(0);
    const text = h.get(OVERLAY) ?? "";
    expect(JSON.parse(text).features).toEqual({
      "ingress-agentgateway": true,
      "other-flag": false,
    });
    expect(events(h)).toEqual([
      expect.objectContaining({
        kind: "flag.activated",
        source: "claude",
        idea: "0001",
        label: "ingress-agentgateway@local",
      }),
    ]);
    expect(JSON.parse(h.out().trim())).toMatchObject({
      flag: "ingress-agentgateway",
      environment: "local",
      idea: "0001",
    });
  });

  it("changes only the flag's value in the overlay", async () => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea() });
    await run(activate(), h.deps);
    expect(h.get(OVERLAY)).toBe(
      overlay({ "ingress-agentgateway": true, "other-flag": false }),
    );
  });

  it("refuses a flag already on by hand with no proof, instead of calling it fine", async () => {
    const h = repository({
      [OVERLAY]: overlay({ "ingress-agentgateway": true }),
    });
    expect(await run(activate(), h.deps)).toBe(1);
    expect(h.err()).toMatch(/no verification outcome/i);
  });

  it("is idempotent: a flag already on records its event once and never twice", async () => {
    const h = repository({
      "docs/ideas/0001-proof.md": provenIdea(),
      [OVERLAY]: overlay({ "ingress-agentgateway": true }),
    });
    expect(await run(activate(), h.deps)).toBe(0);
    expect(await run(activate(), h.deps)).toBe(0);
    expect(events(h)).toHaveLength(1);
  });
});

describe("harness flag activate reruns", () => {
  it("turns on only the exact flag when another flag's name starts with it", async () => {
    const h = repository({
      "docs/ideas/0001-proof.md": provenIdea(),
      [OVERLAY]: overlay({
        "ingress-agentgateway-extra": false,
        "ingress-agentgateway": false,
      }),
    });
    await run(activate(), h.deps);
    expect(JSON.parse(h.get(OVERLAY) ?? "").features).toEqual({
      "ingress-agentgateway-extra": false,
      "ingress-agentgateway": true,
    });
  });

  it("repairs a missing event on rerun when the overlay was already written", async () => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea() });
    const before = h.fs.appendFile.bind(h.fs);
    h.fs.appendFile = () => Promise.reject(new Error("disk full"));
    await expect(run(activate(), h.deps)).rejects.toThrow("disk full");
    expect(
      JSON.parse(h.get(OVERLAY) ?? "").features["ingress-agentgateway"],
    ).toBe(true);
    h.fs.appendFile = before;
    expect(await run(activate(), h.deps)).toBe(0);
    expect(events(h)).toHaveLength(1);
  });
});

describe("harness flag activate refusals", () => {
  it("refuses a flag the environment does not declare", async () => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea() });
    const before = h.snapshot();
    expect(await run(activate("unknown-flag"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/does not declare flag "unknown-flag"/);
    expect(h.err()).toMatch(/ingress-agentgateway, other-flag/);
    expect(h.snapshot()).toEqual(before);
  });

  it("refuses an environment with no overlay, naming the ones that exist", async () => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea() });
    expect(await run(activate("ingress-agentgateway", "nowhere"), h.deps)).toBe(
      1,
    );
    expect(h.err()).toMatch(/No environment "nowhere".*local/);
  });

  it("fails before writing the overlay when the ledger cannot be located", async () => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea() });
    const before = h.snapshot();
    const argv = activate();
    argv.splice(argv.indexOf("--ledger"), 2);
    expect(await run(argv, h.deps)).toBe(1);
    expect(h.err()).toMatch(/ledger/);
    expect(h.snapshot()).toEqual(before);
  });

  it("requires --environment and a flag name", async () => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea() });
    expect(await run(["flag", "activate", "--ledger", LEDGER], h.deps)).toBe(1);
    expect(h.err()).toMatch(/flag name/);
    expect(
      await run(["flag", "activate", "x", "--ledger", LEDGER], h.deps),
    ).toBe(1);
    expect(h.err()).toMatch(/Missing --environment/);
  });
});

describe("harness flag audit", () => {
  it("passes when every flag is off", async () => {
    const h = repository();
    expect(await run(["flag", "audit"], h.deps)).toBe(0);
    expect(h.out()).toMatch(/no flag is on without proof/i);
  });

  it("passes after an activation with proof", async () => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea() });
    await run(activate(), h.deps);
    expect(await run(["flag", "audit"], h.deps)).toBe(0);
  });

  it("fails naming a flag turned on by hand without proof", async () => {
    const h = repository({
      [OVERLAY]: overlay({ "ingress-agentgateway": true }),
    });
    expect(await run(["flag", "audit"], h.deps)).toBe(1);
    expect(h.err()).toMatch(/ingress-agentgateway.*local/);
    expect(h.err()).toMatch(/harness flag activate/);
  });

  it("fails on a flag on in one environment whose proof is for another", async () => {
    const h = repository({
      "docs/ideas/0001-proof.md": provenIdea({
        Environment: "managed-example",
      }),
      [OVERLAY]: overlay({ "ingress-agentgateway": true }),
    });
    expect(await run(["flag", "audit", "--json"], h.deps)).toBe(1);
    expect(JSON.parse(h.err().trim().split("\n")[0] ?? "")).toMatchObject({
      unproven: [{ flag: "ingress-agentgateway", environment: "local" }],
    });
  });

  it("fails on an overlay that is not valid JSON-compatible YAML, naming the file", async () => {
    const h = repository({ [OVERLAY]: "name: [unterminated" });
    expect(await run(["flag", "audit"], h.deps)).toBe(1);
    expect(h.err()).toContain(OVERLAY);
  });
});

describe("harness flag audit on a real environments directory", () => {
  it("skips entries that are files, such as schema.json, instead of failing", async () => {
    const h = repository();
    h.set("infra/environments/schema.json", "{}");
    const exists = h.fs.exists.bind(h.fs);
    h.fs.exists = (path) =>
      path.includes("schema.json/")
        ? Promise.reject(
            Object.assign(new Error("ENOTDIR"), { code: "ENOTDIR" }),
          )
        : exists(path);
    expect(await run(["flag", "audit"], h.deps)).toBe(0);
  });
});

describe("harness flag proof is only the tool's field block", () => {
  const forged = (change: Record<string, string>, extra: string) =>
    repository({
      "docs/ideas/0001-proof.md": `${provenIdea(change)}${extra}\n`,
    });

  it.each([
    [
      "an Environment line",
      { Environment: "managed-example" },
      "- Environment: local",
    ],
    ["a Flag line", { Flag: "other-flag" }, "- Flag: ingress-agentgateway"],
    ["a Result line", { Result: "refuted" }, "- Result: confirmed"],
  ])("ignores %s written later in the summary", async (_name, change, line) => {
    const h = forged(change, line);
    const before = h.snapshot();
    expect(await run(activate(), h.deps)).toBe(1);
    expect(h.snapshot()).toEqual(before);
  });

  it("audit does not accept a flag on by hand because of a forged summary line", async () => {
    const h = repository({
      "docs/ideas/0001-proof.md": `${provenIdea({ Environment: "managed-example" })}\n- Environment: local\n`,
      [OVERLAY]: overlay({ "ingress-agentgateway": true }),
    });
    expect(await run(["flag", "audit"], h.deps)).toBe(1);
  });
});

describe("harness flag activation history", () => {
  it("records a second event when a flag is turned off and activated again", async () => {
    const h = repository({ "docs/ideas/0001-proof.md": provenIdea() });
    await run(activate(), h.deps);
    h.set(
      OVERLAY,
      overlay({ "ingress-agentgateway": false, "other-flag": false }),
    );
    expect(await run(activate(), h.deps)).toBe(0);
    expect(events(h)).toHaveLength(2);
  });
});

describe("harness flag audit when environments cannot be read", () => {
  it("fails, naming the directory, instead of passing on an unreadable one", async () => {
    const h = repository({
      [OVERLAY]: overlay({ "ingress-agentgateway": true }),
    });
    h.fs.readdir = () =>
      Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    expect(await run(["flag", "audit"], h.deps)).toBe(1);
    expect(h.err()).toMatch(/infra\/environments.*EACCES/);
  });

  it("passes when the repository has no environments directory", async () => {
    const h = repository();
    h.fs.readdir = () =>
      Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect(await run(["flag", "audit"], h.deps)).toBe(0);
  });
});
