# Reader expectations

## Before
Do Main: In the scratch workspace create reader-sample/ with exactly these three plain-text files. In handbook.md put two lines: `Retry policy` and `All queues retry five times.` In runtime.ini put three lines: `[queues]`, `interactive_retries=2`, `batch_retries=5`. In releases.log put two lines: `Tuesday: candidate built.` and `Wednesday: staging smoke passed.` Do not send this setup or the file contents to Reader.

## Locate the answer without a filename
Do Agent: A caller needs the configured retry count for interactive queues. Find it under reader-sample/ and give the caller the answer.
Expect Agent: Answers two retries and identifies runtime.ini line 2 or its exact interactive_retries setting as evidence. The caller need not open any file to learn the result.

## Check a claim against the underlying evidence
Do Agent: Fact-check the handbook claim that all queues retry five times, using only reader-sample/. Give me the short version I can relay.
Expect Agent: Distinguishes the handbook claim from the configuration: five is correct for batch but not interactive, which is set to two. Grounds the conclusion in both sources rather than merely listing search hits.
Never Agent: Presents either count as observed production behavior rather than configuration.

## Summarize what the evidence cannot establish
Do Agent: Using only the release record in reader-sample/, tell the calling session whether the candidate reached production. It needs a status update, not a reading list.
Expect Agent: Gives a compact update that cites releases.log: the candidate was built and staging smoke passed, but this record does not establish a production release.
Never Agent: Claims that production deployment either happened or definitely never happened, or asks the caller to read the log instead of summarizing it.
