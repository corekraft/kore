// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";
import { xrdCheck } from "./readiness-xrd.js";

vi.mock("./readiness-poll.js");

// One probe, then the reason it gives becomes the failure, as pollUntil does at its bound.
beforeEach(() => {
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    const reason = await probe();
    if (reason !== undefined) {
      throw new Error(reason);
    }
  });
});

const NAME = "services.platform.kore.dev";
const RESOURCE = `compositeresourcedefinition.apiextensions.crossplane.io/${NAME}`;
const base = ["--context", "local-kore", "--namespace", "crossplane-system"];

type Schema = { properties?: Record<string, Schema>; items?: Schema };

/** An XRD object as kubectl prints it: its generation, its Established condition and its schema. */
function xrd(options: {
  generation?: number;
  established?: { status?: string; observedGeneration?: number };
  conditions?: unknown[];
  spec?: Record<string, Schema>;
}): string {
  const established = options.established ?? { observedGeneration: 5 };
  return JSON.stringify({
    metadata: { name: NAME, generation: options.generation ?? 5 },
    spec: {
      versions: [
        {
          name: "v1alpha1",
          schema: {
            openAPIV3Schema: {
              properties: {
                spec: { properties: options.spec ?? declared },
              },
            },
          },
        },
      ],
    },
    status: {
      conditions: options.conditions ?? [
        {
          type: "Established",
          status: established.status ?? "True",
          ...(established.observedGeneration === undefined
            ? {}
            : { observedGeneration: established.observedGeneration }),
        },
      ],
    },
  });
}

const declared: Record<string, Schema> = {
  organization: {},
  components: { properties: { frontend: { properties: { resources: {} } } } },
  soak: { properties: { duration: {} } },
  secrets: { items: { properties: { name: {} } } },
};

/** A CRD object as kubectl prints it: the version's spec schema, with the fields Crossplane adds. */
function crd(spec: Record<string, Schema>): string {
  return JSON.stringify({
    metadata: { name: NAME },
    spec: {
      versions: [
        {
          name: "v1alpha1",
          schema: {
            openAPIV3Schema: {
              properties: {
                spec: {
                  properties: { ...spec, compositionRef: {}, crossplane: {} },
                },
              },
            },
          },
        },
      ],
    },
  });
}

/** A runner that answers the XRD read and the CRD read by the resource kubectl is asked for. */
function checkWith(replies: { xrd: string | Error; crd?: string | Error }) {
  const run = vi.fn<Runner["run"]>(async (_command, args) => {
    const reply = args.includes(RESOURCE) ? replies.xrd : replies.crd;
    if (reply === undefined) {
      throw new Error(`unexpected kubectl call: ${args.join(" ")}`);
    }
    if (reply instanceof Error) {
      throw reply;
    }
    return { stdout: reply, stderr: "", code: 0 };
  });
  const check = xrdCheck({ runner: { run }, base }, RESOURCE);
  return { check, run };
}

test("a rendered XRD whose condition observed its generation and whose CRD has every declared field passes", async () => {
  const { check } = checkWith({ xrd: xrd({}), crd: crd(declared) });
  await expect(check?.run("0s")).resolves.toBeUndefined();
});

test("a resource that is not an XRD has no xrd check", () => {
  const { check } = checkWith({ xrd: xrd({}) });
  expect(
    xrdCheck(
      { runner: { run: vi.fn() }, base },
      "crd/services.platform.kore.dev",
    ),
  ).toBeUndefined();
  expect(check).toBeDefined();
});

test("an XRD whose Established condition observed an older generation fails naming both generations, though Established is True", async () => {
  const { check } = checkWith({
    xrd: xrd({ generation: 5, established: { observedGeneration: 3 } }),
    crd: crd(declared),
  });
  const failure = check?.run("0s");
  await expect(failure).rejects.toThrow(/generation 5/);
  await expect(failure).rejects.toThrow(/observed generation 3/);
  await expect(failure).rejects.toThrow(/EstablishComposite/);
});

test("an Established condition with no observed generation fails closed", async () => {
  const { check } = checkWith({
    xrd: xrd({ established: {} }),
    crd: crd(declared),
  });
  await expect(check?.run("0s")).rejects.toThrow(/observed no generation/);
});

test("an XRD with no Established condition fails naming it", async () => {
  const { check } = checkWith({ xrd: xrd({ conditions: [] }) });
  await expect(check?.run("0s")).rejects.toThrow(/no Established condition/);
});

test("an XRD that is not Established fails naming its status", async () => {
  const { check } = checkWith({
    xrd: xrd({ established: { status: "False", observedGeneration: 5 } }),
  });
  await expect(check?.run("0s")).rejects.toThrow(/Established is False/);
});

test("a CRD that lacks fields the XRD declares fails naming them and the cause to read", async () => {
  const { check } = checkWith({
    xrd: xrd({}),
    crd: crd({ organization: {} }),
  });
  const failure = check?.run("0s");
  await expect(failure).rejects.toThrow(/lacks 3 field\(s\) the XRD declares/);
  await expect(failure).rejects.toThrow(
    /spec\.components\.frontend\.resources/,
  );
  await expect(failure).rejects.toThrow(/spec\.secrets\[\]\.name/);
  await expect(failure).rejects.toThrow(/EstablishComposite/);
});

test("a long list of missing fields names the first few and the count of the rest", async () => {
  const many = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`field${i}`, {}]),
  );
  const { check } = checkWith({ xrd: xrd({ spec: many }), crd: crd({}) });
  const failure = check?.run("0s");
  await expect(failure).rejects.toThrow(/lacks 12 field\(s\)/);
  await expect(failure).rejects.toThrow(/and 7 more/);
});

test("an XRD that does not exist yet waits with a reason, and a CRD that does not exist yet does too", async () => {
  const missing = new Error("Error from server (NotFound): not found");
  await expect(checkWith({ xrd: missing }).check?.run("0s")).rejects.toThrow(
    /does not exist yet/,
  );
  await expect(
    checkWith({ xrd: xrd({}), crd: missing }).check?.run("0s"),
  ).rejects.toThrow(/CRD services\.platform\.kore\.dev does not exist yet/);
});

test("an error that is not a missing object is rethrown, not read as not ready", async () => {
  const { check } = checkWith({ xrd: new Error("connection refused") });
  await expect(check?.run("0s")).rejects.toThrow(/connection refused/);
});
