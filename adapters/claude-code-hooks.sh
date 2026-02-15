#!/bin/bash
# AgentDog - Claude Code Hook Adapter
# Reads hook JSON from stdin, POSTs to AgentDog server
#
# Usage: Configure in .claude/settings.json with async: true
# See examples/claude-code-settings.json

AGENT_DOG_URL="${AGENT_DOG_URL:-http://localhost:3333}"
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

curl -s -X POST "$AGENT_DOG_URL/api/ingest" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg s "$SESSION_ID" --argjson e "$INPUT" \
    '{source:"claude-code",sessionId:$s,event:$e}')" &

exit 0
