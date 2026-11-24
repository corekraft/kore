// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import { describe, expect, it } from "vitest";
import { activationVerdict } from "./activation-verdict.js";
import {
  AVAILABILITY_BREACHES,
  COLLECTOR_GAPS,
  DARK_SPAN,
  FLAG_PROOF_SPAN,
  MINUTE,
  MISSING_SERIES,
  UNUSABLE_BASELINES,
  app,
  platform,
  requestWindow,
  requests,
  window,
} from "./activation-verdict-support.js";

describe("activationVerdict fails closed on a missing series", () => {
  it.each(MISSING_SERIES)(
    "is inconclusive, naming the series, when %s is absent",
    (key, label) => {
      const result = activationVerdict(window({ [key]: undefined }));

      expect(result.verdict).toBe("inconclusive");
      expect(result.cause).toBe(`missing series: ${label}`);
    },
  );

  it("is inconclusive when a series has no measurement at all", () => {
    const result = activationVerdict(
      window({ restarts: platform([null, null, null]) }),
    );

    expect(result.cause).toBe("missing series: restarts");
  });

  it("is inconclusive when a request window's server-error series is absent", () => {
    const result = activationVerdict(
      requestWindow({
        requests: { total: platform([0, 1000]), p95Ms: platform([100]) },
      }),
    );

    expect(result.cause).toBe("missing series: server errors");
  });

  it("never reads a series an app pushed as evidence", () => {
    expect(activationVerdict(window({ restarts: app([0, 5]) })).cause).toBe(
      "missing series: restarts",
    );
    expect(
      activationVerdict(window({ replicasAvailable: app([0, 0, 0, 0]) })).cause,
    ).toBe("missing series: replicas available");
  });
});

describe("activationVerdict fails closed on the collector, scraping and failed measurements", () => {
  it.each(COLLECTOR_GAPS)(
    "is inconclusive when the collector %s data",
    (_, overrides, cause) => {
      const result = activationVerdict(window(overrides));

      expect(result.verdict).toBe("inconclusive");
      expect(result.cause).toBe(cause);
    },
  );

  it("is inconclusive on a gap in scraping, naming the gap", () => {
    const result = activationVerdict(
      window({ scrapeUp: platform([1, 0, 1, 1]) }),
    );

    expect(result.verdict).toBe("inconclusive");
    expect(result.cause).toBe(
      "scrape gap: Prometheus did not scrape the target in 1 measurement",
    );
  });

  it("tolerates three failed measurements across the window", () => {
    const result = activationVerdict(
      window({
        replicasAvailable: platform([2, null, 2, null]),
        ready: platform([1, null, 1, 1]),
      }),
    );

    expect(result.verdict).toBe("confirmed");
  });

  it("is inconclusive once failed measurements pass the tolerance", () => {
    const result = activationVerdict(
      window({
        replicasAvailable: platform([2, null, 2, null]),
        ready: platform([1, null, null, 1]),
      }),
    );

    expect(result.verdict).toBe("inconclusive");
    expect(result.cause).toBe("4 failed measurements, tolerance 3");
  });
});

describe("activationVerdict window length and disk floor", () => {
  it("is inconclusive when a dark window is shorter than 30 minutes", () => {
    const result = activationVerdict(window({ spanMs: DARK_SPAN - MINUTE }));

    expect(result.verdict).toBe("inconclusive");
    expect(result.cause).toBe(
      "window is 29 minutes; a dark window needs at least 30",
    );
  });

  it("is inconclusive when a flag-proof window is shorter than 60 minutes", () => {
    const result = activationVerdict(
      window({ kind: "flag-proof", spanMs: FLAG_PROOF_SPAN - MINUTE }),
    );

    expect(result.verdict).toBe("inconclusive");
    expect(result.cause).toBe(
      "window is 59 minutes; a flag-proof window needs at least 60",
    );
  });

  it("is inconclusive when free disk is below the 20 percent floor", () => {
    const result = activationVerdict(
      window({ freeDisk: platform([0.5, 0.19]) }),
    );

    expect(result.verdict).toBe("inconclusive");
    expect(result.cause).toBe("free disk 19% is below the 20% floor");
  });

  it("accepts a dark window of exactly 30 minutes, and free disk of exactly 20 percent", () => {
    const result = activationVerdict(
      window({ spanMs: DARK_SPAN, freeDisk: platform([0.2, 0.2]) }),
    );

    expect(result.verdict).toBe("confirmed");
  });
});

