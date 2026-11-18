import type { Runner } from "../runtime/index.js";
import { IngressMeasurement } from "./ingress-measurement.js";
import type {
  Measurement,
  MeasurementDeps,
  MeasurementOptions,
} from "./ingress-measurement.js";
import type { HostReader, HostSnapshot } from "./ingress-host.js";
import { PacedRunner } from "./ingress-paced-runner.js";
import { cpuPerRequest, matchRate, pacingPlan } from "./ingress-pacing.js";
import type { RateCheck } from "./ingress-pacing.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method

export type RatedOptions = MeasurementOptions & {
  /**
   * Offered requests per second (KORE_INGRESS_TARGET_RPS in the live run).
   * Unset keeps the closed-loop load exactly.
   */
  targetRequestsPerSecond?: number;
};

export interface RatedMeasurementResult extends Omit<Measurement, "method"> {
  method: Measurement["method"] & {
    /** Present only for a paced load: the target and the requests per batch. */
    targetRequestsPerSecond?: number;
    batchSize?: number;
  };
  /** Present only with a target: whether the achieved rate matched it. */
  rate?: RateCheck;
  /** Median millicores per request per second at the achieved rate. */
  cpuPerRequest: { ingress?: number; ztunnel?: number };
  /**
   * The host's load, swap, free VM memory and agent panes before the run and
   * after it; absent when no host reader was given.
   */
  host?: { before: HostSnapshot; after: HostSnapshot };
}

/**
 * The ingress measurement with an optional target request rate. Without a
 * target it is the plain measurement, built from the very same arguments. With
 * one, each curl call sends one batch of about a second of the target through
 * a `PacedRunner`, and the result records whether the achieved rate matched.
 */
export class RatedMeasurement {
  constructor(
    private readonly runner: Runner,
    private readonly loadRunner: Runner,
    private readonly options: RatedOptions,
    private readonly deps: MeasurementDeps,
    private readonly host?: HostReader,
  ) {}

  /** Reads the host before and after the run, so the result says what machine it ran on. */
  async measure(): Promise<RatedMeasurementResult> {
    const before = await this.host?.read();
    const result = await this.run();
    const after = await this.host?.read();
    return before === undefined || after === undefined
      ? result
      : { ...result, host: { before, after } };
  }

  private async run(): Promise<RatedMeasurementResult> {
    const target = this.options.targetRequestsPerSecond;
    if (target === undefined) {
      const result = await new IngressMeasurement(
        this.runner,
        this.loadRunner,
        this.options,
        this.deps,
      ).measure();
      return { ...result, cpuPerRequest: this.perRequest(result) };
    }
    const plan = pacingPlan(target, this.options.requestsPerRoute);
    const result = await new IngressMeasurement(
      this.runner,
      new PacedRunner(this.loadRunner, plan.batchSeconds, this.deps),
      { ...this.options, requestsPerRoute: plan.batchSize },
      this.deps,
    ).measure();
    return {
      ...result,
      method: {
        ...result.method,
        targetRequestsPerSecond: target,
        batchSize: plan.batchSize,
      },
      rate: matchRate(target, result.load.requestsPerSecond),
      cpuPerRequest: this.perRequest(result),
    };
  }

  private perRequest(result: Measurement) {
    return cpuPerRequest(
      {
        ingress: result.summary.ingress.cpuMillicores.median,
        ztunnel: result.summary.ztunnel.cpuMillicores.median,
      },
      result.load.requestsPerSecond,
    );
  }
}
