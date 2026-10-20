#!/usr/bin/env bash
# Waits for Vercel to finish deploying a commit of TRIMBLE-DOCS and prints
# "deploy success", "deploy failure", "deploy error" or "timeout (<state>)".
# Run it in the background right after `git push`.
#
#   bash esperar-despliegue.sh [sha]      (default: HEAD of the current repo)
set -u
REPO="ingenierodeivisrodriguez-web/TRIMBLE-DOCS"
sha="${1:-$(git rev-parse HEAD)}"
st=""
for _ in $(seq 1 40); do
  id=$(gh api "repos/$REPO/deployments?sha=$sha" --jq '.[0].id' 2>/dev/null)
  if [ -n "$id" ]; then
    st=$(gh api "repos/$REPO/deployments/$id/statuses" --jq '.[0].state' 2>/dev/null)
    case "$st" in
      success | failure | error)
        echo "deploy $st"
        exit 0
        ;;
    esac
  fi
  sleep 15
done
echo "timeout ($st)"
