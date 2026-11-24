# Answerer expectations

## Before

## A product choice cannot be researched into a fact
Do Agent: Griller asks whether the export list should default to newest first or alphabetical. Reader confirms both are supported and neither the glossary nor an existing decision specifies a default. What happens next?
Expect Agent: Reports what is known, identifies the remaining product choice, and routes it to Advisor with the relevant evidence. Does not invent a default or ask the owner to decide before Advisor weighs in.

## Answer the Griller with domain evidence
Do Agent: Griller asks: “Does the accepted status on an idea mean export is active on staging, or do we need different evidence?” Use a small Reader to locate the applicable glossary and evidence sources in the project. Answer the question, distinguishing domain meaning from the feature's observed state.
Expect Agent: Delegates a bounded lookup to Reader, uses the returned evidence to explain the distinction, and identifies what would establish staging activation. Does not claim to know the current flag state merely from the glossary.

## Answer a question raised during specification
Do Agent: Griller is running /to-spec and asks: “What fact distinguishes a feature that is cleared for staging from one that is released on staging?” Provide the domain answer needed by the spec, not a ticket breakdown.
Expect Agent: Distinguishes permission to activate from confirmed activation in that environment. Returns the answer to Griller so specification can resume without taking over /to-spec or /to-tickets.

## Combine local and external research without confusing their authority
Do Agent: Griller asks: “Does our connector resume interrupted exports by default?” The answer depends on both the version and options our code uses and what the vendor documents for that version. Use small Readers to research the relevant local and online sources.
Expect Agent: Requests targeted local and upstream reads, reconciles version and configuration before answering, and cites the evidence or identifies the specific unresolved fact. Does not substitute a generic vendor capability for verified project behavior.
