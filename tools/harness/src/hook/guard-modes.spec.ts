import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { INVENTORY_PATH, type Mode } from "../guardrail/index.js";
import {
  committedInventoryText,
  inventoryWith,
} from "../testing/guardrail-support.js";
import { ledgerEvents } from "./feedback-support.js";

async function guard(
  payload: unknown,
  inventory: string | undefined,
  project = "/repo",
  extra: Record<string, string> = {},
) {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: project, KORE_ROOT: "/repo" },
    files: {
      ...extra,
      ...(inventory === undefined
        ? {}
        : { [`/repo/${INVENTORY_PATH}`]: inventory }),
      "/repo/tools/kore/vitest.config.ts": "thresholds: { statements: 95 }",
    },
  });
  h.deps.stdin = () => Promise.resolve(JSON.stringify(payload));
  const code = await run(["hook", "guard"], h.deps);
  return { code, out: h.out(), err: h.err(), events: ledgerEvents(h.files) };
}

const bash = (command: string) => ({
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command },
});
const auditEvents = (events: Record<string, unknown>[]) =>
  events.filter((e) => e["kind"] === "guard.audit");
const modes = (m: Record<string, Mode>) => inventoryWith(m);

describe("a guardrail in audit mode", () => {
  it("warns and records a ledger event naming the rule and session, and never blocks", async () => {
    const result = await guard(
      bash("ls *.nothing"),
      modes({ "bare-glob": "audit" }),
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(JSON.parse(result.out).hookSpecificOutput.additionalContext).toMatch(
      /\[guard:bare-glob\]/,
    );
    expect(auditEvents(result.events)).toMatchObject([
      { source: "claude", session: "s1", label: "bare-glob" },
    ]);
    expect(result.events.map((e) => e["outcome"])).not.toContain("failure");
  });

  it("turns a rule that blocks today into a warning, with its event, when set to audit", async () => {
    const result = await guard(
      bash("minikube delete"),
      modes({ destructive: "audit" }),
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toMatch(/guard:destructive/);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "destructive" },
    ]);
  });

  it("lets a block in a later segment win over a demoted one", async () => {
    const result = await guard(
      bash("minikube delete; git commit --no-verify -m x"),
      modes({ destructive: "audit" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:no-verify/);
  });

  it("warns for a file rule too", async () => {
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: {
          file_path: "/repo/tools/kore/vitest.config.ts",
          content: "thresholds: { statements: 1 }",
        },
      },
      modes({ "coverage-threshold": "audit" }),
    );
    expect(result.code).toBe(0);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "coverage-threshold" },
    ]);
  });
});

