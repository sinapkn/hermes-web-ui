# 🤖 Hermes Web UI

A ChatGPT-style web interface for [Hermes Agent](https://hermes-agent.nousresearch.com). Full agent capabilities — terminal, file ops, web search — all from a beautiful dark UI.

## ⚡ One-Click Install

```bash
git clone https://github.com/sinapkn/hermes-web-ui.git
cd hermes-web-ui
bash install.sh
```

That's it! The installer auto-detects your:
- **Model & provider** from `~/.hermes/.env`
- **Railway TCP proxy** (if configured)
- **Hermes CLI** tools (terminal, web, file)

## 🔧 Manual Install

```bash
# Clone
git clone https://github.com/sinapkn/hermes-web-ui.git
cd hermes-web-ui

# Install dependencies
npm install

# Start (auto-detects model from /data/.hermes/.env)
PORT=3000 node server.js

# Or with pm2
pm2 start server.js --name hermes-web
```

## 🌐 Expose Publicly (Railway TCP Proxy)

1. Go to [railway.app](https://railway.app) → New Project
2. Add a TCP Proxy service
3. Get your URL (e.g., `sakura.proxy.rlwy.net:12345`)
4. Reinstall with proxy:
   ```bash
   bash install.sh 3000 "http://sakura.proxy.rlwy.net:12345"
   ```

## 📋 Features

- 🖥️ **Full agent tools** — terminal, file ops, web search
- 🎨 **ChatGPT-style UI** — dark theme, clean messages
- 🇮🇷 **RTL Persian** — full Farsi support
- 🔄 **Session persistence** — powered by Hermes state.db
- 🚀 **Streaming responses** — real-time tool progress
- 📱 **Mobile PWA** — installable on phones
- 🔍 **Search** — full-text search across all chats

## 🏗️ Architecture

```
Browser → Express.js → Hermes CLI → Model API
                  ↓
          state.db (sessions)
```

The web UI calls `hermes chat` with full tool access. Your model, provider, and skills are inherited from your Hermes installation.

## ⚙️ Configuration

The installer reads from `/data/.hermes/.env`:

| Variable | Description |
|----------|-------------|
| `LLM_MODEL` | Model name (e.g., `sina`, `claude-sonnet-4`) |
| `CUSTOM_PROVIDER_API_KEY` | API key |
| `CUSTOM_PROVIDER_BASE_URL` | API endpoint |
| `CUSTOM_PROVIDER_NAME` | Provider name |

## 📄 License

MIT
