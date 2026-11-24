// The per-rollout soak of one app (#1535, ADR 0171, owner decision 5 on #1480). A contract release
// waits until the release it follows has soaked: soak.duration (default 24h, no minimum, an audit
// warning under 30m) and an optional soak.minRequests (off unless written). The verdict judges only
// what it is given: the activation time and the observed request count are the platform's soak
// evidence (#1485), passed in. Pure: the caller reads the record, the clock and the evidence.
// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md

/** The soak window a record gets when it writes none (owner decision 5 on #1480). */
export const defaultSoakDuration = "24h";

/** A window shorter than this is accepted with an audit warning, never refused. */
const auditFloorMs = 30 * 60 * 1000;

/** A whole number of minutes, hours or days: 30m, 24h, 7d. Nothing else is a duration. */
const DURATION = /^([1-9]\d*)([mhd])$/;
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** One app's soak as the record writes it; an absent field is undefined. */
export interface SoakRecord {
  duration?: string | undefined;
  minRequests?: number | undefined;
}

export interface ContractSoakInput {
  /** The app record's soak, or undefined when the record writes none. */
  record: SoakRecord | undefined;
  /** When the release the contract follows was activated, from the soak evidence; undefined when none is recorded. */
  activatedAt: Date | undefined;
  /** The clock now, passed in so the verdict stays pure. */
  now: Date;
  /** Requests through the shared gateway since activation, from the soak evidence; undefined when none is recorded. */
  observedRequests: number | undefined;
}

export interface ContractSoakVerdict {
  /** True only when nothing refuses the contract. */
  allowed: boolean;
  /** Each names what is missing and how to fix it; any refusal means the contract is not allowed. */
  refusals: string[];
  /** Accepted, but worth an audit record; a warning never refuses. */
  warnings: string[];
}

/**
 * Judges whether a contract release may run now. A record that writes no soak gets the default
 * window. A malformed duration or minRequests is refused, never guessed at, and so is a soak the
 * evidence cannot judge (no activation time, or no request count when minRequests is set): a
 * release with no recorded clock has not soaked.
 */
export function contractSoakVerdict(
  input: ContractSoakInput,
): ContractSoakVerdict {
  const duration = input.record?.duration ?? defaultSoakDuration;
  const minRequests = input.record?.minRequests;
  const durationMs = parseDuration(duration);
  const requestsWritten = minRequests !== undefined;
  const requestsValid = minRequests === undefined || isMinRequests(minRequests);

  const refusals: string[] = [];
  if (durationMs === undefined) {
    refusals.push(badDuration(duration));
  } else {
    refusals.push(...timeRefusals(input, durationMs, duration));
  }
  if (!requestsValid) {
    refusals.push(badMinRequests(minRequests));
  }
  if (durationMs !== undefined && requestsWritten && requestsValid) {
    refusals.push(...requestRefusals(input.observedRequests, minRequests));
  }

  const warnings =
    durationMs !== undefined && durationMs < auditFloorMs
      ? [shortSoakWarning(duration)]
      : [];
  return { allowed: refusals.length === 0, refusals, warnings };
}

/** The time still to soak, named in a refusal; a missing or unreadable activation time is refused, never read as elapsed. */
function timeRefusals(
  input: ContractSoakInput,
  durationMs: number,
  duration: string,
): string[] {
  const { activatedAt, now } = input;
  if (activatedAt === undefined || Number.isNaN(activatedAt.getTime())) {
    return [
      "the soak cannot be judged: no activation time is recorded for the release it follows; a contract waits for that release to be activated",
    ];
  }
  const endsAt = activatedAt.getTime() + durationMs;
  const remainingMs = endsAt - now.getTime();
  return remainingMs > 0
    ? [
        `contract refused: the release it follows soaks until ${new Date(endsAt).toISOString()}, ${formatDuration(remainingMs)} from now, of its ${duration} soak; a contract step waits for the soak`,
      ]
    : [];
}

/** The requests still missing, named in a refusal; a missing or unreadable count is refused, never read as met. */
function requestRefusals(
  observed: number | undefined,
  minRequests: number,
): string[] {
  if (observed === undefined || !Number.isFinite(observed) || observed < 0) {
    return [
      `the soak cannot be judged: soak.minRequests is ${minRequests} and no valid request count is recorded for the release it follows`,
    ];
  }
  if (observed >= minRequests) {
    return [];
  }
  const missing = minRequests - observed;
  return [
    `contract refused: ${missing} more requests are needed through the gateway during the soak (${observed} of ${minRequests}); a contract step waits for them`,
  ];
}

function isMinRequests(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function badDuration(duration: string): string {
  return `soak.duration must be a whole number of minutes, hours or days such as 30m, 24h or 7d; got "${duration}"`;
}

function badMinRequests(minRequests: number | undefined): string {
  return `soak.minRequests must be a whole number of at least 1; omit it to turn the request count off; got ${String(minRequests)}`;
}

function shortSoakWarning(duration: string): string {
  return `soak.duration ${duration} is under 30m: accepted, but a soak this short may end before a delayed failure shows; recorded for audit`;
}

/** The window in milliseconds, or undefined when the text is not a whole number of minutes, hours or days. */
function parseDuration(text: string): number | undefined {
  const match = DURATION.exec(text);
  const count = match?.[1];
  const unit = match?.[2];
  if (count === undefined || (unit !== "m" && unit !== "h" && unit !== "d")) {
    return undefined;
  }
  return Number(count) * UNIT_MS[unit];
}

/** A remaining time rounded up to whole minutes, written as days, hours and minutes, for a refusal to name. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes}m`);
  }
  return parts.join(" ");
}
