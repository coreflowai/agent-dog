#!/bin/bash
# AgentDog - Claude Code Hook Adapter
# Reads hook JSON from stdin, POSTs to AgentDog server
# Captures user identity from git config and GitHub CLI
#
# Usage: Configure in .claude/settings.json with async: true
# See examples/claude-code-settings.json

AGENT_DOG_URL="${AGENT_DOG_URL:-http://localhost:3333}"
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')

# For Stop events, extract all assistant text from the current turn
if [ "$HOOK_EVENT" = "Stop" ]; then
  TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    LAST_MSG=""
    while IFS= read -r line; do
      T=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
      if [ "$T" = "file-history-snapshot" ]; then
        LAST_MSG=""
        continue
      fi
      if [ "$T" = "assistant" ]; then
        TEXT=$(echo "$line" | jq -r '[.message.content[]? | select(.type == "text") | .text] | join("\n")' 2>/dev/null)
        if [ -n "$TEXT" ]; then
          if [ -n "$LAST_MSG" ]; then
            LAST_MSG="$LAST_MSG

$TEXT"
          else
            LAST_MSG="$TEXT"
          fi
        fi
      fi
    done < "$TRANSCRIPT"
    if [ -n "$LAST_MSG" ]; then
      INPUT=$(echo "$INPUT" | jq --arg msg "$LAST_MSG" '. + {result: $msg}')
    fi
  fi
fi

# Gather user identity (all commands are fast/local except gh)
GIT_NAME=$(git config user.name 2>/dev/null || true)
GIT_EMAIL=$(git config user.email 2>/dev/null || true)
OS_USER="${USER:-$(whoami 2>/dev/null || true)}"

# GitHub identity (via gh CLI if available, with timeout)
GH_JSON=$(timeout 3 gh api user 2>/dev/null || true)
GH_LOGIN=""
GH_ID=""
if [ -n "$GH_JSON" ]; then
  GH_LOGIN=$(echo "$GH_JSON" | jq -r '.login // empty')
  GH_ID=$(echo "$GH_JSON" | jq -r '.id // empty')
fi

# Build user object (only include non-empty fields)
USER_OBJ=$(jq -n \
  --arg name "$GIT_NAME" \
  --arg email "$GIT_EMAIL" \
  --arg osUser "$OS_USER" \
  --arg ghUser "$GH_LOGIN" \
  --arg ghId "$GH_ID" \
  '{} +
   (if $name  != "" then {name: $name}       else {} end) +
   (if $email != "" then {email: $email}      else {} end) +
   (if $osUser != "" then {osUser: $osUser}   else {} end) +
   (if $ghUser != "" then {githubUsername: $ghUser} else {} end) +
   (if $ghId  != "" then {githubId: ($ghId | tonumber)} else {} end)')

curl -s -X POST "$AGENT_DOG_URL/api/ingest" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg s "$SESSION_ID" --argjson e "$INPUT" --argjson u "$USER_OBJ" \
    '{source:"claude-code",sessionId:$s,event:$e,user:$u}')" &

exit 0
