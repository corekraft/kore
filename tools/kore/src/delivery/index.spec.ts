import { expect, test } from "vitest";
import * as delivery from "./index.js";

test("the delivery barrel exposes exactly the eval entry and the git source of an app", () => {
  expect(Object.keys(delivery).sort()).toEqual(["evaluateApp", "gitAppSource"]);
});
