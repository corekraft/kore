import { beforeEach, expect, test, vi } from "vitest";
import { approvedImageList, type Repository } from "../config/index.js";
import { fakeRepository } from "./images.fixtures.js";
import { managedLockErrors } from "./managed-lock.js";
import { platformImageLockErrors } from "./platform-image-lock.js";

vi.mock("../config/index.js");
vi.mock("./platform-image-lock.js");

const MIRROR = "ghcr.io/corekraft/kore/mirror";
const SIGNER =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.3.1";
const approved = [{ name: "grafana" }, { name: "loki" }];

/** A managed environment whose overlay admits the given signers. */
function managed(subjects: string[] = [SIGNER]): Repository {
  return {
    ...fakeRepository({ name: "managed-example", platformMirror: MIRROR }),
    imageTrustValues: { trust: { subjects } },
  } as unknown as Repository;
}

/** A lock as the release emits it: both approved images mirrored and signed. */
function lock(overrides: Record<string, unknown> = {}) {
  const entries = Object.fromEntries(
    approved.map(({ name }) => [
      name,
      { mirror: `${MIRROR}/${name}@sha256:${"a".repeat(64)}` },
    ]),
  );
  return { version: 1, authorizedSigners: [SIGNER], entries, ...overrides };
}

beforeEach(() => {
  vi.mocked(approvedImageList).mockReturnValue(
    approved as unknown as ReturnType<typeof approvedImageList>,
  );
  vi.mocked(platformImageLockErrors).mockReturnValue([]);
});

test("a lock that matches the approved list and is signed by an admitted identity has no errors", () => {
  const repository = managed();

  expect(managedLockErrors(lock(), repository)).toEqual([]);
  expect(platformImageLockErrors).toHaveBeenCalledWith(lock(), approved);
});

test("an environment with no platformMirror cannot be checked against a lock, and the platform check is not run", () => {
  const repository = fakeRepository({
    name: "local",
    platformMirror: undefined,
  });

  expect(managedLockErrors(lock(), repository)).toEqual([
    "environment local declares no platformMirror; there is no managed overlay to check the lock against",
  ]);
  expect(platformImageLockErrors).not.toHaveBeenCalled();
});

test("the platform's own lock errors come first, unchanged", () => {
  vi.mocked(platformImageLockErrors).mockReturnValue([
    "grafana: mirror digest is not the approved digest",
  ]);

  expect(managedLockErrors(lock(), managed())).toEqual([
    "grafana: mirror digest is not the approved digest",
  ]);
});

test("a mirror that is not under the environment's platformMirror is named with the mirror it should sit under", () => {
  const misplaced = lock();
  misplaced.entries["grafana"] = {
    mirror: "ghcr.io/other/mirror/grafana@sha256:x",
  };

  expect(managedLockErrors(misplaced, managed())).toEqual([
    `grafana: lock mirror ghcr.io/other/mirror/grafana@sha256:x is not under platformMirror ${MIRROR} of environment managed-example`,
  ]);
});

test("a mirror that is not a string is not judged by the mirror rule", () => {
  const odd = lock();
  odd.entries["grafana"] = { mirror: 42 } as unknown as { mirror: string };

  expect(managedLockErrors(odd, managed())).toEqual([]);
});

test("a lock signed by an identity the managed policy does not admit names the subject to add to the overlay", () => {
  const other = SIGNER.replace("v0.3.1", "v9.9.9");
  const repository = managed([SIGNER]);

  expect(
    managedLockErrors(lock({ authorizedSigners: [other] }), repository),
  ).toEqual([
    `lock signer ${other} is not admitted by kore-image-policy in environment managed-example; add it to trust.subjects in its values overlay`,
  ]);
});

test("a lock with no entries or signers is left to the platform's check, with nothing added here", () => {
  expect(managedLockErrors({}, managed())).toEqual([]);
});
