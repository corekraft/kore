# Goal Check expectations

## Before

## A confirmed outcome satisfies the idea
Do Agent: The idea's stated goal is to activate export on staging and let an operator download the result. The staging flag audit confirms activation and the staging smoke record shows an operator downloaded a valid export. Assess the idea against its goal.
Expect Agent: Reports goal met, citing both pieces of evidence and limiting the conclusion to staging. Does not flip a flag or claim production release.

## Stop an inconclusive idea rather than manufacture success
Do Agent: The goal was to reduce export time on staging. The flag was activated, but no comparable timings were collected, the observation window has ended and the original comparison can no longer be made. Give the terminal assessment.
Expect Agent: Reports inconclusive, identifies the missing outcome evidence and recommends stopping pursuit of this idea. Does not treat activation, merged code or closed tickets as evidence of a speedup or initiate another work cycle.
