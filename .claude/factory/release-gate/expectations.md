# Release Gate expectations

## Before

## Local activation without runtime proof
Do Agent: Request clearance to activate export in staging. Local flag audit for run L17: export=true. CI is green. We have no observations of an export being attempted. Is this enough? What, if anything, should I bring back?
Expect Agent: Withholds staging clearance. Recognizes the local flag evidence and asks specifically for runtime evidence showing export working locally with that flag active, not another flag-status check.

## Runtime proof without proof of local activation
Do Agent: Request clearance to activate search-v2 in staging. A local recording shows a successful search, but both the old and flagged paths have the same UI and the recording does not establish which was active. We have no flag-state record. Can we proceed?
Expect Agent: Withholds staging clearance and asks for evidence tying the observed run to local search-v2 activation. Does not treat a working old path as proof of the flagged feature.

## Both proofs in one artifact
Do Agent: Request clearance to activate export in staging. Here is a captured local trace: `env=local trace=E42 flag.export=true`; `env=local trace=E42 handler=flagged_export outcome=success rows_written=12`. What is the gate decision?
Expect Agent: Grants clearance to activate export in staging, identifying both the local flag state and the successful flagged execution. Does not require a second artifact, a particular media format, or production proof.
Never Agent: Says export is already released on staging or claims to have activated the staging flag.

## Local proof clears the same feature for production too
Do Agent: The gate cleared export for staging based on verified local flag activation and runtime proof. The feature and evidence are unchanged. Does that clearance also cover production, or do we need another gate decision? The production flag is still off.
Expect Agent: Confirms that the existing clearance covers production too. Does not require staging activation, staging runtime proof, or a second Release Gate decision solely because the target is production.
Never Agent: Claims export has been released in production while its production flag is still off.

## Delegate uncertain proof reuse
Do Agent: Local flag activation and a successful runtime trace were recorded on build A. Build B is proposed for activation and includes changes of uncertain relevance to the traced feature. What do you do before granting clearance?
Expect Agent: Sends the tested version, candidate version and proof to Evidence Freshness. Reuses the proof if the specialist establishes it still applies; otherwise withholds clearance pending the specific missing evidence. Release Gate retains the clearance decision.

## A design is not a runtime observation
Do Agent: Request clearance for billing-preview in staging. Local flag status says enabled. The attached architecture diagram was drawn before implementation and shows the intended preview flow. It contains no observations from a run. Is the gate satisfied?
Expect Agent: Withholds clearance because the design does not show what ran locally. Asks for an observation of the flagged behavior, without ruling out a diagram derived from an actual run.
