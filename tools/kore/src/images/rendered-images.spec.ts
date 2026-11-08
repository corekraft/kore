import { expect, test } from "vitest";
import {
  normalizeImage,
  renderedImages,
  unapprovedImages,
} from "./rendered-images.js";

const digest = (c: string): string => `sha256:${c.repeat(64)}`;

test("renderedImages finds container, initContainer and ephemeral images", () => {
  const manifest = `
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      initContainers:
        - name: init
          image: "ghcr.io/a/init:1@${digest("1")}"
      containers:
        - name: app
          image: ghcr.io/a/app:2
      ephemeralContainers:
        - name: debug
          image: ghcr.io/a/debug:3
`;
  expect(renderedImages(manifest)).toEqual([
    `ghcr.io/a/init:1@${digest("1")}`,
    "ghcr.io/a/app:2",
    "ghcr.io/a/debug:3",
  ]);
});

test("renderedImages finds images passed through env and arguments", () => {
  const manifest = `
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: op
          args:
            - --collector-image=ghcr.io/o/collector:0.1
            - --leader-elect
          env:
            - name: OPERATOR_IMAGE_NAME
              value: "ghcr.io/c/operator:1.0"
            - name: LOG_LEVEL
              value: debug
`;
  expect(renderedImages(manifest)).toEqual([
    "ghcr.io/o/collector:0.1",
    "ghcr.io/c/operator:1.0",
  ]);
});

test("renderedImages ignores helm test hooks and unrendered template lines, and reports each image once", () => {
  const manifest = `
kind: Pod
metadata:
  annotations:
    "helm.sh/hook": test
spec:
  containers:
    - image: docker.io/bats/bats:v1
---
kind: ConfigMap
data:
  template: |
    image: {{ .ProxyImage }}
---
kind: Deployment
spec:
  template:
    spec:
      containers:
        - image: ghcr.io/a/app:2
        - image: ghcr.io/a/app:2
`;
  expect(renderedImages(manifest)).toEqual(["ghcr.io/a/app:2"]);
});

test("renderedImages finds images a chart carries in embedded JSON values", () => {
  const manifest = `
kind: ConfigMap
data:
  values: |-
    {
      "global": { "proxy": { "image": "docker.io/istio/proxyv2:1@${digest("2")}" } },
      "other": { "image": "" }
    }
`;
  expect(renderedImages(manifest)).toEqual([
    `docker.io/istio/proxyv2:1@${digest("2")}`,
  ]);
});

test("renderedImages does not mistake a CRD schema property named image for an image reference", () => {
  const manifest = `
kind: CustomResourceDefinition
spec:
  versions:
    - schema:
        openAPIV3Schema:
          properties:
            image:
              description: The container image.
              type: string
            collector:
              properties:
                image:
                  type: string
`;
  expect(renderedImages(manifest)).toEqual([]);
});

test("normalizeImage resolves Docker Hub shorthand to one repository name", () => {
  expect(normalizeImage(`registry:3.1.2@${digest("a")}`)).toEqual({
    repository: "docker.io/library/registry",
    digest: digest("a"),
  });
  expect(normalizeImage("openpolicyagent/opa:1.2-envoy")).toEqual({
    repository: "docker.io/openpolicyagent/opa",
  });
  expect(normalizeImage("index.docker.io/istio/proxyv2:1")).toEqual({
    repository: "docker.io/istio/proxyv2",
  });
  expect(normalizeImage(`localhost:5000/x/y:1@${digest("b")}`)).toEqual({
    repository: "localhost:5000/x/y",
    digest: digest("b"),
  });
});

const approved = [`docker.io/istio/pilot:1.31.4@${digest("a")}`];

test("unapprovedImages accepts an image whose repository and digest are approved, whatever the tag spelling", () => {
  expect(
    unapprovedImages([`istio/pilot:other@${digest("a")}`], approved),
  ).toEqual([]);
});

test("unapprovedImages rejects a tag-only reference", () => {
  expect(unapprovedImages(["docker.io/istio/pilot:1.31.4"], approved)).toEqual([
    "docker.io/istio/pilot:1.31.4: not pinned by digest",
  ]);
});

test("unapprovedImages rejects a digest that is approved only for another repository", () => {
  expect(
    unapprovedImages([`docker.io/evil/pilot:1@${digest("a")}`], approved),
  ).toEqual([
    `docker.io/evil/pilot:1@${digest("a")}: not in the approved image list`,
  ]);
});

test("unapprovedImages rejects a new digest of an approved repository, which is what a chart bump looks like", () => {
  expect(
    unapprovedImages([`docker.io/istio/pilot:1.31.5@${digest("c")}`], approved),
  ).toEqual([
    `docker.io/istio/pilot:1.31.5@${digest("c")}: not in the approved image list`,
  ]);
});
