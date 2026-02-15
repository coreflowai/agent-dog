#!/bin/bash
# AgentFlow - Open Code Pipe Adapter
# Wraps `opencode run --format json`, reads JSONL line-by-line, POSTs each event
# while passing through stdout for normal consumption.
#
# Usage: ./opencode-pipe.sh "your prompt here"
# Requires: opencode CLI, jq, curl

AGENT_FLOW_URL="${AGENT_FLOW_URL:-http://localhost:3333}"
AGENT_FLOW_API_KEY="${AGENT_FLOW_API_KEY:-}"
SESSION_ID="${SESSION_ID:-opencode-$(date +%s)-$$}"

if [ -z "$1" ]; then
  echo "Usage: $0 <prompt>" >&2
  exit 1
fi

opencode run --format json "$@" | while IFS= read -r line; do
  # Pass through to stdout
  echo "$line"

  # POST to AgentFlow in background
  curl -s -X POST "$AGENT_FLOW_URL/api/ingest" \
    -H "Content-Type: application/json" \
    ${AGENT_FLOW_API_KEY:+-H "x-api-key: $AGENT_FLOW_API_KEY"} \
    -d "$(jq -n --arg s "$SESSION_ID" --argjson e "$line" \
      '{source:"opencode",sessionId:$s,event:$e}')" &
done

wait
