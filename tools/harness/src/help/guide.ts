/** A domain's guide: what it is for, its usual flow, and the related commands it names as `<domain> <command>`. */
export interface DomainGuide {
  purpose: string;
  flow: string;
  seeAlso?: string[];
}

/** One of the root guide's common flows: a name, and its steps, each a `<domain> <command>` the harness has. */
export interface RootFlow {
  name: string;
  steps: string[];
}

/** The root guide: what the harness is, its common flows as data, and how to go deeper. */
export interface RootGuide {
  what: string;
  flows: RootFlow[];
  deeper: string;
}
