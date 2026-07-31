const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auto-detect Hermes config ────────────────────────────────────
function detectHermesConfig() {
  const hermesDir = process.env.HERMES_DIR || '/data/.hermes';
  const envFile = path.join(hermesDir, '.env');
  const config = { model: 'sina', provider: 'auto', hermesDir };

  try {
    const env = fs.readFileSync(envFile, 'utf-8');
    const g = n => { const m = env.match(new RegExp('^' + n + '=(.*)$', 'mi')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };

    config.model = g('LLM_MODEL') || g('MODEL') || 'sina';
    config.provider = g('CUSTOM_PROVIDER_NAME') || g('PROVIDER') || 'auto';
    config.baseUrl = g('CUSTOM_PROVIDER_BASE_URL') || g('HERMES_BASE_URL') || '';
    config.apiKey = g('CUSTOM_PROVIDER_API_KEY') || g('HERMES_API_KEY') || '';
  } catch {}

  console.log(`[CONFIG] Model: ${config.model} | Provider: ${config.provider} | Dir: ${config.hermesDir}`);
  return config;
}

const CONFIG = detectHermesConfig();

// ─── Hermes CLI call with progress ────────────────────────────────
function callHermes(message, sessionId, onProgress) {
  return new Promise((resolve, reject) => {
    const args = ['chat', '-q', message.trim(), '--source', 'web', '-t', 'terminal,web,file', '--yolo', '--max-turns', '30'];
    if (sessionId) args.push('--resume', sessionId);
    args.push('-Q');
    console.log(`[CHAT] Session: ${sessionId || 'new'} | Message: ${message.substring(0, 50)}`);

    const proc = spawn('hermes', args, {
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      timeout: 300000
    });

    let stdout = '', stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const text = d.toString();
      const toolMatch = text.match(/Tool (?:call|result):\s*(\w+)/);
      if (toolMatch) onProgress(`🔧 ${toolMatch[1]}`);
      if (text.includes('Enabled toolset')) {
        const ts = text.match(/Enabled toolset '(\w+)'/);
        if (ts) onProgress(`✅ ${ts[1]} فعال`);
      }
    });

    proc.on('close', () => {
      const sidMatch = stderr.match(/^session_id:\s*(\S+)/m);
      const hermesSid = sidMatch ? sidMatch[1] : sessionId;
      let response = stdout.replace(/^↻ Resumed session.*\n\n/m, '').trim();
      resolve({ content: response, hermesSessionId: hermesSid });
    });

    proc.on('error', reject);
  });
}

// ─── Sessions API (reads from Hermes state.db) ───────────────────
function getDb() {
  const Database = require('better-sqlite3');
  return new Database(path.join(CONFIG.hermesDir, 'state.db'), { readonly: true, fileMustExist: true });
}

app.get('/api/sessions', (req, res) => {
  try {
    const db = getDb();
    const sessions = db.prepare(`
      SELECT s.id, s.title, s.started_at, s.message_count, s.source,
        (SELECT content FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY rowid ASC LIMIT 1) as first_msg
      FROM sessions s
      WHERE (s.archived IS NULL OR s.archived = 0) AND s.source = 'web'
      ORDER BY s.started_at DESC LIMIT 50
    `).all().map(s => ({
      id: s.id,
      title: s.title || (s.first_msg||'').substring(0,50) || 'چت جدید',
      created_at: new Date(s.started_at * 1000).toISOString(),
      message_count: s.message_count
    }));
    db.close();
    res.json(sessions);
  } catch { res.json([]); }
});

app.get('/api/sessions/:id', (req, res) => {
  try {
    const db = getDb();
    const msgs = db.prepare(`
      SELECT id, session_id, role, content, rowid as created_at
      FROM messages WHERE session_id = ? AND role IN ('user','assistant')
      ORDER BY rowid ASC
    `).all(req.params.id);
    db.close();
    if (!msgs.length) return res.status(404).json({ error: 'not found' });
    res.json({ id: req.params.id, title: req.params.id, messages: msgs });
  } catch { res.status(404).json({ error: 'not found' }); }
});

app.delete('/api/sessions/:id', (req, res) => {
  try { execSync(`hermes sessions delete ${req.params.id} --yes`, { timeout: 10000, stdio: 'pipe' }); } catch {}
  res.json({ ok: true });
});

app.get('/api/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);
  try {
    const db = getDb();
    const results = db.prepare(`
      SELECT m.id, m.session_id, m.role, m.content, s.title
      FROM messages m JOIN sessions s ON m.session_id = s.id
      WHERE m.content LIKE ? AND m.role IN ('user','assistant')
      ORDER BY m.rowid DESC LIMIT 20
    `).all(`%${q}%`);
    db.close();
    res.json(results);
  } catch { res.json([]); }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    model: CONFIG.model,
    provider: CONFIG.provider,
    tools: true,
    mode: 'hermes-cli'
  });
});

// ─── Chat ─────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  // Disable Nagle's algorithm for immediate delivery
  if (res.socket) res.socket.setNoDelay(true);

  try {
    const result = await callHermes(message, sessionId, (progress) => {
      res.write(`data: ${JSON.stringify({ type: 'status', content: progress })}\n\n`);
    });

    // Clean response: remove raw diff output
    let cleaned = (result.content || '')
      .replace(/┊\s*review diff[\s\S]*?\r?\n/g, '')
      .replace(/\r\n/g, '\n')
      .trim();

    // Stream response word by word
    if (cleaned) {
      const words = cleaned.split(/(\s+)/);
      for (const word of words) {
        if (word) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: word })}\n\n`);
        }
      }
    }

    res.write(`data: ${JSON.stringify({
      type: 'done',
      sessionId: result.hermesSessionId || sessionId || '',
      assistantMessage: { content: cleaned }
    })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[ERROR]', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// ─── SPA fallback ─────────────────────────────────────────────────
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`✨ Hermes Web UI on http://0.0.0.0:${PORT} | Model: ${CONFIG.model}`));
