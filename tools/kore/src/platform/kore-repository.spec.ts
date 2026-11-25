// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)
import { expect, test } from "vitest";
import { fakeRepository, fakeRunner } from "./platform-support.js";
import { koreRepositoryURL } from "./kore-repository.js";

// Issue 1553: the Kore repository URL is the git origin, read the same way by every command
// that composes a delivery value from it, so the golden-path sync and the suborg AppProjects
// name one repository, and a read-only render sees the same URL that up does.

const repository = fakeRepository();

function origin(remote: string) {
  return fakeRunner(() => `${remote}\n`);
}

test("the Kore repository URL is the git origin, as it is given when https", async () => {
  expect(
    await koreRepositoryURL(
      repository,
      origin("https://github.com/corekraft/kore.git").runner,
      "the suborg AppProjects need",
    ),
  ).toBe("https://github.com/corekraft/kore.git");
});

test("an origin that is not https refuses the Kore repository URL, naming what needs it and the fix", async () => {
  await expect(
    koreRepositoryURL(
      repository,
      origin("git@github.com:corekraft/kore.git").runner,
      "the suborg AppProjects need",
    ),
  ).rejects.toThrow(
    "the git origin git@github.com:corekraft/kore.git is not an https URL, which the suborg AppProjects need; set origin to the https URL of the repository",
  );
});
