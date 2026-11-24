import type { RolloutChart } from "../ledger/index.js";
import { sha256Digest } from "./digest.js";

/** A rollout that cannot be recorded: the message names the lock or tag at fault and how to fix it. */
export class RolloutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RolloutError";
  }
}

/** What a recorded rollout holds, read from the two release locks. */
export interface RolloutLocks {
  chartLock: string;
  imageLock: string;
  charts: RolloutChart[];
}

const TAG = /^v\d+\.\d+\.\d+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RELEASE_SIGNER =
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/\.github\/workflows\/release\.yaml@refs\/tags\/(v\d+\.\d+\.\d+)$/;

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseLock(text: string, which: string, file: string): Obj {
  let lock: unknown;
  try {
    lock = JSON.parse(text);
  } catch {
    lock = undefined;
  }
  if (!isObject(lock) || lock["version"] !== 1) {
    throw new RolloutError(
      `The ${which} is not a {version: 1, authorizedSigners, entries} lock; pass the ${file} attached to the release.`,
    );
  }
  return lock;
}

/** Refuses a lock unless every authorized signer is release.yaml at exactly this tag, and at least one is named. */
function assertSignedAtTag(lock: Obj, which: string, tag: string): void {
  const signers = lock["authorizedSigners"];
  const named = Array.isArray(signers) ? signers : [];
  const atTag = (signer: unknown) =>
    typeof signer === "string" && RELEASE_SIGNER.exec(signer)?.[1] === tag;
  if (named.length === 0 || !named.every(atTag)) {
    const found =
      named.length === 0 ? "no signer" : named.map(String).join(", ");
    throw new RolloutError(
      `The ${which} is not the release lock for ${tag}: it is signed by ${found}, and a recorded rollout takes only a lock whose every authorized signer is release.yaml@refs/tags/${tag}. Pass the lock attached to that release; a main lock serves a local proof only.`,
    );
  }
}

function chartsOf(lock: Obj, file: string): RolloutChart[] {
  const entries = lock["entries"];
  const found = isObject(entries) ? Object.entries(entries) : [];
  const charts = found.map(([name, entry]) => {
    const version = isObject(entry) ? entry["version"] : undefined;
    const digest = isObject(entry) ? entry["digest"] : undefined;
    if (
      typeof version !== "string" ||
      version === "" ||
      typeof digest !== "string" ||
      !DIGEST.test(digest)
    ) {
      throw new RolloutError(
        `The chart lock entry ${name} needs a version and a sha256 digest; pass the ${file} attached to the release.`,
      );
    }
    return { name, version, digest };
  });
  if (charts.length === 0) {
    throw new RolloutError(
      `The chart lock holds no charts; pass the ${file} attached to the release.`,
    );
  }
  return charts;
}

/**
 * Reads the release's two locks into what a rollout records: the sha256 of each
 * lock file and each chart's name, version and entry digest. It refuses a lock
 * that is not signed only by release.yaml at the tag, before anything is hashed,
 * so a main lock is never recorded as a rollout (ADR 0150).
 */
export function readRolloutLocks(input: {
  tag: string;
  chart: string;
  image: string;
}): RolloutLocks {
  const { tag, chart, image } = input;
  if (!TAG.test(tag)) {
    throw new RolloutError(
      `${tag} is not a release tag; pass the tag of the release whose locks were rolled out, such as v1.4.0.`,
    );
  }
  const chartFile = parseLock(chart, "chart lock", "platform-charts.lock.json");
  const imageFile = parseLock(image, "image lock", "platform-images.lock.json");
  assertSignedAtTag(chartFile, "chart lock", tag);
  assertSignedAtTag(imageFile, "image lock", tag);
  return {
    chartLock: sha256Digest(chart),
    imageLock: sha256Digest(image),
    charts: chartsOf(chartFile, "platform-charts.lock.json"),
  };
}
