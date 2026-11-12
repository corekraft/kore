import assert from "node:assert/strict";
import { evaluate } from "./guard.js";

export const root = "/repo";
const sopsConfig = `creation_rules:
  - path_regex: infra/environments/local/secrets/.*\\.enc\\.yaml$
    encrypted_regex: '^(data|stringData)$'
`;
export const vitestConfig = `thresholds: {
  statements: 95,
  branches: 84,
  functions: 94,
  lines: 95,
}`;

const files: Record<string, string> = {
  "/repo/.sops.yaml": sopsConfig,
  "/repo/tools/kore/vitest.config.ts": vitestConfig,
};
const ctx = {
  root,
  readFile: (path: string): Promise<string> => {
    const text = files[path];
    return text === undefined
      ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      : Promise.resolve(text);
  },
};

export interface Result {
  action: "allow" | "block" | "warn";
  rule?: string;
  message: string;
}

export const decide = async (call: unknown): Promise<Result> => ({
  message: "",
  ...(await evaluate(call, ctx)),
});

export const bash = (command: string) =>
  decide({ tool_name: "Bash", tool_input: { command } });
export const write = (file_path: string, content: string) =>
  decide({ tool_name: "Write", tool_input: { file_path, content } });
export const edit = (
  file_path: string,
  old_string: string,
  new_string: string,
) =>
  decide({
    tool_name: "Edit",
    tool_input: { file_path, old_string, new_string },
  });
export const read = (file_path: string) =>
  decide({ tool_name: "Read", tool_input: { file_path } });

export const blocked = (result: Result, rule: string) => {
  assert.equal(result.action, "block", JSON.stringify(result));
  assert.equal(result.rule, rule);
  assert.ok(
    result.message.includes(`[guard:${rule}]`),
    "message names the rule",
  );
  assert.match(
    result.message,
    /Instead|instead/,
    "message offers an alternative",
  );
};
export const allowed = (result: Result) =>
  assert.equal(result.action, "allow", JSON.stringify(result));
