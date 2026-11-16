import { describe, expect, it } from "vitest";
import { ev } from "./report-support.js";
import { stageStamp, stampedStages } from "./stamped-stage.js";

const launch = (stage?: string) =>
  ev(1, "session.launch", {
    source: "herdr",
    agent: "image-trust-reader",
    ...(stage === undefined ? {} : { stage }),
  });

describe("stampedStages and stageStamp place a stamped session's events", () => {
  it("places the launch event itself in the stamped stage", () => {
    const event = launch("verify");

    expect(stageStamp(event, stampedStages([event]))).toBe("verify");
  });

  it("places a later event of the same session in the stamped stage", () => {
    const stamps = stampedStages([launch("verify")]);

    expect(
      stageStamp(ev(5, "tool.start", { agent: "image-trust-reader" }), stamps),
    ).toBe("verify");
  });

  it("leaves an event of another session unplaced", () => {
    const stamps = stampedStages([launch("verify")]);

    expect(
      stageStamp(ev(5, "tool.start", { agent: "other-reader" }), stamps),
    ).toBeUndefined();
  });

  it("stamps nothing for a launch with no stage, as a reader with no PR", () => {
    const event = launch();

    expect(stageStamp(event, stampedStages([event]))).toBeUndefined();
  });

  it("ignores a stage that is not one of the loop's stages", () => {
    const event = launch("nonsense");

    expect(stageStamp(event, stampedStages([event]))).toBeUndefined();
  });

  it("places an event with no session name nowhere", () => {
    const stamps = stampedStages([launch("verify")]);

    expect(stageStamp(ev(5, "tool.start"), stamps)).toBeUndefined();
  });
});
