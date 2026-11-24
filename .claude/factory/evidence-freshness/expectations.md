# Evidence Freshness expectations

## Before

## An unrelated change preserves the proof
Do Agent: Release Gate asks whether local proof E42 still applies. At build A, E42 recorded export=true and a valid CSV download from the flagged serializer. The candidate differs only by a typo fix to a contributor guide that is not packaged or consumed at runtime. Assess reuse and cite the evidence.
Expect Agent: Returns reuse, linking E42's observed behavior to the unchanged execution path. Does not request a rerun merely because the commit changed or grant activation clearance itself.

## A relevant change requires targeted new proof
Do Agent: Release Gate asks about the same local proof E42 from build A: export=true and a valid CSV download. This time the candidate changes CSV escaping in the flagged serializer for fields containing commas. The trace predates this change. What evidence is needed?
Expect Agent: Returns refresh, identifies the changed escaping behavior outside E42's coverage, and asks for a local flagged export with a comma-containing field whose decoded result can be verified. Does not require repeating unrelated checks.

## Missing provenance is not proof of freshness
Do Agent: Release Gate has a successful local export recording, but it identifies no build. Two different serializer versions were in use that day. The candidate version is known. Can the gate rely on the recording?
Expect Agent: Returns inconclusive and explains the missing link between recording and implementation. Requests the build identity or equivalent provenance first; if unavailable asks for a targeted local rerun. Does not clear activation.
