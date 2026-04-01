#!/bin/bash
echo "Installing ZClaw dependencies..."
pnpm install

echo "Building ZClaw..."
pnpm run build

echo ""
echo "============================================"
echo "  Installation Complete!"
echo "============================================"
echo ""
echo "To configure, run:"
echo "  pnpm start -- setup"
echo ""
echo "To use, run:"
echo "  pnpm start"
echo ""