describe("activationVerdict availability-only evidence", () => {
  it("confirms a healthy window, names the availability set and never claims errors or latency", () => {
    const result = activationVerdict(window());

    expect(result.verdict).toBe("confirmed");
    expect(result.evidence.set).toBe("availability");
    expect(result.evidence.signals).toEqual([
      "replicas",
      "restarts",
      "rollout",
      "readiness",
      "free-disk",
    ]);
    expect(result.errorRatio).toBeUndefined();
  });

  it("is exempt from the request floor when it reads no request series", () => {
    expect(activationVerdict(window({ requests: null })).verdict).toBe(
      "confirmed",
    );
  });

  it.each(AVAILABILITY_BREACHES)(
    "is refuted when %s",
    (_, overrides, cause) => {
      const result = activationVerdict(window(overrides));

      expect(result.verdict).toBe("refuted");
      expect(result.cause).toBe(cause);
    },
  );

  it("refutes an availability breach ahead of a low disk floor", () => {
    const result = activationVerdict(
      window({ restarts: platform([0, 1]), freeDisk: platform([0.1, 0.1]) }),
    );

    expect(result.verdict).toBe("refuted");
    expect(result.cause).toBe("1 container restart in the window");
  });

  it("is inconclusive, not refuted, when a collector drop hides an availability breach", () => {
    const result = activationVerdict(
      window({
        restarts: platform([0, 1]),
        collectorDropped: platform([0, 2]),
      }),
    );

    expect(result.verdict).toBe("inconclusive");
    expect(result.cause).toBe(
      "the collector dropped telemetry over the window (2)",
    );
  });
});

describe("activationVerdict request floor and error ratio", () => {
  it("is inconclusive when fewer than 100 requests arrive, naming the count", () => {
    const result = activationVerdict(
      requestWindow({ requests: requests([0, 37], [0, 0], [100]) }),
    );

    expect(result.verdict).toBe("inconclusive");
    expect(result.cause).toBe(
      "37 of 100 requests over the window; too little traffic to judge errors or latency",
    );
  });

  it("accepts exactly 100 requests and carries the error ratio's numerator and denominator", () => {
    const result = activationVerdict(
      requestWindow({ requests: requests([0, 100], [0, 1], [100]) }),
    );

    expect(result.verdict).toBe("confirmed");
    expect(result.errorRatio).toEqual({
      errors: 1,
      requests: 100,
      ratio: 0.01,
    });
  });

  it("is refuted when the error ratio is above the 5 percent cap", () => {
    const result = activationVerdict(
      requestWindow({
        requests: requests([0, 1000], [0, 60], [100]),
        baseline: undefined,
      }),
    );

    expect(result.verdict).toBe("refuted");
    expect(result.cause).toBe(
      "server errors 60 of 1000 requests (6%) exceed the 5% cap",
    );
  });

  it("accepts an error ratio of exactly 5 percent on the cap, on a first release", () => {
    const result = activationVerdict(
      requestWindow({
        requests: requests([0, 1000], [0, 50], [100]),
        baseline: undefined,
      }),
    );

    expect(result.verdict).toBe("confirmed");
  });

  it("judges a first release on the absolute cap only, with no baseline", () => {
    const result = activationVerdict(
      requestWindow({
        requests: requests([0, 1000], [0, 40], [100]),
        baseline: undefined,
      }),
    );

    expect(result.verdict).toBe("confirmed");
    expect(result.baseline).toBe("absent");
  });
});

describe("activationVerdict error ratio against the baseline", () => {
  it("is refuted when the error ratio is above the baseline plus 2 points, under the cap", () => {
    const result = activationVerdict(
      requestWindow({ requests: requests([0, 1000], [0, 50], [100]) }),
    );

    expect(result.verdict).toBe("refuted");
    expect(result.cause).toBe(
      "error ratio 5% is above the baseline 1% plus 2 points",
    );
  });

  it("confirms an error ratio within 2 points of the baseline", () => {
    const result = activationVerdict(
      requestWindow({ requests: requests([0, 1000], [0, 25], [100]) }),
    );

    expect(result.verdict).toBe("confirmed");
  });

  it.each(UNUSABLE_BASELINES)(
    "ignores a baseline that %s and judges on the cap",
    (_, unusable) => {
      const result = activationVerdict(
        requestWindow({
          requests: requests([0, 1000], [0, 40], [100]),
          baseline: unusable,
        }),
      );

      expect(result.verdict).toBe("confirmed");
      expect(result.baseline).toBe("unusable");
    },
  );
});

describe("activationVerdict latency and request-window confirmation", () => {
  it("is refuted when p95 is above twice the baseline and above the 250 ms floor", () => {
    const result = activationVerdict(
      requestWindow({ requests: requests([0, 1000], [0, 10], [300]) }),
    );

    expect(result.verdict).toBe("refuted");
    expect(result.cause).toBe(
      "p95 latency 300 ms is above twice the baseline 100 ms and above the 250 ms floor",
    );
  });

  it("does not refute p95 above twice the baseline when it stays under the 250 ms floor", () => {
    const result = activationVerdict(
      requestWindow({ requests: requests([0, 1000], [0, 10], [220]) }),
    );

    expect(result.verdict).toBe("confirmed");
  });

  it("skips the latency check on a first release, however slow p95 is", () => {
    const result = activationVerdict(
      requestWindow({
        requests: requests([0, 1000], [0, 10], [5000]),
        baseline: undefined,
      }),
    );

    expect(result.verdict).toBe("confirmed");
    expect(result.evidence.signals).not.toContain("p95");
  });

  it("names the request signals it read when a request window confirms", () => {
    const result = activationVerdict(requestWindow());

    expect(result.evidence.set).toBe("availability+requests");
    expect(result.evidence.signals).toEqual(
      expect.arrayContaining(["error-ratio", "p95"]),
    );
  });
});
