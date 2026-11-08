#!/bin/zsh
# Equalize the column of spawned panes to the right of the main pane.
# Each new pane splits the one above it, so heights halve down the column.
# Split i (top to bottom) between pane i and i+1 must hold 1/(panes left).
# `resize --direction down` on a pane moves its bottom edge (grows the split
# above it); `--direction up` moves its top edge, so a split shrinks by
# resizing the pane below it up.
set -euo pipefail
layout=$(herdr pane layout)
panes=(${(f)"$(jq -r '.result.layout.panes | map(select(.rect.x > 0)) | sort_by(.rect.y) | .[].pane_id' <<<"$layout")"})
ratios=(${(f)"$(jq -r '.result.layout.splits | map(select(.direction == "down")) | sort_by(.rect.y) | .[].ratio' <<<"$layout")"})
n=${#panes}
for ((i = 1; i < n; i++)); do
  delta=$(( 1.0 / (n - i + 1) - ratios[i] ))
  if (( delta < 0 )); then
    dir=up target=${panes[i + 1]} delta=$(( -delta ))
  else
    dir=down target=${panes[i]}
  fi
  if (( delta > 0.0005 )); then
    herdr pane resize --pane "$target" --direction "$dir" --amount "$(printf '%.6f' "$delta")" >/dev/null
  fi
done
