// The variables an hc core hands its terminals from its own start environment. On the Mac a core started from a herdr
// pane passes the herdr variables down, so a terminal can look like a herdr pane. They name a backend, so they are
// recognised here only (plan 16, Findings: inherited herdr variables); a session's environment drops them.

/** Whether a variable came from the core's start environment, and so is no part of the caller's own identity. */
export function isInheritedFromCore(name: string): boolean {
  return name.startsWith("HERDR_");
}
