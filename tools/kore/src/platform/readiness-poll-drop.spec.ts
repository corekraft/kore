import { expect, test } from "vitest";
import {
  controlPlaneRestartCause,
  isControlPlaneDrop,
} from "./readiness-poll.js";

test("kubectl's connection refused from the API server is a control-plane drop", () => {
  expect(
    isControlPlaneDrop(
      "The connection to the server 127.0.0.1:6443 was refused - did you specify the right host or port?",
    ),
  ).toBe(true);
});

test("a watch that ends on EOF from a previous attempt is a control-plane drop (#1309)", () => {
  expect(
    isControlPlaneDrop(
      'E1119 07:27:31 reflector.go:1 "Failed to watch" err="context canceled - error from a previous attempt: EOF"',
    ),
  ).toBe(true);
});

test("kubectl's unable-to-connect EOF is a control-plane drop", () => {
  expect(isControlPlaneDrop("Unable to connect to the server: EOF")).toBe(true);
});

test("an APIService that times out with no connection error is not named as a restart", () => {
  expect(
    isControlPlaneDrop(
      "error: timed out waiting for the condition on apiservices/v1beta1.metrics.k8s.io",
    ),
  ).toBe(false);
});

test("a webhook that closes on EOF is not taken for the API server restarting", () => {
  expect(
    isControlPlaneDrop(
      'Internal error occurred: failed calling webhook "policy.sigstore.dev": failed to call webhook: Post "https://webhook.cosign-system.svc:443/mutations?timeout=10s": EOF',
    ),
  ).toBe(false);
});

test("the restart cause names the k3s server container and the commands that show its exit", () => {
  expect(controlPlaneRestartCause("k3d-kore-local")).toBe(
    "control-plane restart: the Kubernetes API dropped the connection (EOF or connection refused), so the k3s server k3d-kore-local-server-0 restarted. Check its exit with docker logs k3d-kore-local-server-0 (a level=fatal line names it) and docker inspect --format '{{.RestartCount}}' k3d-kore-local-server-0, then rerun kore local up.",
  );
});
