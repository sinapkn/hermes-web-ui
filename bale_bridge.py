#!/usr/bin/env python3
"""
Bale <-> Hermes bridge (durable version)
Connects Bale messenger to Hermes web UI /api/chat via long polling.
Self-healing: retries network errors, never exits on transient failures.
Supervised by server.js (Railway) so it restarts with the app.
"""
import json
import time
import urllib.request
import urllib.error
import logging
import os
import sys

# ─── Config ────────────────────────────────────────────────────────
BALE_TOKEN = os.environ.get('BALE_TOKEN')
ALLOWED_IDS = {int(x) for x in os.environ.get('ALLOWED_IDS', '841332581').split(',') if x.strip()}
HERMES_URL = os.environ.get('HERMES_URL', 'http://127.0.0.1:3000/api/chat')
POLL_INTERVAL = float(os.environ.get('POLL_INTERVAL', '1'))
LOG_FILE = os.environ.get('BALE_BRIDGE_LOG', '/tmp/bale-bridge.log')

# Must have a token or the bridge is pointless
if not BALE_TOKEN or BALE_TOKEN.startswith('REDACTED') or '***' in BALE_TOKEN:
    print("[BALE-BRIDGE] No BALE_TOKEN provided, bridge not starting. Exiting.", flush=True)
    sys.exit(0)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger('bale-bridge')

BALE_BASE = f"https://tapi.bale.ai/bot{BALE_TOKEN}"


def api_call(method, params=None, timeout=30):
    url = f"{BALE_BASE}/{method}"
    body = json.dumps(params).encode() if params else None
    req = urllib.request.Request(
        url, data=body,
        headers={'Content-Type': 'application/json'} if body else {}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            body_txt = e.read().decode('utf-8', errors='ignore')
        except Exception:
            body_txt = ''
        log.error(f"Bale API {method} HTTP {e.code}: {body_txt[:200]}")
        return None
    except Exception as e:
        log.error(f"Bale API {method} error: {e}")
        return None


def send_message(chat_id, text):
    return api_call('sendMessage', {'chat_id': chat_id, 'text': text}, timeout=30)


def ask_hermes(message, session_id=None):
    """POST to local Hermes /api/chat (SSE), collect the full reply."""
    payload = json.dumps({
        'message': message,
        'sessionId': session_id,
        'attachments': []
    }).encode()
    req = urllib.request.Request(
        HERMES_URL,
        data=payload,
        headers={'Content-Type': 'application/json', 'Accept': 'text/event-stream'}
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            full = ''
            new_session = None
            for raw in resp:
                line = raw.decode('utf-8', errors='ignore').strip()
                if line.startswith('data:'):
                    try:
                        obj = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    t = obj.get('type')
                    if t == 'chunk':
                        full += obj.get('content', '')
                    elif t == 'done':
                        new_session = obj.get('sessionId')
                        if not full and obj.get('assistantMessage'):
                            full = obj['assistantMessage'].get('content', '')
            return full, new_session
    except Exception as e:
        log.error(f"Hermes request error: {e}")
        return None, None


def main():
    log.info("=== Bale-Hermes bridge (durable) started ===")
    log.info(f"Allowed IDs: {sorted(ALLOWED_IDS)}")
    log.info(f"Hermes URL: {HERMES_URL}")

    sessions = {}

    # Seed offset so old messages aren't reprocessed
    offset = None
    try:
        res = api_call('getUpdates', {})
        if res and res.get('ok'):
            updates = res.get('result', [])
            if updates:
                offset = updates[-1]['update_id'] + 1
    except Exception as e:
        log.warning(f"Could not seed offset: {e}")
    log.info(f"Starting with offset={offset}")

    try:
        me_res = api_call('getMe')
        if me_res and me_res.get('ok'):
            me = me_res.get('result', {})
            log.info(f"Bot: {me.get('username')} ({me.get('id')})")
    except Exception:
        pass

    while True:
        try:
            res = api_call('getUpdates', {'offset': offset})
            if not res or not res.get('ok'):
                time.sleep(POLL_INTERVAL)
                continue

            for update in res.get('result', []):
                offset = update.get('update_id', 0) + 1
                msg = update.get('message')
                if not msg:
                    continue
                chat_id = msg.get('chat', {}).get('id')
                text = msg.get('text')
                if chat_id not in ALLOWED_IDS:
                    log.info(f"Ignoring non-allowed chat {chat_id}")
                    continue
                if not text:
                    log.info(f"Ignoring non-text message from {chat_id}")
                    continue

                log.info(f"< [{chat_id}] {text[:100]}")
                reply, sess = ask_hermes(text, sessions.get(str(chat_id)))
                if reply:
                    if sess:
                        sessions[str(chat_id)] = sess
                    reply = reply.strip() if reply else "(بدون پاسخ)"
                    sent = send_message(chat_id, reply)
                    log.info(f"> [{chat_id}] sent={bool(sent)} ({len(reply)} chars)")
                else:
                    log.error(f"No reply for {chat_id}")
                    send_message(chat_id, "خطا در دریافت پاسخ")

            time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            log.info("Stopping bridge...")
            break
        except Exception as e:
            log.exception("Loop error, continuing")
            time.sleep(2)


if __name__ == '__main__':
    main()