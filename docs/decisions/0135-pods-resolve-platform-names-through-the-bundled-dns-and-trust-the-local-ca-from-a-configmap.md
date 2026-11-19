---
status: proposed
summary: The platform-dns chart owns the k3s coredns-custom ConfigMap whose rewrite sends the platform zone to the Gateway Service's DNS name, and kore applies a kore-local-ca ConfigMap that the portal's proxy and backend mount, both only while platform-dns is on.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0135: Pods resolve platform names through the bundled DNS and trust the local CA from a ConfigMap

Source: issue #1208, under #1194 (local names, shared Gateway).

Refines: [ADR 0132](0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md),
which decides that the bundled DNS rewrites the zone to the Gateway Service's
DNS name and that pods trust the local CA, but not who owns the ConfigMap or
how the CA reaches a pod. Follows [ADR 0058](0058-registry-transport-tls.md)'s
CA ConfigMap precedent.

## Context

A pod cannot resolve `keycloak.platform.<domain>`, so Backstage's sign-in proxy
cannot reach the issuer, and it would not trust the Gateway's certificate from
the local CA if it could. k3s imports an optional, unmanaged ConfigMap
`kube-system/coredns-custom` into its CoreDNS: `*.override` keys go inside the
main server block and `*.server` keys are servers of their own.

## Decision

- **One owner of `coredns-custom`.** The `platform-dns` chart renders it, only
  with the `platform-dns` flag on, and no other chart may. The component
  depends on `kore-platform-config` so the Gateway exists first. k3s does not
  ship the ConfigMap, so nothing else manages it.
- **A rewrite to a name, not an address.** The `platform.override` key rewrites
  the zone and every name under it to the Gateway Service's DNS name
  (`<service>.<namespace>.svc.cluster.local`) and rewrites the answer back, so
  the answer follows the Service and the pod sees the name it asked for.
- **The Service is found by the Gateway's label.** The chart looks the Service
  up by `gateway.networking.k8s.io/gateway-name`, because the class decides the
  Service's name (agentgateway names it after the Gateway, Istio adds a
  suffix). Helm cannot look up a cluster in `helm template`, so with no cluster
  the Service is taken to carry the Gateway's name. kore hands the chart the
  environment's `gateway.name` and `gateway.namespace`.
- **The CA is a ConfigMap kore applies.** `kore-local-ca` in the portal's
  namespace holds `ca.crt`, the local CA's public certificate read from the
  CA key pair Secret (`tls.crt` only, never the key), and `bundle.crt`, that
  certificate followed by the cluster CA from `kube-system/kube-root-ca.crt`.
  kore applies it by stdin, with the same content on every run, before the
  portal's release and only with `platform-dns` on; it fails closed, naming
  `kore trust install`, when the local CA is absent.
- **Where the portal reads trust.** Only the two public keys are projected,
  read-only, at `/etc/kore/local-ca`. The sign-in proxy adds `ca.crt` with
  `--provider-ca-file`. Node reads a single extra file, so the backend's
  `NODE_EXTRA_CA_CERTS` becomes `bundle.crt`, which keeps the API server
  trusted. With the flag off the chart is unchanged.

## Consequences

- Turning `platform-dns` on changes the portal's pod template, so the portal
  restarts once.
- The rewrite takes effect when CoreDNS reloads its configuration; the live
  proof in the shared proof ticket is a pod resolving and verifying a platform
  name over HTTPS. Until it is recorded the flag stays off.
- Other pods that must trust the local CA mount the same ConfigMap in their own
  namespace; this decision applies it to the portal only.
