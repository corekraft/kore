import { expect, test, vi } from "vitest";
import { print } from "./output.js";

test("plain list rows print scalar fields and leave nested detail to --json", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  print(
    [
      {
        name: "crd-ownership",
        namespace: "cluster",
        status: "degraded",
        detail: "7 unowned",
        crds: { total: 119, unowned: ["a"], multiple: [], providerOwned: [] },
      },
    ],
    false,
  );
  expect(log.mock.calls.map((call) => call[0])).toEqual([
    "crd-ownership\tcluster\tdegraded\t7 unowned",
  ]);
  expect(String(log.mock.calls[0]?.[0])).not.toContain("[object Object]");
});
