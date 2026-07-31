const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── File Upload ──────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${uuidv4().slice(0,8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    // Allow images, documents, code files
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg|pdf|txt|json|md|py|js|ts|html|css|yaml|yml|sh|csv|xml|zip|tar|gz)$/i;
    if (allowed.test(path.extname(file.originalname)) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(null, true); // allow all for now
    }
  }
});

app.post('/api/upload', upload.array('files', 10), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files' });

  const results = req.files.map(f => ({
    id: f.filename,
    name: f.originalname,
    path: `/uploads/${f.filename}`,
    size: f.size,
    mime: f.mimetype,
    isImage: f.mimetype.startsWith('image/'),
  }));

  res.json(results);
});

app.use('/uploads', express.static(UPLOAD_DIR));

// ─── Load config ──────────────────────────────────────────────────
function loadConfig() {
  const hermesDir = process.env.HERMES_DIR || '/data/.hermes';
  const config = {
    model: process.env.LLM_MODEL || null,
    provider: process.env.PROVIDER || 'custom',
    baseUrl: process.env.BASE_URL || '',
    apiKey: process.env.API_KEY || '',
    hermesMode: process.env.HERMES_MODE === 'true',
    hermesDir,
  };

  // If no env vars, try reading from Hermes
  if (!config.model) {
    const envFile = path.join(hermesDir, '.env');
    try {
      const env = fs.readFileSync(envFile, 'utf-8');
      const g = n => { const m = env.match(new RegExp('^' + n + '=(.*)$', 'mi')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
      config.model = g('LLM_MODEL') || g('MODEL');
      config.provider = g('CUSTOM_PROVIDER_NAME') || config.provider;
      config.baseUrl = g('CUSTOM_PROVIDER_BASE_URL') || '';
      config.apiKey = g('CUSTOM_PROVIDER_API_KEY') || '';
      config.hermesMode = true;
    } catch {}
  }

  // Try hermes status as last resort
  if (!config.model) {
    try {
      const { execSync } = require('child_process');
      const status = execSync('hermes status 2>&1', { timeout: 10000, encoding: 'utf-8' });
      const mm = status.match(/Model:\s+(.+)$/m);
      const mp = status.match(/Provider:\s+(.+)$/m);
      if (mm) config.model = mm[1].trim();
      if (mp) config.provider = mp[1].trim();
      config.hermesMode = true;
    } catch {}
  }

  if (!config.model) {
    console.error('❌ No model configured! Set LLM_MODEL or install Hermes.');
    process.exit(1);
  }

  console.log(`[CONFIG] Model: ${config.model} | Provider: ${config.provider} | Mode: ${config.hermesMode ? 'hermes-cli' : 'direct-api'}`);
  return config;
}

const CONFIG = loadConfig();

// ─── Hermes CLI mode ──────────────────────────────────────────────
async function callHermesCLI(message, sessionId) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const args = ['chat', '-q', message.trim(), '--source', 'web', '-t', 'terminal,web,file', '--yolo', '--max-turns', '30'];
    if (sessionId) args.push('--resume', sessionId);
    args.push('-Q');

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
      if (toolMatch) console.log(`[TOOL] ${toolMatch[1]}`);
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

// ─── Direct API mode ──────────────────────────────────────────────
async function callDirectAPI(message) {
  const url = `${CONFIG.baseUrl}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages: [
        { role: 'system', content: 'تو یک دستیار هوش مصنوعی هستی. فقط به فارسی جواب بده. کوتاه و مفید.' },
        { role: 'user', content: message }
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  return { content, hermesSessionId: null };
}

// ─── Sessions (Hermes mode only) ──────────────────────────────────
if (CONFIG.hermesMode) {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(CONFIG.hermesDir, 'state.db');

    app.get('/api/sessions', (req, res) => {
      try {
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
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
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
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
      try { require('child_process').execSync(`hermes sessions delete ${req.params.id} --yes`, { timeout: 10000, stdio: 'pipe' }); } catch {}
      res.json({ ok: true });
    });
  } catch {}
}

// ─── In-memory sessions for local mode ────────────────────────────
const localSessions = {};

if (!CONFIG.hermesMode) {
  app.get('/api/sessions', (req, res) => {
    const list = Object.entries(localSessions).map(([id, s]) => ({
      id, title: s.title, created_at: s.created_at, message_count: s.messages.length
    }));
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(list);
  });

  app.get('/api/sessions/:id', (req, res) => {
    const s = localSessions[req.params.id];
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json({ id: req.params.id, title: s.title, messages: s.messages });
  });

  app.delete('/api/sessions/:id', (req, res) => {
    delete localSessions[req.params.id];
    res.json({ ok: true });
  });
}

// ─── Search ───────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);

  if (!CONFIG.hermesMode) {
    // Search local sessions
    const results = [];
    for (const [sid, s] of Object.entries(localSessions)) {
      for (const m of s.messages) {
        if (m.content.includes(q)) {
          results.push({ id: m.id || sid, session_id: sid, role: m.role, content: m.content, title: s.title });
        }
      }
    }
    return res.json(results.slice(0, 20));
  }

  try {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(CONFIG.hermesDir, 'state.db'), { readonly: true, fileMustExist: true });
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

// ─── Health ───────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    model: CONFIG.model,
    provider: CONFIG.provider,
    tools: CONFIG.hermesMode,
    mode: CONFIG.hermesMode ? 'hermes-cli' : 'direct-api'
  });
});

// ─── Chat ─────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, attachments } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  // Build message with file references
  let fullMessage = message;
  if (attachments && attachments.length) {
    const fileRefs = attachments.map(f =>
      f.isImage ? `[عکس: ${f.name}](${f.path})` : `[فایل: ${f.name}](${f.path})`
    ).join('\n');
    fullMessage = `${message}\n\nفایل‌های ضمیمه:\n${fileRefs}`;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    let result;
    if (CONFIG.hermesMode) {
      result = await callHermesCLI(fullMessage, sessionId);
    } else {
      result = await callDirectAPI(fullMessage);
      // Manage local session
      const sid = sessionId || `local_${Date.now()}`;
      if (!localSessions[sid]) {
        localSessions[sid] = { title: message.substring(0, 50), created_at: new Date().toISOString(), messages: [] };
      }
      localSessions[sid].messages.push({ role: 'user', content: message });
      localSessions[sid].messages.push({ role: 'assistant', content: result.content });
      result.hermesSessionId = sid;
    }

    // Clean response
    let cleaned = (result.content || '')
      .replace(/┊\s*review diff[\s\S]*?\r?\n/g, '')
      .replace(/\r\n/g, '\n')
      .trim();

    // Stream word by word
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
app.listen(PORT, '0.0.0.0', () => console.log(`✨ Hermes Web UI on http://0.0.0.0:${PORT} | Model: ${CONFIG.model} | Mode: ${CONFIG.hermesMode ? 'agent' : 'chat'}`));
