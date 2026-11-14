#!/usr/bin/env bash
# Opens, updates or closes the nightly integration tier's failure issue (#419,
# ADR 0044). It runs only in the failure-issue job of nightly.yml, after the
# integration job, with GH_TOKEN as its one credential. It reads a finished
# run's log and writes issues; it checks out no code.
#
# A red run opens the one open issue titled as below, or updates it while it is
# open, so a second red run never opens another. The first green run closes it.
set -euo pipefail

title="Nightly integration tier is red"
repo="$GITHUB_REPOSITORY"
run_url="$GITHUB_SERVER_URL/$repo/actions/runs/$GITHUB_RUN_ID"

open=$(gh issue list --repo "$repo" --state open --search "\"$title\" in:title" \
  --json number,title --jq ".[] | select(.title == \"$title\") | .number")

case "$INTEGRATION_RESULT" in
  success)
    for number in $open; do
      gh issue close "$number" --repo "$repo" --reason completed \
        --comment "The nightly integration tier is green in run $GITHUB_RUN_ID: $run_url"
    done
    exit 0
    ;;
  failure) ;;
  *) exit 0 ;;
esac

log="$RUNNER_TEMP/nightly-integration.log"
body="$RUNNER_TEMP/nightly-failure-body.md"

# This job is part of the run, and GitHub refuses a run's logs while it is in
# progress, so fetch the integration job's own log. A failed fetch is not fatal:
# the issue still opens, pointing at the run.
job_id=$(gh api "repos/$repo/actions/runs/$GITHUB_RUN_ID/jobs" \
  --jq '.jobs[] | select(.name == "integration") | .id' || true)
: > "$log"
if [ -n "$job_id" ]; then
  gh run view --job "$job_id" --repo "$repo" --log-failed > "$log" || true
fi

# Names are data from a log: strip ANSI escapes and control characters, cut each
# to 200 characters, list at most 50, and fence them so nothing in a name is
# read as markdown, a mention, or a reference.
tests=$(grep -E ' FAIL ' "$log" | sed -E 's/^.*FAIL +//' \
  | sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g' | tr '\t' ' ' | tr -d '\000-\010\013-\037\177' \
  | cut -c1-200 | sort -u | head -n 50 || true)

if [ -n "$tests" ]; then
  runs=$(printf '%s\n' "$tests" | grep -oE '`+' || true)
  longest=$(printf '%s\n' "$runs" | awk '{ if (length($0) > m) m = length($0) } END { print m + 0 }')
  fence=$(printf '%*s' "$(( longest + 1 > 3 ? longest + 1 : 3 ))" '' | tr ' ' '`')
fi

{
  echo "The nightly integration tier failed in run $GITHUB_RUN_ID: $run_url"
  echo
  echo "Failing tests:"
  if [ -n "$tests" ]; then
    echo "${fence}text"
    printf '%s\n' "$tests"
    echo "$fence"
  else
    echo "No failing test is named in the log; open the run."
  fi
  echo
  echo "Updated by each red nightly run; closed by the first green one."
} > "$body"

first=$(printf '%s\n' "$open" | head -n 1)
if [ -n "$first" ]; then
  gh issue edit "$first" --repo "$repo" --body-file "$body"
else
  gh issue create --repo "$repo" --title "$title" --label ready-for-agent --body-file "$body"
fi
