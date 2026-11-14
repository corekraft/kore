import { expect, test } from "vitest";
import * as cli from "./index.js";
import { usage } from "./usage.js";

test("the cli barrel exposes exactly the usage text", () => {
  expect(Object.keys(cli)).toEqual(["usage"]);
  expect(cli.usage).toBe(usage);
});
