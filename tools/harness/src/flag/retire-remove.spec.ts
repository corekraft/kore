// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md
import { describe, expect, it } from "vitest";
import { removeMember } from "./retire-remove.js";

/** The span of the first occurrence of `needle` in `text`, as removeMember takes it. */
function spanOf(text: string, needle: string): [number, number] {
  const start = text.indexOf(needle);
  if (start === -1) {
    throw new Error(`fixture has no ${needle}`);
  }
  return [start, start + needle.length];
}

describe("removeMember", () => {
  it("removes an inline member and the comma that follows it", () => {
    const text = '{ "a": true, "b": false, "c": true }';
    const [start, end] = spanOf(text, '"b": false');
    expect(removeMember(text, start, end)).toBe('{ "a": true, "c": true }');
  });

  it("removes the last inline member with the comma before it, so the rest stays valid JSON", () => {
    const text = '{ "a": true, "b": false }';
    const [start, end] = spanOf(text, '"b": false');
    expect(JSON.parse(removeMember(text, start, end))).toEqual({ a: true });
  });

  it("removes a member that stands alone on its line, with the line", () => {
    const text = '{\n  "a": true,\n  "b": false,\n  "c": true\n}\n';
    const [start, end] = spanOf(text, '"b": false');
    expect(removeMember(text, start, end)).toBe(
      '{\n  "a": true,\n  "c": true\n}\n',
    );
  });

  it("removes the last member alone on its line and the comma that ends the line before it", () => {
    const text = '{\n  "a": true,\n  "b": false\n}\n';
    const [start, end] = spanOf(text, '"b": false');
    const result = removeMember(text, start, end);
    expect(result).toBe('{\n  "a": true\n}\n');
    expect(JSON.parse(result)).toEqual({ a: true });
  });

  it("removes the only member of an object and leaves it empty and valid", () => {
    const text = '{\n  "features": {\n    "a": true\n  }\n}\n';
    const [start, end] = spanOf(text, '"a": true');
    expect(JSON.parse(removeMember(text, start, end))).toEqual({
      features: {},
    });
  });

  it("removes a member that spans several lines, with all of its lines", () => {
    const text =
      '{\n  "flags": [\n    {\n      "name": "x"\n    },\n    {\n      "name": "y"\n    }\n  ]\n}\n';
    const start = text.indexOf('    {\n      "name": "x"');
    const end = text.indexOf("},") + 1;
    const result = removeMember(text, start, end);
    expect(JSON.parse(result)).toEqual({ flags: [{ name: "y" }] });
  });

  it("leaves every byte outside the member unchanged", () => {
    const text = '{\n  "a": true,\n  "b": false,\n  "c": true\n}\n';
    const [start, end] = spanOf(text, '"b": false');
    const result = removeMember(text, start, end);
    expect(result.startsWith('{\n  "a": true,\n')).toBe(true);
    expect(result.endsWith('  "c": true\n}\n')).toBe(true);
  });
});
