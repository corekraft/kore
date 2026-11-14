import { MemoryFileSystem } from "../testing/index.js";
import { FakeRunner } from "../testing/index.js";
import { pollHerdr } from "./herdr-poll.js";
import { Ledger } from "./ledger.js";

export const PATH = "/repo/.kore/state/ledger.jsonl";

export interface Agent {
  pane_id: string;
  agent_status: string;
  name?: string;
  agent?: string;
}

const agentList = (agents: Agent[]) =>
  JSON.stringify({
    id: "cli:agent:list",
    result: { agents, type: "agent_list" },
  });

export const writer = (status: string): Agent => ({
  pane_id: "w3:p74",
  agent_status: status,
  name: "ledger-poll-herdr-writer",
  agent: "claude",
});

/** A clock that moves one second on every read, so occurred-at and recorded-at differ. */
export function setup() {
  const fs = new MemoryFileSystem();
  let tick = 0;
  const clock = {
    now: () => new Date(Date.UTC(2026, 0, 2, 3, 0, tick++)),
    sleep: () => Promise.resolve(),
  };
  let n = 0;
  const ledger = new Ledger(fs, clock, { next: () => `id-${++n}` }, PATH);
  const answer = { stdout: agentList([]), code: 0, stderr: "" };
  const runner = new FakeRunner([
    {
      match: (c, a) => c === "herdr" && a[0] === "agent" && a[1] === "list",
      result: answer,
    },
  ]);
  const poll = () => pollHerdr({ ledger, runner, clock, fs });
  const show = (agents: Agent[]) => {
    answer.stdout = agentList(agents);
  };
  const kinds = async () =>
    (await ledger.list({})).events.map((e) => `${e.kind}:${e.pane}`);
  return { fs, ledger, runner, poll, show, kinds, answer };
}
