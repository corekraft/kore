import { expect, test } from "vitest";
import { RecordingRunner } from "./runner.js";
import { withRequestTimeout } from "./request-timeout.js";

async function sent(command: string, args: string[]) {
  const inner = new RecordingRunner();
  await withRequestTimeout(inner, "20s").run(command, args);
  return inner.calls[0]!.args;
}

test("kubectl reads carry a request timeout", async () => {
  expect(await sent("kubectl", ["--context", "c", "get", "nodes"])).toEqual([
    "--context",
    "c",
    "get",
    "nodes",
    "--request-timeout=20s",
  ]);
});

test("a read that sets its own request timeout is left alone", async () => {
  const args = ["get", "pods", "--request-timeout=5s"];
  expect(await sent("kubectl", args)).toEqual(args);
});

test("watches are not given a request timeout", async () => {
  expect(await sent("kubectl", ["get", "pods", "--watch"])).toEqual([
    "get",
    "pods",
    "--watch",
  ]);
  expect(await sent("kubectl", ["get", "pods", "--watch=true"])).toEqual([
    "get",
    "pods",
    "--watch=true",
  ]);
  expect(await sent("kubectl", ["get", "pods", "-w"])).toEqual([
    "get",
    "pods",
    "-w",
  ]);
});

test("writes and other tools are never changed", async () => {
  for (const [command, args] of [
    ["kubectl", ["--context", "c", "apply", "-f", "-"]],
    ["kubectl", ["wait", "--for=condition=Ready", "pod/x"]],
    ["helm", ["get", "values", "x"]],
  ] as const) {
    expect(await sent(command, [...args])).toEqual(args);
  }
});

test("options are passed through unchanged", async () => {
  const inner = new RecordingRunner();
  await withRequestTimeout(inner, "20s").run("kubectl", ["get", "ns"], {
    capture: true,
  });
  expect(inner.calls[0]!.options?.capture).toBe(true);
});

test("every kubectl read verb carries a request timeout, not only get", async () => {
  for (const verb of ["describe", "top", "events", "api-resources", "auth"]) {
    expect(await sent("kubectl", ["--context", "c", verb, "x"])).toEqual([
      "--context",
      "c",
      verb,
      "x",
      "--request-timeout=20s",
    ]);
  }
  expect(await sent("kubectl", ["logs", "pod/x"])).toEqual([
    "logs",
    "pod/x",
    "--request-timeout=20s",
  ]);
});

test("followed logs are never given a request timeout", async () => {
  for (const flag of ["-f", "--follow", "--follow=true"]) {
    expect(await sent("kubectl", ["logs", "pod/x", flag])).toEqual([
      "logs",
      "pod/x",
      flag,
    ]);
  }
});
