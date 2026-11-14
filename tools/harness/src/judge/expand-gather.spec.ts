import { describe, expect, it, vi } from "vitest";
import { gatherExpandStep } from "./expand-gather.js";
import { readExpandStep } from "./expand-step.js";
import type { Api } from "./manifest-source.js";

// The gatherer only maps the contract's declaration onto the reader, so the reader is mocked.
vi.mock("./expand-step.js");

const OWNER = "junners";
const HEAD_COMMITTED = "2026-11-14T16:00:00Z";
const DECLARED = { idea: "502", expandStep: 547 };

describe("gatherExpandStep hands a contract's declared expand step to the reader", () => {
  it("reads the declared expand PR and idea, with the head commit time and reviewers, through the caller's gh api", async () => {
    const api = vi.fn<Api>();
    vi.mocked(readExpandStep).mockResolvedValue({ result: "pass" });
    await gatherExpandStep({
      api,
      pr: 584,
      view: { headCommittedAt: HEAD_COMMITTED },
      reviewers: [OWNER],
      declared: DECLARED,
    });
    expect(readExpandStep).toHaveBeenCalledExactlyOnceWith(api, {
      pr: 584,
      expandPr: 547,
      idea: "502",
      headCommittedAt: HEAD_COMMITTED,
      reviewers: [OWNER],
    });
  });

  it("returns the reader's check as it is, with its detail", async () => {
    vi.mocked(readExpandStep).mockResolvedValue({
      result: "missing",
      detail: "no proof",
    });
    await expect(
      gatherExpandStep({
        api: vi.fn<Api>(),
        pr: 584,
        view: { headCommittedAt: HEAD_COMMITTED },
        reviewers: [OWNER],
        declared: DECLARED,
      }),
    ).resolves.toEqual({ result: "missing", detail: "no proof" });
  });

  it("passes no head time to the reader when the PR lists no commit", async () => {
    vi.mocked(readExpandStep).mockResolvedValue({ result: "missing" });
    await gatherExpandStep({
      api: vi.fn<Api>(),
      pr: 584,
      view: { headCommittedAt: undefined },
      reviewers: [OWNER],
      declared: DECLARED,
    });
    expect(readExpandStep).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ headCommittedAt: undefined }),
    );
  });

  it("reads gh only through the reader, never with its own call", async () => {
    const api = vi.fn<Api>();
    vi.mocked(readExpandStep).mockResolvedValue({ result: "pass" });
    await gatherExpandStep({
      api,
      pr: 584,
      view: { headCommittedAt: HEAD_COMMITTED },
      reviewers: [OWNER],
      declared: DECLARED,
    });
    expect(api).not.toHaveBeenCalled();
  });
});
