import { loadavg } from "node:os";

/** The host's one-minute load average, read through an interface so specs never read the real host. */
export interface HostLoad {
  oneMinute(): number;
}

/** Reads the real load average. A host that reports none reads as infinitely loaded, so a load check fails closed. */
export const systemHostLoad: HostLoad = {
  oneMinute: () => loadavg()[0] ?? Number.POSITIVE_INFINITY,
};
