// The routes' hosts and the platform Gateway's listener hostnames are written
// in different charts; this reads the rendered manifests of both and reports a
// host no listener serves, before a cluster exists (ADR 0042). It reads Helm's
// block YAML with line patterns, because the CLI takes no YAML dependency.

/** The platform Gateway a route must attach to be held to its listeners. */
export interface GatewayRef {
  namespace: string;
  name: string;
}

/** Whether a Gateway listener hostname serves a route host (Gateway API rules). */
export function hostMatchesListener(host: string, listener: string): boolean {
  const h = host.toLowerCase();
  const l = listener.toLowerCase();
  return l.startsWith("*.") ? h.endsWith(l.slice(1)) : h === l;
}

const unquote = (text: string) => text.trim().replace(/^["']|["']$/g, "");
const indent = (line: string) => line.length - line.trimStart().length;

function documents(rendered: string): string[] {
  return rendered.split(/^---\s*$/m).filter((doc) => doc.trim() !== "");
}

function field(doc: string, pattern: RegExp): string | undefined {
  return pattern.exec(doc)?.[1];
}

const metadataPatterns = {
  name: [/^ {2}name:\s*(\S+)/m, /^metadata:\s*\{[^}]*\bname:\s*([^,}\s]+)/m],
  namespace: [
    /^ {2}namespace:\s*(\S+)/m,
    /^metadata:\s*\{[^}]*\bnamespace:\s*([^,}\s]+)/m,
  ],
} as const;

/** A `metadata` member, written as block YAML or as a flow mapping. */
function metadata(doc: string, key: "name" | "namespace"): string | undefined {
  const [block, flow] = metadataPatterns[key];
  return field(doc, block) ?? field(doc, flow);
}

/** The lines nested under the first `key:` line of a document, key line excluded. */
function nested(doc: string, key: string): string[] {
  const lines = doc.split("\n");
  const start = lines.findIndex((line) =>
    line.trimStart().startsWith(`${key}:`),
  );
  if (start === -1) {
    return [];
  }
  const base = indent(lines[start]!);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && indent(line) <= base) {
      break;
    }
    body.push(line);
  }
  return body;
}

function listenerHostnames(gateway: string): string[] {
  return nested(gateway, "listeners").flatMap((line) => {
    const hostname = /^\s*(?:- )?hostname:\s*(\S.*)$/.exec(line)?.[1];
    return hostname === undefined ? [] : [unquote(hostname)];
  });
}

function routeHosts(route: string): string[] {
  const inline = /^ {2}hostnames:\s*\[(.*)\]\s*$/m.exec(route)?.[1];
  if (inline !== undefined) {
    return inline
      .split(",")
      .map(unquote)
      .filter((host) => host !== "");
  }
  return nested(route, "hostnames").flatMap((line) => {
    const item = /^\s*- (\S.*)$/.exec(line)?.[1];
    return item === undefined ? [] : [unquote(item)];
  });
}

function attaches(route: string, gateway: GatewayRef): boolean {
  const items = nested(route, "parentRefs")
    .join("\n")
    .split(/^\s*- /m)
    .slice(1);
  return items.some((item) => {
    const name = /\bname:\s*["']?([^"',}\s]+)/.exec(item)?.[1];
    const namespace = /\bnamespace:\s*["']?([^"',}\s]+)/.exec(item)?.[1];
    return (
      name === gateway.name &&
      (namespace === undefined || namespace === gateway.namespace)
    );
  });
}

/**
 * Errors for each rendered HTTPRoute that attaches to the platform Gateway and
 * names a host none of the Gateway's listener hostnames serves. Routes that
 * attach to another Gateway are not held to this one's listeners. A rendering
 * with no such Gateway is itself an error, so a missing Gateway cannot pass as
 * zero findings.
 */
export function routeHostErrors(
  rendered: string,
  gateway: GatewayRef,
): string[] {
  const docs = documents(rendered);
  const gateways = docs.filter(
    (doc) =>
      field(doc, /^kind:\s*(\S+)/m) === "Gateway" &&
      metadata(doc, "name") === gateway.name,
  );
  if (gateways.length === 0) {
    return [
      `no Gateway ${gateway.namespace}/${gateway.name} in the rendered output; render the platform config chart beside the routes`,
    ];
  }
  const listeners = gateways.flatMap(listenerHostnames);
  return docs
    .filter((doc) => field(doc, /^kind:\s*(\S+)/m) === "HTTPRoute")
    .filter((route) => attaches(route, gateway))
    .flatMap((route) => {
      const name = metadata(route, "name") ?? "(unnamed)";
      const namespace = metadata(route, "namespace");
      const label = namespace === undefined ? name : `${namespace}/${name}`;
      return routeHosts(route)
        .filter((host) => !listeners.some((l) => hostMatchesListener(host, l)))
        .map(
          (host) =>
            `HTTPRoute ${label} host ${host} matches no listener hostname of Gateway ${gateway.namespace}/${gateway.name} (listeners: ${listeners.join(", ")}); add a listener for the host or derive the host from platform.domain`,
        );
    });
}
