import json
import threading
import time
import requests
import websocket

# --- CONFIGURATION MATRIX ---
BASE_URL = "http://localhost:3000"
WS_URL = "ws://localhost:3000"


# --- HTTP API INTERACTION LAYER ---

def send_whatsapp_message(to_phone: str, message_text: str):
    """Sends an outbound WhatsApp message via HTTP POST request."""
    url = f"{BASE_URL}/api/send"
    payload = {"to": to_phone, "message": message_text}

    try:
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()  # Trigger exception for 4xx or 5xx status codes
        data = response.json()

        if data.get("success"):
            print(
                f"Message Sent Successfully! [ID: {data.get('messageId')}]"
            )
        else:
            print(f"Server Error: {data.get('error', 'Unknown Error')}")

    except requests.exceptions.HTTPError as http_err:
        print(f"HTTP protocol error while sending: {http_err}")
    except requests.exceptions.ConnectionError:
        print("Connection Error: Is your Termux server running on port 3000?")
    except Exception as e:
        print(f"Unexpected send breakdown: {e}")


def fetch_cloud_context(to_phone: str, limit: int = 5):
    """Fetches the last N messages for a specific number straight from WhatsApp cloud memory."""
    url = f"{BASE_URL}/api/context"
    payload = {"to": to_phone, "limit": limit}

    try:
        response = requests.post(url, json=payload, timeout=15)
        response.raise_for_status()
        data = response.json()

        if data.get("success"):
            print(f"\n--- Live Cloud Context for {data.get('phone')} ---")
            history = data.get("history", [])
            if not history:
                print("   No previous message history found.")
            for msg in history:
                print(
                    f"   [{msg['timestamp']}] {msg['direction']}: {msg['body']}"
                )
            print("-" * 45)
        else:
            print(
                f"Failed to extract history: {data.get('error', 'Unknown Error')}"
            )

    except requests.exceptions.Timeout:
        print("Request Timed Out. WhatsApp cloud server took too long to reply.")
    except requests.exceptions.ConnectionError:
        print("Connection Error: Verification node on port 3000 unreachable.")
    except Exception as e:
        print(f"Unexpected context extraction error: {e}")


# --- PERSISTENT WEBSOCKET LISTENER LAYER ---

def on_ws_message(ws, message):
    """Triggered dynamically whenever a real-time event drops onto the WebSocket pipeline."""
    try:
        # Convert raw string stream data into a structural Python dictionary
        data = json.loads(message)
        event_type = data.get("event")
        payload = data.get("payload", {})

        if event_type == "MESSAGE_RECEIVED":
            print(
                f"\n[WS ALERT] New Message from {payload.get('profileName')} ({payload.get('sender')})"
            )
            print(f"Text: \"{payload.get('text')}\"")

            # Print out the instant attached context history array
            context = payload.get("context_history", [])
            print(f"Chat Context (Last {len(context)} messages):")
            for h in context:
                print(f"   - {h['direction']}: {h['body']}")
            print("-" * 40)

        elif event_type == "SYSTEM_READY":
            print("WebSocket Stream Link: Termux API Engine reported ONLINE status.")

    except json.JSONDecodeError:
        # Catch unexpected structural parsing slips or heartbeat logs smoothly
        pass
    except Exception as e:
        print(f"Error handling payload event mapping: {e}")


def on_ws_error(ws, error):
    print(f"WebSocket Pipeline Disturbance: {error}")


def on_ws_close(ws, close_status_code, close_msg):
    print("WebSocket pipeline closed down. Attempting automated drop-recovery...")


def start_websocket_listener():
    """Manages the WebSocket life-cycle loops and forces active connection recovery."""
    while True:
        try:
            ws = websocket.WebSocketApp(
                WS_URL,
                on_message=on_ws_message,
                on_error=on_ws_error,
                on_close=on_ws_close,
            )
            # Run indefinitely; ping frames handle automatic broken-link detection
            ws.run_forever(ping_interval=30, ping_timeout=10)
        except Exception as e:
            print(f"WebSocket execution exception: {e}")

        # Sleep before attempting reconnection to prevent terminal log spamming
        print("Retrying connection pipeline matrix in 5 seconds...")
        time.sleep(5)


# --- MAIN INTERACTION RUNTIME ---

if __name__ == "__main__":
    print("Initializing client communication threads...")

    state = "home"

    # Start websocket listener
    ws_thread = threading.Thread(
        target=start_websocket_listener,
        daemon=True
    )
    ws_thread.start()

    time.sleep(2)

    while True:

        if state == "home":
            print(
                "\n=== WhatsApp Client ===\n"
                "[0] Close\n"
                "[1] Send Message\n"
                "[2] Get Recent Messages\n"
                "[3] Keep Listening For Messages\n"
            )

            inp = input("Your choice > ").strip()

            if inp == "0":
                print("Shutting down...")
                break

            elif inp == "1":
                state = "send"

            elif inp == "2":
                state = "fetch"

            elif inp == "3":
                state = "ws"

            else:
                print("Invalid choice.")

        elif state == "send":
            print("\n=== Send Message ===")

            number = input("Phone number (e.g., 916289289001) > ").strip()

            if not number:
                print("Number cannot be empty.")
                state = "home"
                continue

            message = input("Message > ").strip()

            if not message:
                print("Message cannot be empty.")
                state = "home"
                continue

            try:
                send_whatsapp_message(number, message)
                print("Message sent.")
            except Exception as e:
                print(f"Failed to send message: {e}")

            state = "home"

        elif state == "fetch":
            print("\n=== Fetch Chat Context ===")

            number = input("Phone number (e.g., 916289289001) > ").strip()

            if not number:
                state = "home"
                continue

            try:
                limit = input("Number of messages (e.g., 10) > ").strip()

                if limit:
                    limit = int(limit)
                else:
                    limit = 10

                history = fetch_cloud_context(number, limit=limit)

                print("\n--- Chat History ---")

                if history:
                    for msg in history:
                        direction = msg.get("direction", "UNKNOWN")
                        body = msg.get("body", "")
                        print(f"[{direction}] {body}")
                else:
                    print("No messages found.")

            except Exception as e:
                print(f"Failed to fetch history: {e}")

            state = "home"

        elif state == "ws":
            print(
                "\nListening for real-time messages."
                "\nPress ENTER to return to menu.\n"
            )

            try:
                input()
            except KeyboardInterrupt:
                pass

            state = "home"

    print("Client environment cleanly shut down.")