import { describe, expect, it } from "vitest";
import {
  isHcList,
  isHcRead,
  isHcRemoved,
  isHcTerminal,
  isHcWait,
  isJsonObject,
} from "./hc-shapes.js";

const cases: [
  name: string,
  predicate: (value: unknown) => boolean,
  value: unknown,
  expected: boolean,
][] = [
  [
    "a terminal with an address",
    isHcTerminal,
    { address: "t7", labels: {}, state: "live", cwd: "/w" },
    true,
  ],
  ["a terminal with no address", isHcTerminal, { name: "s1" }, false],
  ["an empty object as a terminal", isHcTerminal, {}, false],
  ["an array as a terminal", isHcTerminal, [], false],
  ["null as a terminal", isHcTerminal, null, false],
  [
    "a list whose terminals are objects with addresses and cwds",
    isHcList,
    { terminals: [{ address: "t7", cwd: "/w" }] },
    true,
  ],
  ["an empty list", isHcList, { terminals: [] }, true],
  [
    "a list whose terminals is not an array",
    isHcList,
    { terminals: "t7" },
    false,
  ],
  [
    "a list with a terminal that has no address",
    isHcList,
    { terminals: [{ cwd: "/w" }] },
    false,
  ],
  [
    "a terminal with an address and no cwd",
    isHcTerminal,
    { address: "t7", labels: {}, state: "live" },
    false,
  ],
  ["a list with no terminals field", isHcList, {}, false],
  [
    "a wait that ended with children",
    isHcWait,
    { terminal: "t7", ended: true, reason: "exit", children: [] },
    true,
  ],
  [
    "a wait with no ended",
    isHcWait,
    { terminal: "t7", reason: "exit", children: [] },
    false,
  ],
  [
    "a wait whose ended is a string",
    isHcWait,
    { terminal: "t7", ended: "yes", reason: "exit", children: [] },
    false,
  ],
  [
    "a wait with no children",
    isHcWait,
    { terminal: "t7", ended: true, reason: "children" },
    false,
  ],
  [
    "a wait whose child has no reason",
    isHcWait,
    {
      terminal: "t3",
      ended: true,
      reason: "children",
      children: [{ terminal: "t7" }],
    },
    false,
  ],
  [
    "a wait whose child is null",
    isHcWait,
    { terminal: "t3", ended: true, reason: "children", children: [null] },
    false,
  ],
  ["a read with text", isHcRead, { text: "x", how: "screen" }, true],
  ["a read whose text is not a string", isHcRead, { text: 1 }, false],
  ["a read with no text", isHcRead, { complete: true }, false],
  ["a removal that names the terminal", isHcRemoved, { removed: "t7" }, true],
  ["a removal with no name", isHcRemoved, {}, false],
  ["an object as a reply that only says it worked", isJsonObject, {}, true],
  ["an array as a reply that only says it worked", isJsonObject, [], false],
  ["a string as a reply that only says it worked", isJsonObject, "ok", false],
];

describe("the shapes hc's JSON must have", () => {
  it.each(cases)(
    "accepts or refuses %s",
    (_name, predicate, value, expected) => {
      expect(predicate(value)).toBe(expected);
    },
  );
});
