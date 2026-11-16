#!/usr/bin/env bash
# Creates or updates branch rulesets on a repo from JSON files (default: .github/rulesets/*.json).
#
# Usage: apply_rulesets.sh [-r owner/repo] [ruleset.json ...]
#   -r  Target repo (default: the current directory's GitHub repo).
# The main and release tags rulesets name the Octo STS App (801323) as their bypass actor, so install
# it first (see docs/release-setup.md).
set -euo pipefail

repo=""
while getopts "r:h" opt; do
  case "$opt" in
    r) repo="$OPTARG" ;;
    *) sed -n '2,7p' "$0"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))
repo="${repo:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
files=("$@")
[[ ${#files[@]} -gt 0 ]] || files=(.github/rulesets/*.json)

for file in "${files[@]}"; do
  name="$(jq -r .name "$file")"
  body="$(cat "$file")"
  id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")"
  if [[ -n "$id" ]]; then
    gh api -X PUT "repos/$repo/rulesets/$id" --input - <<<"$body" >/dev/null
    echo "Updated ruleset '$name' on $repo"
  else
    gh api -X POST "repos/$repo/rulesets" --input - <<<"$body" >/dev/null
    echo "Created ruleset '$name' on $repo"
  fi
done
