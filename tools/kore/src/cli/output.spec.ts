import { expect, test, vi } from "vitest";
import { print } from "./output.js";

// Output is the console and stdout: the process boundary this unit writes to.
function captureOutput() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    write: vi.spyOn(process.stdout, "write").mockImplementation(() => true),
  };
}

test("plain list rows print scalar fields and leave nested detail to --json", () => {
  const { log, write } = captureOutput();
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
  expect(write).not.toHaveBeenCalled();
});

test("a plain list of strings prints one string per line", () => {
  const { log } = captureOutput();
  print(["gateway", "registry"], false);
  expect(log.mock.calls.map((call) => call[0])).toEqual([
    "gateway",
    "registry",
  ]);
});

test("a plain record prints key: value lines, with non-string values as JSON", () => {
  const { log } = captureOutput();
  print({ name: "reference", replicas: 2, ports: [8080] }, false);
  expect(log.mock.calls.map((call) => call[0])).toEqual([
    "name: reference",
    "replicas: 2",
    "ports: [8080]",
  ]);
});

test("a plain scalar prints as its text", () => {
  const { log } = captureOutput();
  print(42, false);
  print("ready", false);
  expect(log.mock.calls.map((call) => call[0])).toEqual(["42", "ready"]);
});

test("--json writes the whole value as indented JSON to stdout, never to the console", () => {
  const { log, write } = captureOutput();
  print({ name: "reference", crds: { total: 119 } }, true);
  expect(write.mock.calls.map((call) => call[0])).toEqual([
    '{\n  "name": "reference",\n  "crds": {\n    "total": 119\n  }\n}\n',
  ]);
  expect(log).not.toHaveBeenCalled();
});
