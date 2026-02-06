#!/bin/bash
# BMAD Cleanup Script
cd "$(dirname "$0")"

echo "🧹 Cleaning BMAD..."

rm -rf .bmad
rm -rf .claude/commands/bmad
rm -f .claude/hooks/bmad-*.sh
rm -rf .agentvibes/bmad
rm -f .claude/commands/agent-vibes/bmad.md
find . -name "*bmad*.cache" -delete 2>/dev/null
find . -name "*bmad*.tmp" -delete 2>/dev/null

echo "✅ BMAD cleanup complete!"
echo "Remaining BMAD files:"
find . -iname "*bmad*" 2>/dev/null | grep -v node_modules | grep -v cleanup-bmad || echo "None found"
