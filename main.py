import json
import base64
import mimetypes
import os
import threading
import time
import requests
import websocket

# --- CONFIGURATION MATRIX ---
BASE_URL = "http://localhost:3000"
WS_URL   = "ws://localhost:3000"


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def _post(endpoint, payload, timeout=10):
    r = requests.post(f"{BASE_URL}{endpoint}", json=payload, timeout=timeout)
    r.raise_for_status()
    return r.json()

def _get(endpoint, timeout=10):
    r = requests.get(f"{BASE_URL}{endpoint}", timeout=timeout)
    r.raise_for_status()
    return r.json()

def _jid(raw: str) -> str:
    """Accept a bare number or a full JID. Returns a usable JID string."""
    raw = raw.strip()
    if "@" in raw:
        return raw
    return raw.replace("+", "").replace(" ", "") + "@c.us"

def _hr(char="─", width=45):
    print(char * width)

def _ask(prompt, default=None):
    val = input(f"  {prompt} > ").strip()
    return val if val else default


# ─── 1. STATUS ───────────────────────────────────────────────────────────────

def cmd_status():
    """GET /api/status — check if bot is connected."""
    print("\n=== System Status ===")
    try:
        data = _get("/api/status", timeout=5)
        state = data.get("state", "UNKNOWN")
        print(f"  State : {state}")
        if data.get("qr"):
            print("  QR    : Scan required (run node bot to see the QR code)")
        print()
    except requests.exceptions.ConnectionError:
        print("  ✗ Connection refused — is bot.js running on port 3000?\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 2. SEND MESSAGE ─────────────────────────────────────────────────────────

def cmd_send():
    """POST /api/send — send a message, optionally as a quoted reply."""
    print("\n=== Send Message ===")
    number  = _ask("Phone / JID (e.g. 916289001001 or 91...@c.us)")
    if not number:
        print("  Cancelled.\n"); return
    message = _ask("Message text")
    if not message:
        print("  Cancelled.\n"); return
    quoted  = _ask("Quoted message ID (leave blank to skip)", default="")

    payload = {"to": _jid(number), "message": message}
    if quoted:
        payload["quotedMessageId"] = quoted

    try:
        data = _post("/api/send", payload)
        if data.get("success"):
            print(f"  ✓ Sent  [ID: {data.get('messageId')}]\n")
        else:
            print(f"  ✗ {data.get('error')}\n")
    except requests.exceptions.ConnectionError:
        print("  ✗ Connection refused — is bot.js running?\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 3. FETCH CHAT HISTORY ───────────────────────────────────────────────────

def cmd_fetch_history():
    """POST /api/context — pull last N messages for a chat from WhatsApp cloud."""
    print("\n=== Fetch Chat History ===")
    number = _ask("Phone / JID")
    if not number:
        print("  Cancelled.\n"); return
    limit = int(_ask("Number of messages", default="10") or 10)

    try:
        data = _post("/api/context", {"to": _jid(number), "limit": limit}, timeout=15)
        if data.get("success"):
            _hr()
            print(f"  Chat: {data.get('phone')}")
            _hr()
            for msg in data.get("history", []):
                mtype = msg.get("type", "chat")
                body  = msg.get("body") or f"[{mtype}]"
                ts    = msg.get("timestamp", "")[:16]
                print(f"  [{ts}] {msg['direction']}: {body}")
            _hr(); print()
        else:
            print(f"  ✗ {data.get('error')}\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 4. LIST CHATS ───────────────────────────────────────────────────────────

def cmd_list_chats():
    """GET /api/chats — list all chats and groups with JIDs and metadata."""
    print("\n=== List Chats ===")
    print("  Filter: [1] All  [2] DMs only  [3] Groups only")
    choice = _ask("Choice", default="1")
    fmap   = {"1": "all", "2": "dm", "3": "group"}
    ftype  = fmap.get(choice, "all")

    try:
        data   = _get("/api/chats", timeout=15)
        chats  = data.get("chats", [])
        if ftype != "all":
            chats = [c for c in chats if c.get("type") == ftype]

        dms    = [c for c in chats if c.get("type") == "dm"]
        groups = [c for c in chats if c.get("type") == "group"]

        def _print_chat(c):
            flags = ""
            if c.get("isPinned"): flags += " 📌"
            if c.get("isMuted"):  flags += " 🔇"
            if c.get("unread"):   flags += f" [{c['unread']} unread]"
            print(f"  {c['name']}{flags}")
            print(f"    JID  : {c['jid']}")
            if c.get("lastMessageAt"):
                print(f"    Last : {c['lastMessageAt'][:16]}")

        if dms:
            _hr()
            print(f"  DMs ({len(dms)})")
            _hr()
            for c in dms: _print_chat(c)

        if groups:
            _hr()
            print(f"  Groups ({len(groups)})")
            _hr()
            for c in groups: _print_chat(c)

        _hr()
        print(f"  Total: {len(chats)} chat(s)\n")

    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 5. CONTACT INFO ─────────────────────────────────────────────────────────

def cmd_contact_info():
    """GET /api/contact/:jid — fetch profile data for a contact."""
    print("\n=== Contact Info ===")
    jid = _ask("JID (e.g. 916289001001@c.us)")
    if not jid:
        print("  Cancelled.\n"); return

    try:
        data = _get(f"/api/contact/{_jid(jid)}", timeout=15)
        if data.get("success"):
            c = data.get("contact", {})
            _hr()
            print(f"  Name     : {c.get('name') or '(none)'}")
            print(f"  Number   : {c.get('number')}")
            print(f"  JID      : {c.get('jid')}")
            print(f"  Saved    : {'Yes' if c.get('isMyContact') else 'No'}")
            print(f"  Business : {'Yes' if c.get('isBusiness') else 'No'}")
            print(f"  Blocked  : {'Yes' if c.get('isBlocked') else 'No'}")
            if c.get("about"):
                print(f"  About    : {c['about']}")
            if c.get("profilePicUrl"):
                print(f"  Pic URL  : {c['profilePicUrl']}")
            _hr(); print()
        else:
            print(f"  ✗ {data.get('error')}\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 6. GROUP PARTICIPANTS ───────────────────────────────────────────────────

def cmd_group_participants():
    """GET /api/group/:jid/participants — list all members of a group."""
    print("\n=== Group Participants ===")
    jid = _ask("Group JID (ends in @g.us)")
    if not jid:
        print("  Cancelled.\n"); return

    try:
        data = _get(f"/api/group/{jid.strip()}/participants", timeout=15)
        if data.get("success"):
            participants = data.get("participants", [])
            _hr()
            print(f"  Group : {data.get('groupName', jid)}")
            print(f"  Count : {data.get('count', len(participants))}")
            _hr()
            admins  = [p for p in participants if p.get("isAdmin") or p.get("isSuperAdmin")]
            members = [p for p in participants if not p.get("isAdmin") and not p.get("isSuperAdmin")]
            if admins:
                print("  Admins:")
                for p in admins:
                    role = " [owner]" if p.get("isSuperAdmin") else ""
                    print(f"    +{p.get('number', '')}{role}")
                    print(f"      {p['jid']}")
            if members:
                print("  Members:")
                for p in members:
                    print(f"    +{p.get('number', '')}")
                    print(f"      {p['jid']}")
            _hr(); print()
        else:
            print(f"  ✗ {data.get('error')}\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 7. TYPING INDICATOR ─────────────────────────────────────────────────────

def cmd_typing():
    """POST /api/typing — show 'typing...' indicator in a chat."""
    print("\n=== Show Typing Indicator ===")
    jid      = _ask("Phone / JID")
    if not jid:
        print("  Cancelled.\n"); return
    duration = int(_ask("Duration in ms", default="5000") or 5000)

    try:
        data = _post("/api/typing", {"to": _jid(jid), "duration": duration})
        if data.get("success"):
            print(f"  ✓ Typing shown for {duration}ms\n")
        else:
            print(f"  ✗ {data.get('error')}\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 8. MARK AS READ ─────────────────────────────────────────────────────────

def cmd_mark_seen():
    """POST /api/seen — mark a chat as read (clears unread badge on phone)."""
    print("\n=== Mark Chat as Read ===")
    jid = _ask("Phone / JID")
    if not jid:
        print("  Cancelled.\n"); return

    try:
        data = _post("/api/seen", {"to": _jid(jid)})
        if data.get("success"):
            print("  ✓ Marked as read\n")
        else:
            print(f"  ✗ {data.get('error')}\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 9. REACT TO MESSAGE ─────────────────────────────────────────────────────

def cmd_react():
    """POST /api/react — react to a specific message with an emoji."""
    print("\n=== React to Message ===")
    msg_id = _ask("Message ID (from a received message)")
    if not msg_id:
        print("  Cancelled.\n"); return
    emoji  = _ask("Emoji (e.g. 👍 ❤️ 😂)", default="👍")

    try:
        data = _post("/api/react", {"messageId": msg_id.strip(), "emoji": emoji})
        if data.get("success"):
            print(f"  ✓ Reacted with {emoji}\n")
        else:
            print(f"  ✗ {data.get('error')}\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 10. DOWNLOAD MEDIA ──────────────────────────────────────────────────────

def cmd_download_media():
    """POST /api/media — download media from a message and save to /tmp."""
    print("\n=== Download Media ===")
    msg_id   = _ask("Message ID")
    if not msg_id:
        print("  Cancelled.\n"); return
    save_dir = _ask("Save directory", default="/tmp")

    try:
        print("  Downloading... (may take a moment for large files)")
        data = _post("/api/media", {"messageId": msg_id.strip()}, timeout=60)
        if data.get("success"):
            mimetype = data.get("mimetype", "application/octet-stream")
            filename = data.get("filename") or f"wa_media_{msg_id[:8]}"
            if "." not in filename:
                ext = mimetypes.guess_extension(mimetype) or ".bin"
                filename += ext
            out_path = os.path.join(save_dir or "/tmp", filename)
            with open(out_path, "wb") as f:
                f.write(base64.b64decode(data["data"]))
            size_kb = os.path.getsize(out_path) // 1024
            print(f"  ✓ Saved  : {out_path}")
            print(f"  Size     : {size_kb} KB")
            print(f"  Mimetype : {mimetype}\n")
        else:
            print(f"  ✗ {data.get('error')}\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 11. SEARCH CHAT ─────────────────────────────────────────────────────────

def cmd_search():
    """POST /api/search — search messages by keyword in a specific chat."""
    print("\n=== Search Chat Messages ===")
    jid   = _ask("Phone / JID to search in")
    if not jid:
        print("  Cancelled.\n"); return
    query = _ask("Search keyword")
    if not query:
        print("  Cancelled.\n"); return
    limit = int(_ask("Max results", default="20") or 20)

    try:
        data    = _post("/api/search", {"to": _jid(jid), "query": query, "limit": limit}, timeout=20)
        results = data.get("results", [])
        _hr()
        print(f"  Query   : '{query}'")
        print(f"  Results : {len(results)}")
        _hr()
        if results:
            for r in results:
                arrow = "→" if r.get("direction") == "OUTBOUND" else "←"
                ts    = r.get("timestamp", "")[:16]
                body  = r.get("body", "") or f"[{r.get('type', 'media')}]"
                print(f"  {arrow} [{ts}] {body}")
                print(f"       ID: {r.get('messageId')}")
        else:
            print("  No messages found.")
        _hr(); print()
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── 12. ARCHIVE CHAT ────────────────────────────────────────────────────────

def cmd_archive():
    """POST /api/archive — archive or unarchive a chat."""
    print("\n=== Archive / Unarchive Chat ===")
    jid    = _ask("Phone / JID")
    if not jid:
        print("  Cancelled.\n"); return
    action = _ask("Action [1] Archive  [2] Unarchive", default="1")
    do_archive = (action != "2")

    try:
        data = _post("/api/archive", {"to": _jid(jid), "archive": do_archive})
        if data.get("success"):
            word = "Archived" if do_archive else "Unarchived"
            print(f"  ✓ {word}\n")
        else:
            print(f"  ✗ {data.get('error')}\n")
    except Exception as e:
        print(f"  ✗ {e}\n")


# ─── WEBSOCKET LISTENER ──────────────────────────────────────────────────────

def _media_label(media: dict) -> str:
    """Turn a media info dict into a readable one-liner."""
    if not media or media.get("type") in (None, "text", "chat"):
        return ""
    mtype   = media.get("type", "media")
    caption = media.get("caption") or ""
    labels  = {
        "image"    : f"[Image{': ' + caption if caption else ''}]",
        "video"    : f"[GIF]" if media.get("isGif") else f"[Video{': ' + caption if caption else ''}]",
        "ptt"      : f"[Voice note{' (' + str(media.get('duration')) + 's)' if media.get('duration') else ''}]",
        "audio"    : "[Audio]",
        "sticker"  : "[Animated sticker]" if media.get("isAnimated") else "[Sticker]",
        "document" : f"[Document: {media.get('filename', '')}]",
        "location" : f"[Location: {media.get('latitude')}, {media.get('longitude')}]",
        "vcard"    : "[Contact card]",
        "revoked"  : "[Deleted message]",
    }
    return labels.get(mtype, f"[{mtype}]")


def on_ws_message(ws, message):
    """Handle real-time events from the WebSocket pipeline."""
    try:
        data       = json.loads(message)
        event_type = data.get("event")
        payload    = data.get("payload", {})
        ts         = data.get("timestamp", "")[:16]

        if event_type == "MESSAGE_RECEIVED":
            sender      = payload.get("sender", "")
            profile     = payload.get("profileName", "Unknown")
            text        = payload.get("text") or ""
            is_group    = payload.get("isGroup", False)
            chat_name   = payload.get("chatName") or sender
            group_sender= payload.get("groupSender")
            mentioned   = payload.get("mentionedMe", False)
            media       = payload.get("media", {})
            msg_id      = payload.get("messageId", "")
            context     = payload.get("context_history", [])

            print(f"\n{'─'*45}")
            print(f"  [WS] [{ts}] New message")

            if is_group:
                print(f"  Group  : {chat_name}  ({sender})")
                if group_sender:
                    print(f"  From   : {profile}  ({group_sender})")
                if mentioned:
                    print(f"  ★ You were @mentioned")
            else:
                print(f"  From   : {profile}  ({sender})")

            media_label = _media_label(media)
            if media_label:
                print(f"  Media  : {media_label}")
                if media.get("mimetype"):
                    print(f"  Type   : {media['mimetype']}")
            if text:
                print(f"  Text   : \"{text}\"")
            if msg_id:
                print(f"  ID     : {msg_id}")

            if context:
                print(f"  Context (last {len(context)}):")
                for h in context:
                    htype = h.get("type", "chat")
                    hbody = h.get("body") or f"[{htype}]"
                    print(f"    {h.get('direction', '?'):8s} {hbody}")

            print(f"{'─'*45}")

        elif event_type == "SYSTEM_READY":
            my_num = payload.get("myNumber", "")
            print(f"\n  [WS] Bot ONLINE{' — number: ' + my_num if my_num else ''}")

        elif event_type == "SYSTEM_QR_REQUIRED":
            print("\n  [WS] QR scan required — open WhatsApp and scan")

        elif event_type == "SYSTEM_DISCONNECTED":
            print(f"\n  [WS] Disconnected: {payload.get('reason', '?')}")

        elif event_type == "SYSTEM_AUTH_FAILURE":
            print(f"\n  [WS] Auth failure: {payload.get('error', '?')}")

        elif event_type == "SYSTEM_STATUS":
            pass  # Initial status dump on connect — already handled by cmd_status()

    except json.JSONDecodeError:
        pass
    except Exception as e:
        print(f"  [WS] Handler error: {e}")


def on_ws_error(ws, error):
    print(f"  [WS] Error: {error}")


def on_ws_close(ws, close_status_code, close_msg):
    print("  [WS] Connection closed — reconnecting...")


def start_websocket_listener():
    """Persistent WebSocket loop with automatic reconnect."""
    while True:
        try:
            ws = websocket.WebSocketApp(
                WS_URL,
                on_message=on_ws_message,
                on_error=on_ws_error,
                on_close=on_ws_close,
            )
            ws.run_forever(ping_interval=30, ping_timeout=10)
        except Exception as e:
            print(f"  [WS] Exception: {e}")
        print("  [WS] Retrying in 5s...")
        time.sleep(5)


# ─── MAIN MENU ───────────────────────────────────────────────────────────────

MENU = """
=== WhatsApp Client ===

  Messages
  [1]  Send Message
  [2]  Fetch Chat History
  [3]  Search Chat

  Chats & Contacts
  [4]  List All Chats / Groups
  [5]  Get Contact Info
  [6]  Get Group Participants

  Actions
  [7]  React to Message
  [8]  Mark Chat as Read
  [9]  Show Typing Indicator
  [10] Download Media
  [11] Archive / Unarchive Chat

  System
  [12] System Status
  [13] Listen for Messages (WebSocket)
  [0]  Exit
"""

COMMANDS = {
    "1" : cmd_send,
    "2" : cmd_fetch_history,
    "3" : cmd_search,
    "4" : cmd_list_chats,
    "5" : cmd_contact_info,
    "6" : cmd_group_participants,
    "7" : cmd_react,
    "8" : cmd_mark_seen,
    "9" : cmd_typing,
    "10": cmd_download_media,
    "11": cmd_archive,
    "12": cmd_status,
}

if __name__ == "__main__":
    print("Initializing client communication threads...")

    ws_thread = threading.Thread(target=start_websocket_listener, daemon=True)
    ws_thread.start()
    time.sleep(1)

    while True:
        print(MENU)
        choice = input("Your choice > ").strip()

        if choice == "0":
            print("Shutting down cleanly.")
            break

        elif choice == "13":
            print(
                "\nListening for real-time messages."
                "\nPress ENTER to return to menu.\n"
            )
            try:
                input()
            except KeyboardInterrupt:
                pass

        elif choice in COMMANDS:
            try:
                COMMANDS[choice]()
            except KeyboardInterrupt:
                print("\n  Cancelled.\n")
            except requests.exceptions.ConnectionError:
                print("  ✗ Connection refused — is bot.js running on port 3000?\n")
            except Exception as e:
                print(f"  ✗ Unexpected error: {e}\n")

        else:
            print("  Invalid choice.\n")

    print("Client environment cleanly shut down.")
