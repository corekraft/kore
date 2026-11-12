---
status: accepted
summary: An idea is a markdown record in docs/ideas that owns its content and outcome, mirrored one way to a GitHub issue that owns workflow state.
date: 2026-11-11
last-verified: 2026-11-11
---

# ADR 0079: Ideas and outcomes are markdown records mirrored to issues

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 1](../../infra/plans/11-agent-delivery-loop.md#step-1-idea-and-outcome-records)

## Context

The delivery loop runs from idea to outcome. GitHub issues give a queue that
agents and people can label, assign and close. But issue content does not
become part of the repository's knowledge, and an outcome recorded only in an
issue comment is not durable alongside the code it judged. One owner per
resource rules out editing the same content in both places.

## Decision

An idea is a markdown file at `docs/ideas/NNNN-slug.md`, numbered like ADRs,
listed in `docs/index.md`, and checked by kb-check. It owns the content: the
hypothesis, the expected outcome, how the outcome is measured, the likely
safety pattern, and the outcome once observed.

The matching GitHub issue owns workflow state: approval, assignment, labels,
open or closed. A tool renders the issue body from the markdown in one
direction and posts the outcome as a comment with an
`outcome:confirmed`, `outcome:refuted` or `outcome:inconclusive` label. The
file never stores workflow state, and the issue body is never edited by hand.

A person approves an idea by labelling its issue `ready-for-agent`. An idea
closes only when its outcome is recorded. A refuted or inconclusive outcome
opens a new idea, which waits for the same approval.

## Consequences

The knowledge base grows a durable record of what was tried and what happened.
The sync tool is the only writer of issue bodies. Losing GitHub loses workflow
state but no content.
