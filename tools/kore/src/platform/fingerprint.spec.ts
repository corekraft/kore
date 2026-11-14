import { createHash, type Hash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  type Dirent,
  type Stats,
} from "node:fs";
import type { NonSharedBuffer } from "node:buffer";
import { join, relative } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { absolute } from "../config/index.js";
import { argsFingerprint, desiredFingerprint } from "./fingerprint.js";
import { helmUpgradeArgs } from "./helm.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";

vi.mock("node:crypto");
vi.mock("node:fs");
vi.mock("node:path");
vi.mock("../config/index.js");
vi.mock("./helm.js");

const prefix = "kore desired-state sha256:";

/** The three chunks the fingerprint feeds the hash for one labelled value. */
const part = (label: string, value: string) => [
  `${label}\u0000${value.length}\u0000`,
  value,
  "\u0000",
];

/** A hash that records each chunk it is fed, so a test can assert the exact input. */
function recordingHash(chunks: string[]): Hash {
  const hash = {
    update(value: string | Buffer) {
      chunks.push(String(value));
      return hash;
    },
    digest: () => "hex-digest",
  } as unknown as Hash;
  return hash;
}

/** A directory entry as readdirSync returns it, with the one cast the Dirent class needs. */
const entry = (name: string, directory: boolean) =>
  ({
    name,
    isDirectory: () => directory,
  }) as unknown as Dirent<NonSharedBuffer>;

/** A stat result for a path that is or is not a directory. */
const stats = (directory: boolean) =>
  ({ isDirectory: () => directory }) as unknown as Stats;

/** A chart tree and its files, keyed by absolute path. */
const tree: Record<string, Dirent<NonSharedBuffer>[]> = {
  "/charts/x": [entry("templates", true), entry("Chart.yaml", false)],
  "/charts/x/templates": [entry("deployment.yaml", false)],
};
const files: Record<string, string> = {
  "/charts/x/Chart.yaml": "name: x\n",
  "/charts/x/templates/deployment.yaml": "kind: Deployment\n",
};
const chartChunks = [
  ...part("file", "Chart.yaml"),
  ...part("content", "name: x\n"),
  ...part("file", "templates/deployment.yaml"),
  ...part("content", "kind: Deployment\n"),
];

let chunks: string[];

beforeEach(() => {
  chunks = [];
  vi.mocked(createHash).mockImplementation(() => recordingHash(chunks));
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(relative).mockImplementation((from, to) =>
    to.slice(from.length + 1),
  );
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(statSync).mockImplementation(() => stats(true));
  vi.mocked(readdirSync).mockImplementation((dir) => tree[String(dir)] ?? []);
  vi.mocked(readFileSync).mockImplementation(
    (path) => files[String(path)] ?? "",
  );
  vi.mocked(absolute).mockImplementation(
    (repo, path) => `${repo.root}/${path}`,
  );
});

test("the fingerprint is the desired-state prefix and the hex digest of the hashed input", () => {
  expect(argsFingerprint(["upgrade"])).toBe(`${prefix}hex-digest`);
});

test("each argument is hashed with its label and length, so two argument lists that differ cannot collide", () => {
  argsFingerprint(["--set", "a=1"]);
  expect(chunks).toEqual([...part("arg", "--set"), ...part("arg", "a=1")]);
});

test("a --values file is hashed by its content, and a missing one is hashed as missing for Helm to report", () => {
  vi.mocked(existsSync).mockImplementation((path) => path === "vals.yaml");
  vi.mocked(readFileSync).mockReturnValue("replicas: 2\n");
  argsFingerprint(["--values", "vals.yaml", "--values", "gone.yaml"]);
  expect(readFileSync).toHaveBeenCalledWith("vals.yaml");
  expect(chunks).toEqual([
    ...part("values", "replicas: 2\n"),
    ...part("values", "missing"),
  ]);
});

test("a chart directory is hashed file by file, in sorted order, by path relative to the chart", () => {
  vi.mocked(existsSync).mockReturnValue(true);
  argsFingerprint([], "/charts/x");
  expect(chunks).toEqual(chartChunks);
});

test("another checkout of the same chart yields the same chunks, because paths are made relative", () => {
  vi.mocked(existsSync).mockReturnValue(true);
  argsFingerprint([], "/charts/x");
  const here = [...chunks];
  chunks = [];
  tree["/other/x"] = tree["/charts/x"]!;
  tree["/other/x/templates"] = tree["/charts/x/templates"]!;
  files["/other/x/Chart.yaml"] = files["/charts/x/Chart.yaml"]!;
  files["/other/x/templates/deployment.yaml"] =
    files["/charts/x/templates/deployment.yaml"]!;
  argsFingerprint([], "/other/x");
  expect(chunks).toEqual(here);
});

test("a chart path that is missing or is a file adds no chart content and reads no directory", () => {
  vi.mocked(existsSync).mockReturnValue(false);
  argsFingerprint([], "/charts/x");
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(statSync).mockReturnValue(stats(false));
  argsFingerprint([], "/charts/x");
  expect(readdirSync).not.toHaveBeenCalled();
  expect(chunks).toEqual([]);
});

test("a Helm chart from a repository is fingerprinted by its arguments alone", () => {
  const repository = fakeRepository();
  const component = fakeComponent();
  vi.mocked(helmUpgradeArgs).mockReturnValue(["upgrade", "reference"]);
  expect(desiredFingerprint(repository, component)).toBe(`${prefix}hex-digest`);
  expect(existsSync).not.toHaveBeenCalled();
  expect(helmUpgradeArgs).toHaveBeenCalledWith(repository, component);
});

test("a local chart is fingerprinted by its directory as well as its arguments", () => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(absolute).mockReturnValue("/charts/x");
  vi.mocked(helmUpgradeArgs).mockReturnValue(["upgrade", "charts/x"]);
  desiredFingerprint(
    fakeRepository(),
    fakeComponent({ kind: "local-chart", chart: "charts/x" }),
  );
  expect(readdirSync).toHaveBeenCalledWith("/charts/x", {
    withFileTypes: true,
  });
  expect(chunks).toEqual([
    ...part("arg", "upgrade"),
    ...part("arg", "charts/x"),
    ...chartChunks,
  ]);
});
