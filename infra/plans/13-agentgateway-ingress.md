---
status: active
summary: Replace Istio ingress with agentgateway on k3d, keep ztunnel for identity and mTLS, re-prove the identity chain, and measure the resource outcome.
last-verified: 2026-11-11
---

# agentgateway Ingress Plan

## Purpose

agentgateway replaces Istio as Kore's Gateway API ingress
([ADR 0081](../../docs/decisions/0081-agentgateway-replaces-istio-ingress.md)),
adding first-class routes for agent and LLM traffic. Istio ambient ztunnel
stays for workload identity and mTLS. This plan starts after plan 9, because
the outcome is measured on k3d.

## Step 1: Decide and Pin

### Work

- [x] Record the decision in ADR 0081.
- [ ] Pin the agentgateway chart and images, mirror them, and add them to the
      platform image inventory, with compatibility evidence.
- [ ] Record the current ingress resource use on k3d as the comparison point.

### Exit Criteria

- The pins validate and the images are signed by digest.

## Step 2: Replace the Gateway

### Work

- [ ] Install agentgateway as the GatewayClass for ingress, behind a feature
      flag, dark launched in `local`.
- [ ] Move the platform Gateway and routes to it, and remove Istio's ingress
      gateway once the flag is on.
- [ ] Keep ztunnel, mesh policy and tenant isolation unchanged.

### Exit Criteria

- The gateway integration suite passes with agentgateway serving ingress.

## Step 3: Re-Prove the Identity Chain

### Work

- [ ] Prove that peer identity still reaches OPA (ADR 0066) and that the
      layered authorization of ADR 0007 still holds.
- [ ] Re-run the identity, authorizer and reference app suites.

### Exit Criteria

- The identity and admission suites pass live on k3d.

## Step 4: Outcome

### Work

- [ ] Measure ingress CPU and memory on k3d under the same routes and record it
      against the comparison point as the idea's outcome.

### Exit Criteria

- The outcome is recorded as confirmed, refuted or inconclusive.

## Results

Not started.
