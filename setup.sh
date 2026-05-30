#!/data/data/com.termux/files/usr/bin/bash

# Exit immediately if any command returns a non-zero exit status
set -e
echo "STARTING WHATSAPP TERMUX BOT ARCHITECTURE SETUP"

# 1. Update system repositories and core device tools
echo -e "\n[1/5] Synchronizing and updating Termux package layers..."
pkg update -y && pkg upgrade -y
pkg install git nodejs python -y

# 2. Bind repositories and grab the native browser components
echo -e "\n[2/5] Deploying native system repositories and Chromium binaries..."
pkg install x11-repo -y
pkg install tur-repo -y
pkg install chromium -y

# 3. Structuring deployment framework workspaces
echo -e "\n[3/5] Setting up active project folder workspaces..."
npm init -y

# 4. Inject package dependencies while bypassing native build blockers
echo -e "\n[4/5] Pulling framework elements & blocking native build crashes..."
# Set flags to prevent Puppeteer from downloading incompatible platform architectures
export PUPPETEER_SKIP_DOWNLOAD=true

echo "Installing WhatsApp Web core elements and terminal interface modules..."
npm install whatsapp-web.js qrcode-terminal --no-audit --no-fund

echo "Installing HTTP Express runtime router infrastructure..."
npm install express body-parser --no-audit --no-fund

echo "Installing WebSocket stream communication clusters..."
npm install ws --no-audit --no-fund

# 5. Verifying internal script setup rules
echo -e "\n[5/5] Finalizing deployment validation structures..."
if [ ! -f "bot.js" ]; then
    echo "No 'bot.js' detected in current deployment loop."
fi

echo "Starting bot.js"
node bot.js
