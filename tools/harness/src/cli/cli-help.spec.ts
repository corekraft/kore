import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainGuides, rootGuide } from "../help/index.js";
import { run } from "./cli.js";
import { depsOf, outputOf, table } from "./cli-fakes-support.js";

// The renderers and the view builders are mocked: the renderers print their view's level,
// and the builders return a view tagged with the arguments run gave them, so a spec shows
// which level the dispatcher chose and what it built each view from.
const views = vi.hoisted(() => ({
  rootView: vi.fn((..._args: unknown[]) => ({ level: "root" })),
  domainView: vi.fn((domain: string, ..._rest: unknown[]) => ({
    level: "domain",
    domain,
  })),
  commandView: vi.fn((path: string, ..._rest: unknown[]) => ({
    level: "command",
    path,
  })),
}));

const renderers = vi.hoisted(() => ({
  renderText: vi.fn((view: { level: string }) => `text ${view.level}\n`),
  renderJson: vi.fn((view: { level: string }) => `json ${view.level}\n`),
}));

vi.mock("./domains.js", async () => ({
  domains: (await import("./cli-fakes-support.js")).table,
}));

vi.mock("../help/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../help/index.js")>()),
  rootView: views.rootView,
  domainView: views.domainView,
  commandView: views.commandView,
  renderText: renderers.renderText,
  renderJson: renderers.renderJson,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("harness dispatch: help at the three levels", () => {
  it.each([[[]], [["--help"]], [["-h"]]])(
    "prints the root guide to stdout for %j, exits 0 and touches nothing",
    async (argv) => {
      const deps = depsOf();
      expect(await run(argv, deps)).toBe(0);
      expect(outputOf()).toEqual({ out: "text root\n", err: "" });
      expect(renderers.renderText).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: "root" }),
      );
    },
  );

  it("renders a domain's guide for <domain> --help, and a command's for <domain> <command> --help", async () => {
    const domain = depsOf();
    expect(await run(["plan", "--help"], domain)).toBe(0);
    expect(outputOf()).toEqual({ out: "text domain\n", err: "" });
    const command = depsOf();
    expect(await run(["plan", "tick", "--help"], command)).toBe(0);
    expect(outputOf()).toEqual({ out: "text command\n", err: "" });
    expect(renderers.renderText).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: "command", path: "plan tick" }),
    );
  });

  it("collapses a domain whose only command is unnamed, so its --help renders that command's guide", async () => {
    const deps = depsOf();
    expect(await run(["lone", "--help"], deps)).toBe(0);
    expect(outputOf().out).toBe("text command\n");
    expect(renderers.renderText).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: "command", path: "lone" }),
    );
  });

  it("lets --help and -h win over every other flag and operand on the line, and runs no command", async () => {
    const deps = depsOf();
    expect(
      await run(
        ["plan", "tick", "A1", "--note", "why", "--force", "--help"],
        deps,
      ),
    ).toBe(0);
    expect(await run(["plan", "tick", "--bogus", "-h"], deps)).toBe(0);
    expect(table.plan.tick.run).not.toHaveBeenCalled();
    expect(outputOf().err).toBe("");
  });

  it("prints the same level as one JSON object under --help --json, and no prose", async () => {
    const deps = depsOf();
    expect(await run(["plan", "tick", "--help", "--json"], deps)).toBe(0);
    expect(outputOf()).toEqual({ out: "json command\n", err: "" });
    expect(renderers.renderText).not.toHaveBeenCalled();
  });
});

describe("harness dispatch: a usage error prints the guide of the closest level", () => {
  it("prints the root guide after an unknown domain's error, with exit 2 and nothing on stdout", async () => {
    const deps = depsOf();
    expect(await run(["nope", "x"], deps)).toBe(2);
    expect(outputOf()).toEqual({
      out: "",
      err: 'Unknown domain "nope". Domains: harness, plan, hook, lone.\n\ntext root\n',
    });
  });

  it("prints the domain's guide after an unknown command, and after a missing one", async () => {
    const unknown = depsOf();
    expect(await run(["harness", "nope"], unknown)).toBe(2);
    expect(outputOf().err).toBe(
      'Unknown command "nope" for domain "harness". Commands: version.\n\ntext domain\n',
    );
    const missing = depsOf();
    expect(await run(["plan"], missing)).toBe(2);
    expect(outputOf().err).toBe(
      'Missing command for domain "plan". Commands: tick.\n\ntext domain\n',
    );
  });

  it("prints the command's guide after a flag error, and after an operand error", async () => {
    const flag = depsOf();
    expect(await run(["plan", "tick", "A1", "--bogus"], flag)).toBe(2);
    expect(outputOf().err).toBe('Unknown flag "--bogus".\n\ntext command\n');
    const operand = depsOf();
    expect(await run(["harness", "version", "stray"], operand)).toBe(2);
    expect(outputOf().err).toBe(
      'Unexpected argument "stray".\n\ntext command\n',
    );
  });

  it("prints the JSON error object first under --json, then the same prose guide", async () => {
    const deps = depsOf();
    expect(await run(["plan", "tick", "--bogus", "--json"], deps)).toBe(2);
    const message = 'Unknown flag "--bogus".';
    expect(outputOf().err).toBe(
      JSON.stringify({ error: message }) +
        "\n" +
        message +
        "\n\ntext command\n",
    );
  });
});

describe("harness dispatch: the views it builds", () => {
  it("builds the root view from the root guide and the domain guides, for a usage error too", async () => {
    expect(await run(["--help"], depsOf())).toBe(0);
    expect(views.rootView).toHaveBeenCalledExactlyOnceWith(
      rootGuide,
      domainGuides,
    );
    vi.clearAllMocks();
    expect(await run(["nope", "x"], depsOf())).toBe(2);
    expect(views.rootView).toHaveBeenCalledExactlyOnceWith(
      rootGuide,
      domainGuides,
    );
    expect(views.domainView).not.toHaveBeenCalled();
    expect(views.commandView).not.toHaveBeenCalled();
  });

  it("builds a domain's view from the domain's commands and its guide", async () => {
    expect(await run(["plan", "--help"], depsOf())).toBe(0);
    expect(views.domainView).toHaveBeenCalledExactlyOnceWith(
      "plan",
      table.plan,
      domainGuides["plan"],
    );
  });

  it("builds a command's view from its path, the command and its help record", async () => {
    expect(await run(["harness", "version", "--help"], depsOf())).toBe(0);
    expect(views.commandView).toHaveBeenCalledExactlyOnceWith(
      "harness version",
      table.harness.version,
      { purpose: "print the version" },
    );
  });

  it("passes no help record for a command that has none, so the view is the fallback", async () => {
    expect(await run(["plan", "tick", "--help"], depsOf())).toBe(0);
    expect(views.commandView).toHaveBeenCalledExactlyOnceWith(
      "plan tick",
      table.plan.tick,
      undefined,
    );
  });

  it("builds the command's view for a flag error, the closest level the words reach", async () => {
    expect(await run(["plan", "tick", "A1", "--bogus"], depsOf())).toBe(2);
    expect(views.commandView).toHaveBeenCalledExactlyOnceWith(
      "plan tick",
      table.plan.tick,
      undefined,
    );
    expect(views.domainView).not.toHaveBeenCalled();
  });
});
