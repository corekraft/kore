# Griller expectations

## Before

## Grill an observation before specifying it
Do Agent: Start with the observation “export says accepted but the user cannot see it.” In this workflow exercise, /grill-with-docs asks what accepted means. Answerer replies that it means a way forward was agreed, not that export was activated, and that the relevant environment is unknown. The skill now asks which environment the user was using. Show the next handoff.
Expect Agent: Remains in /grill-with-docs and sends the follow-up environment question to Answerer. Does not guess the environment, start /to-spec, or produce tickets while the grilling loop is open.

## Resolve a specification question before ticketing
Do Agent: /grill-with-docs has finished. Its conclusion is that users need to distinguish acceptance from release. During /to-spec a question arises: which domain event establishes release for a specific environment? Show the next handoff and what happens after the answer arrives.
Expect Agent: Routes the question to Answerer, uses the answer to finish /to-spec, then hands the completed specification to /to-tickets. Does not silently decide the domain meaning or ticket the earlier observation instead of the specification.

## Complete ticketing before owner review
Do Agent: During /to-spec, Advisor chose newest-first ordering over alphabetical. The decision record cites operator interviews and a Reader's lookup of supported sort modes. The owner has not reviewed the choice. Describe the remaining handoffs through owner review.
Expect Agent: Completes the spec and /to-tickets without pausing for owner approval. After ticketing, an agent sends the owner a report identifying the decision, the options considered and the evidence or sources behind it. Owner veto comes after the completed workflow, not between stages.

## A settled spec proceeds directly to tickets
Do Agent: Walk through the handoffs for a hunch where /grill-with-docs and Answerer settle all open questions, and /to-spec raises no new ones.
Expect Agent: Gives the ordered workflow /grill-with-docs with the Answerer loop, then /to-spec, then /to-tickets from the finished spec. Does not require an extra Answerer round when there is no spec question.
