#!/bin/bash
# AgentDog - Codex CLI Pipe Adapter
# Wraps `codex exec --json`, reads JSONL line-by-line, POSTs each event
# while passing through stdout for normal consumption.
#
# Usage: ./codex-pipe.sh "your prompt here"
# Requires: codex CLI, jq, curl

AGENT_DOG_URL="${AGENT_DOG_URL:-http://localhost:3333}"
SESSION_ID="${SESSION_ID:-codex-$(date +%s)-$$}"

if [ -z "$1" ]; then
  echo "Usage: $0 <prompt>" >&2
  exit 1
fi

codex exec --json "$@" | while IFS= read -r line; do
  # Pass through to stdout
  echo "$line"

  # POST to AgentDog in background
  curl -s -X POST "$AGENT_DOG_URL/api/ingest" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg s "$SESSION_ID" --argjson e "$line" \
      '{source:"codex",sessionId:$s,event:$e}')" &
done

wait
