#!/bin/bash
# Builds the frontend and syncs it to the Portfolio repo at ../Portfolio/versed/
# Run from the Versed repo root after setting up client/.env.production

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTFOLIO_DIR="$SCRIPT_DIR/../Portfolio"
DEST="$PORTFOLIO_DIR/versed"

echo "Building client..."
cd "$SCRIPT_DIR"
npm run build -w client -- --base=/versed/

echo "Syncing to Portfolio..."
rm -rf "$DEST"
cp -r "$SCRIPT_DIR/client/dist" "$DEST"

echo "Committing Portfolio..."
cd "$PORTFOLIO_DIR"
git add versed/
git commit -m "chore: sync Versed from Versed"
git push

echo "Done. joavn.dev/versed updated."