describe("a guardrail in enforce mode", () => {
  it("blocks a rule that warns today and records no audit event", async () => {
    const result = await guard(
      bash("ls *.nothing"),
      modes({ "bare-glob": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^\[guard:bare-glob\] .*Instead/);
    expect(result.out).toBe("");
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("blocks equals-word with a one-line mode change", async () => {
    const result = await guard(
      bash("echo =foo"),
      modes({ "equals-word": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("records no audit event when a rule blocks as declared", async () => {
    const result = await guard(bash("minikube delete"), committedInventoryText);
    expect(result.code).toBe(2);
    expect(auditEvents(result.events)).toEqual([]);
  });
});

describe("an inventory the guard cannot use", () => {
  it.each([
    ["missing", undefined, /\.claude\/guardrails\.yaml/],
    ["malformed", "{ nope", /JSON-compatible/],
  ])(
    "enforces every rule when it is %s, and says how to fix it",
    async (_, text, message) => {
      const result = await guard(bash("ls *.nothing"), text);
      expect(result.code).toBe(2);
      expect(result.err).toMatch(/\[guard:bare-glob\]/);
      expect(result.err).toMatch(message);
      expect(auditEvents(result.events)).toEqual([]);
    },
  );
});

describe("a promoted rule beats an audit warning in the same call", () => {
  it("blocks equals-word at enforce beside a bare glob", async () => {
    const result = await guard(
      bash("ls *.nothing =foo"),
      modes({ "equals-word": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:equals-word/);
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("blocks bare-glob at enforce beside an equals-word", async () => {
    const result = await guard(
      bash("echo =foo *.nothing"),
      modes({ "bare-glob": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:bare-glob/);
  });

  it("blocks a promoted zsh rule beside a segment rule in audit", async () => {
    const result = await guard(
      bash("gh issue edit 1 --body x; echo =foo"),
      modes({ "equals-word": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:equals-word/);
  });

  it("still warns, once, when no rule blocks", async () => {
    const result = await guard(
      bash("ls *.nothing =foo"),
      committedInventoryText,
    );
    expect(result.code).toBe(0);
    expect(auditEvents(result.events)).toHaveLength(1);
  });
});

describe("a promoted file rule beats an audit warning on the same write", () => {
  const write = {
    session_id: "s1",
    tool_name: "Write",
    tool_input: {
      file_path: "/repo/apps/web/d.yaml",
      content: "image: web:1\n",
    },
  };
  it("blocks image-digest at enforce while another rule only warns", async () => {
    const result = await guard(write, modes({ "image-digest": "enforce" }));
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:image-digest/);
    expect(auditEvents(result.events)).toEqual([]);
  });

  it("blocks image-digest promoted beside an audit flag-activation", async () => {
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: {
          file_path: "/repo/infra/environments/local/environment.yaml",
          content: '"features": { "a-b": true }\nimage: web:1\n',
        },
      },
      modes({ "image-digest": "enforce" }),
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/guard:image-digest/);
  });
});

describe("the inventory protects itself", () => {
  const edit = (oldS: string, newS: string) => ({
    session_id: "s1",
    tool_name: "Edit",
    tool_input: {
      file_path: "/repo/.claude/guardrails.yaml",
      old_string: oldS,
      new_string: newS,
    },
  });
  const line = (rule: string, mode: string) =>
    `{ "rule": "${rule}", "kind": "bash", "mode": "${mode}", "owner": "x" }`;

  it("warns, naming the rule, on an Edit that turns enforce into audit", async () => {
    const result = await guard(
      edit(line("no-verify", "enforce"), line("no-verify", "audit")),
      committedInventoryText,
    );
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/guard:guardrail-demotion/);
    expect(result.out).toMatch(/no-verify/);
    expect(auditEvents(result.events)).toMatchObject([
      { label: "guardrail-demotion" },
    ]);
  });

  it("warns on an Edit of the mode alone", async () => {
    const result = await guard(
      edit('"mode": "enforce"', '"mode": "audit"'),
      committedInventoryText,
    );
    expect(result.out).toMatch(/guard:guardrail-demotion/);
  });

  it("warns on a Write that demotes a rule the file enforces today", async () => {
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: {
          file_path: "/repo/.claude/guardrails.yaml",
          content: inventoryWith({ destructive: "audit" }),
        },
      },
      committedInventoryText,
    );
    expect(result.out).toMatch(/guard:guardrail-demotion/);
    expect(result.out).toMatch(/destructive/);
  });

  it("allows promoting, and edits that leave modes alone", async () => {
    for (const payload of [
      edit(line("bare-glob", "audit"), line("bare-glob", "enforce")),
      edit(
        line("bare-glob", "audit"),
        line("bare-glob", "audit").replace('"x"', '"y"'),
      ),
    ]) {
      const result = await guard(payload, committedInventoryText);
      expect(result).toMatchObject({ code: 0, out: "", err: "" });
      expect(auditEvents(result.events)).toEqual([]);
    }
  });

  it("blocks the demotion once a person promotes the rule", async () => {
    const result = await guard(
      edit(line("no-verify", "enforce"), line("no-verify", "audit")),
      modes({ "guardrail-demotion": "enforce" }),
    );
    expect(result.code).toBe(2);
  });
});

describe("finding the inventory", () => {
  it("walks up from the project directory to the repository's inventory", async () => {
    const result = await guard(
      bash("ls *.nothing"),
      modes({ "bare-glob": "enforce" }),
      "/repo/tools/harness",
    );
    expect(result.code).toBe(2);
    expect(result.err).not.toMatch(/Every rule is enforcing/);
  });
});
