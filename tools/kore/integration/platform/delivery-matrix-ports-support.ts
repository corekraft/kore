import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { enabledComponents, type Repository } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";
import { renderDelivery } from "../platform-config-delivery-project-support.js";
import {
  deliveredApplications,
  renderDelivered,
  type FlagSet,
} from "./delivery-matrix-support.js";
import {
  generatedPorts,
  merge,
  overlayPorts,
} from "./gateway-service-ports-support.js";

const run = promisify(execFile);

interface Port {
  name?: string;
  port: number;
}

/** The Services in a render, by name, with each one's ports. */
function servicePorts(text: string): Map<string, Port[]> {
  const services = new Map<string, Port[]>();
  for (const doc of text.split(/^---$/m)) {
    if (!/^kind: Service$/m.test(doc)) {
      continue;
    }
    const name = /^ {2}name: (\S+)$/m.exec(doc)?.[1] ?? "";
    const block = /^ {2}ports:\n((?: {4,}.*\n?)+)/m.exec(doc)?.[1] ?? "";
    services.set(
      name,
      block
        .split(/^ {4}- /m)
        .filter((entry) => entry.trim() !== "")
        .map((entry) => {
          const field = (key: string) =>
            new RegExp(`(?:^|\\s)${key}: (\\S+)`).exec(entry)?.[1];
          const portName = field("name");
          return {
            ...(portName === undefined ? {} : { name: portName }),
            port: Number(field("port")),
          };
        }),
    );
  }
  return services;
}

/** Each HTTPRoute backend whose Service is missing, lacks the port, or leaves the port unnamed. */
function routePortProblems(
  set: FlagSet,
  chart: string,
  text: string,
): string[] {
  const services = servicePorts(text);
  return text
    .split(/^---$/m)
    .filter((doc) => /^kind: HTTPRoute$/m.test(doc))
    .flatMap((doc) =>
      [...doc.matchAll(/- name: (\S+)\n\s+port: (\d+)/g)].map((m) => {
        const route = /^ {2}name: (\S+)$/m.exec(doc)?.[1] ?? "?";
        const ports = services.get(m[1]!);
        const where = `[${set.label}] ${chart} HTTPRoute ${route} sends to Service ${m[1]!} port ${m[2]!}`;
        const match = ports?.find((p) => p.port === Number(m[2]));
        if (ports === undefined) {
          return `${where}, but ${chart} renders no such Service; fix: render the Service or name the right one`;
        }
        if (match === undefined) {
          return `${where}, which the Service does not expose; fix: use one of ${ports.map((p) => p.port).join(", ")}`;
        }
        return ports.length > 1 && match.name === undefined
          ? `${where}, which is unnamed in a Service with several ports; fix: name every port`
          : "";
      }),
    )
    .filter((problem) => problem !== "");
}

/** Every Gateway Service port is named once merged, and every Route's port is a named Service port. */
export async function portProblems(
  set: FlagSet,
  repository: Repository,
): Promise<string[]> {
  const { docs } = await renderDelivery(repository);
  const problems: string[] = [];
  for (const application of deliveredApplications(docs)) {
    const { text } = await renderDelivered(repository, application);
    problems.push(...routePortProblems(set, application.name, text));
    if (application.name === "kore-platform-config") {
      const merged = merge(
        generatedPorts(
          application.parameters["gateway.className"]!,
          repository.environment.gateway.port,
        ),
        overlayPorts(text),
      );
      problems.push(
        ...merged
          .filter((p) => !p.name)
          .map(
            (p) =>
              `[${set.label}] kore-platform-config's Gateway Service port ${p.port} is unnamed once merged with the controller's ports; fix: name it in templates/gateway-service.yaml`,
          ),
      );
    }
  }
  // The portal's charts are Helm-owned, not delivered, but their Route goes to a
  // Service of their own, so the same reference is checked on the Helm path.
  const portal = enabledComponents(repository).find(
    (c) => c.name === "kore-platform-backstage",
  );
  if (portal !== undefined) {
    const { stdout } = await run(
      "helm",
      withAbsoluteChart(
        repository,
        portal,
        helmTemplateArgs(repository, portal),
      ),
    );
    problems.push(...routePortProblems(set, portal.name, stdout));
  }
  return problems;
}
