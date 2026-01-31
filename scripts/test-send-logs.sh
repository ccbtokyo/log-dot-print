#!/bin/bash

# Test script to send sample logs to the server

SERVER_URL="${1:-http://localhost:3000}"

echo "Sending test logs to $SERVER_URL..."

# Single log
curl -s -X POST "$SERVER_URL/api/log" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "AI_Character_Alpha",
    "level": "thought",
    "message": "I notice a player approaching from the east. Should I engage or observe?",
    "metadata": {"player_distance": 15.5, "player_state": "walking"}
  }' | jq .

sleep 0.5

# Another single log
curl -s -X POST "$SERVER_URL/api/log" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "AI_Character_Alpha",
    "level": "action",
    "message": "Moving to observation point behind the pillar",
    "metadata": {"target_position": {"x": 100, "y": 200, "z": 0}}
  }' | jq .

sleep 0.5

# Batch logs
curl -s -X POST "$SERVER_URL/api/logs" \
  -H "Content-Type: application/json" \
  -d '[
    {"source": "AI_Character_Beta", "level": "emotion", "message": "Feeling curious about the new artifact"},
    {"source": "AI_Character_Gamma", "level": "debug", "message": "Pathfinding recalculated: 12 nodes"},
    {"source": "GameMaster", "level": "info", "message": "Round 3 starting in 10 seconds"}
  ]' | jq .

echo ""
echo "Test logs sent! Check the server output."
