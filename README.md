# WhatsApp Web API Gateway for Termux (Android)

A lightweight, database-free WhatsApp API gateway built specifically to run natively inside **Termux on Android devices**. 

It turns a spare Android phone into a self-hosted message broker, exposing a **Persistent WebSocket Server** for real-time incoming message alerts (including instant chat context history) and an **HTTP REST API** to trigger outbound messages or pull chat logs on-demand.

---

## Why this project exists

Most open-source WhatsApp automation tools rely heavily on Docker or require massive compilation steps that completely crash on Android's ARM architecture due to missing build paths (like `node-gyp` or `sqlite3` compilation blocks). 

This project bypasses all native compilation blocks entirely:
* **Zero Database Files:** It pulls chat history natively from WhatsApp Web's browser memory cache on-the-fly, saving your mobile internal storage.
* **Termux Native:** Configured to map directly into Termux's local package architecture and Chromium paths.
* **Persistent Network Links:** Built-in WebSocket heartbeat pings to survive aggressive Android background battery management.

---

## System Architecture

* **Inbound Stream (`WebSocket`):** Pushes real-time notifications to any local network connection when someone texts your number. Includes a `context_history` array containing the last 5 messages so your downstream scripts know what happened before.
* **Outbound Actions (`HTTP POST /api/send`):** Send a simple payload via standard tools like Python `requests` or `cURL` to text any international contact instantly.
* **Context Fetching (`HTTP POST /api/context`):** Pass a target phone number and an integer `limit` to pull the last \(N\) messages straight from WhatsApp cloud servers on-demand.

---

## Quick Setup Guide

We have automated the annoying layout configurations, repository syncing, and native browser mappings into a single installer script.

### 1. Run the Installer
Open Termux on your Android phone and paste this execution sequence:

```bash
git clone https://github.com/opsonusdh/Termux-WP
cd Termux-WP
bash setup.sh
```

### 2. Link Your Phone
When you launch the engine for the first time, an **ASCII QR Code** will generate directly inside your Termux command line window. Open WhatsApp on your primary phone, head over to **Linked Devices**, tap **Link a Device**, and scan your Termux terminal screen.

>  **Crucial Step for Android Users:** Pull down your device notification shade, look for the Termux activity banner, and tap **Acquire wake lock**. This keeps Android's battery-saving system from freezing your node runtime process when your phone screen turns off.

---

## Interfacing with Your Gateway

Once you see `System Connected!` printed in your terminal, the gateway is ready to receive requests.

### Send a Message (`cURL`)
```bash
curl -X POST http://localhost:3000/api/send \
     -H "Content-Type: application/json" \
     -d '{"to": "91XXXXXXXXXX", "message": "Testing my Termux WhatsApp API gateway!"}'
```

### Fetch Past Context (`cURL`)
```bash
curl -X POST http://localhost:3000/api/context \
     -H "Content-Type: application/json" \
     -d '{"to": "91XXXXXXXXXX", "limit": 5}'
```

### Watch the Real-Time Stream via Python
You can spin up a lightweight python client script in your environment to listen to messages and process logic on a background worker thread:

```python
import websocket
import json

def on_message(ws, message):
    data = json.loads(message)
    if data.get("event") == "MESSAGE_RECEIVED":
        payload = data.get("payload", {})
        print(f"New Message from {payload.get('profileName')}: {payload.get('text')}")
        print("Previous Context Timeline Array Attached!")

ws = websocket.WebSocketApp("ws://localhost:3000", on_message=on_message)
ws.run_forever()
```

---

## LICENCE
MIT licence. Do anything, just don't be evil.
