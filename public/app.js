/* ═══════════════════════════════════════════════════════════════════════
   Hermes Web UI — Frontend (v3)
   ═══════════════════════════════════════════════════════════════════════ */

// ─── PWA: Register Service Worker ──────────────────────────────────────
let deferredPrompt = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// PWA install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

// Show install banner after 5 seconds
setTimeout(() => {
  if (deferredPrompt && !localStorage.getItem('pwa-dismissed')) {
    showInstallBanner();
  }
}, 5000);

function showInstallBanner() {
  if ($('#installBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'installBanner';
  banner.className = 'install-banner';
  banner.innerHTML = `
    <div class="install-banner-text">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>نصب به عنوان اپ</span>
    </div>
    <button class="install-banner-btn" onclick="installApp()">نصب</button>
    <button class="install-banner-close" onclick="dismissInstall()">×</button>
  `;
  document.body.appendChild(banner);
}

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  dismissInstall();
}

function dismissInstall() {
  const banner = $('#installBanner');
  if (banner) banner.remove();
  localStorage.setItem('pwa-dismissed', '1');
}

// ─── State ─────────────────────────────────────────────────────────────
let currentSessionId = null;
let sessions = [];
let isStreaming = false;

// ─── DOM Elements ──────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const sidebar = $('#sidebar');
const sessionList = $('#sessionList');
const messagesContainer = $('#messagesContainer');
const messagesList = $('#messagesList');
const welcomeScreen = $('#welcomeScreen');
const typingIndicator = $('#typingIndicator');
const messageInput = $('#messageInput');

// ─── Dynamic Model Name ─────────────────────────────────────────────
async function detectModel() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.model) {
      const name = data.model.charAt(0).toUpperCase() + data.model.slice(1);
      // Update sidebar brand
      const brandText = $('.brand-text');
      if (brandText) brandText.textContent = name;
      // Update welcome title
      const welcomeTitle = welcomeScreen?.querySelector('h1');
      if (welcomeTitle) welcomeTitle.textContent = name;
      // Update topbar
      const topbarTitle = $('#topbarTitle');
      if (topbarTitle) topbarTitle.textContent = name;
      // Update page title
      document.title = name;
    }
  } catch {}
}
detectModel();
const sendBtn = $('#sendBtn');
const searchInput = $('#searchInput');
const topbarTitle = $('#topbarTitle');
const searchCloseBtn = $('#searchCloseBtn');
const searchResults = $('#searchResults');

// ─── Initialization ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSessions();
  setupEventListeners();
  autoResizeInput();
});

function setupEventListeners() {
  // Send message
  sendBtn.addEventListener('click', sendMessage);

  // Enter to send, Shift+Enter for newline
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Input state
  messageInput.addEventListener('input', () => {
    sendBtn.disabled = !messageInput.value.trim() && !pendingAttachments.length;
  });

  // File upload menu
  const uploadBtn = $('#uploadBtn');
  const uploadMenu = $('#uploadMenu');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      uploadMenu.classList.toggle('hidden');
    });
  }
  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (uploadMenu && !uploadMenu.contains(e.target) && e.target !== uploadBtn) {
      uploadMenu.classList.add('hidden');
    }
  });
  // Attach change listeners to all file inputs
  ['fileInputImage', 'fileInputDoc', 'fileInputCode', 'fileInputAny'].forEach(id => {
    const fi = $(`#${id}`);
    if (fi) fi.addEventListener('change', handleFileUpload);
  });

  // Drag & drop
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) {
      const fi = $('#fileInputAny');
      fi.files = e.dataTransfer.files;
      handleFileUpload();
    }
  });

  // Input state
  messageInput.addEventListener('input', () => {
    sendBtn.disabled = !messageInput.value.trim();
  });

  // New chat
  $('#newChatBtn').addEventListener('click', createNewSession);

  // Sidebar toggle (mobile)
  $('#menuToggle').addEventListener('click', toggleSidebar);

  // Search — live with debounce
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    // Show/hide close button
    if (q.length > 0) {
      searchCloseBtn.classList.remove('hidden');
    } else {
      searchCloseBtn.classList.add('hidden');
    }
    if (q.length < 2) {
      clearSearch();
      return;
    }
    searchTimer = setTimeout(() => liveSearch(q), 300);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearSearch();
      searchInput.value = '';
      searchCloseBtn.classList.add('hidden');
    }
  });

  // Topbar actions
  $('#deleteSessionBtn').addEventListener('click', deleteCurrentSession);
  $('#exportBtn').addEventListener('click', exportSession);

  // Sidebar footer buttons
  if ($('#memoryBtn')) {
    $('#memoryBtn').addEventListener('click', () => {
      // Simplified: just show a toast
      showToast('حافظه از طریق چت قابل مدیریت است');
    });
  }
  if ($('#healthBtn')) {
    $('#healthBtn').addEventListener('click', showHealthStatus);
  }

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && e.target !== $('#menuToggle') && !$('#menuToggle').contains(e.target)) {
        toggleSidebar();
      }
    }
  });

  // Close context menus on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu') && !e.target.closest('.session-menu-btn')) {
      closeSessionMenu();
    }
  });

  // Close context menu on scroll
  if (messagesContainer) {
    messagesContainer.addEventListener('scroll', closeSessionMenu);
  }
}

// ─── Auto-resize Input ────────────────────────────────────────────────
function autoResizeInput() {
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
  });
}

// ─── Toast Notifications ──────────────────────────────────────────────
function showToast(message, duration = 2500) {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.style.cssText = `
      position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
      background: var(--bg-tertiary); color: var(--text-primary);
      padding: 10px 20px; border-radius: 12px; font-size: 13px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4); z-index: 9999;
      opacity: 0; transition: opacity 0.3s ease; pointer-events: none;
      border: 1px solid var(--border);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

// ─── API Calls ─────────────────────────────────────────────────────────
async function api(url, options = {}) {
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DATE GROUPING — ChatGPT-style session sections
// ═══════════════════════════════════════════════════════════════════════

function getDateGroup(dateStr) {
  if (!dateStr) return 'previous30';
  try {
    const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday - 86400000);
    const startOf7Days = new Date(startOfToday - 7 * 86400000);
    const startOf30Days = new Date(startOfToday - 30 * 86400000);

    if (d >= startOfToday) return 'today';
    if (d >= startOfYesterday) return 'yesterday';
    if (d >= startOf7Days) return 'previous7';
    if (d >= startOf30Days) return 'previous30';
    return 'older';
  } catch {
    return 'older';
  }
}

function getDateGroupLabel(group) {
  const labels = {
    today: 'Today',
    yesterday: 'Yesterday',
    previous7: 'Previous 7 days',
    previous30: 'Previous 30 days',
    older: 'Older',
  };
  return labels[group] || group;
}

function groupSessionsByDate(sessionArray) {
  const groups = {};
  const order = ['today', 'yesterday', 'previous7', 'previous30', 'older'];

  for (const s of sessionArray) {
    const group = getDateGroup(s.updated_at || s.created_at);
    if (!groups[group]) groups[group] = [];
    groups[group].push(s);
  }

  // Sort sessions within each group by updated_at descending
  for (const g of Object.keys(groups)) {
    groups[g].sort((a, b) => {
      const da = new Date((a.updated_at || a.created_at || '') + 'Z');
      const db = new Date((b.updated_at || b.created_at || '') + 'Z');
      return db - da;
    });
  }

  return order.filter(g => groups[g] && groups[g].length > 0).map(g => ({
    label: getDateGroupLabel(g),
    sessions: groups[g],
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// SESSIONS — Full CRUD + rename + pin + context menu
// ═══════════════════════════════════════════════════════════════════════

async function loadSessions() {
  sessions = await api('/api/sessions');
  renderSessionList();
}

function renderSessionList(filtered = null) {
  const list = filtered || sessions;

  if (list.length === 0) {
    sessionList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💬</div>
        <div>${filtered ? 'No results found' : 'No conversations yet'}</div>
      </div>`;
    return;
  }

  // Group by date
  const groups = groupSessionsByDate(list);
  let html = '';

  for (const group of groups) {
    html += `<div class="session-date-group">
      <div class="session-date-label">${group.label}</div>`;

    for (const s of group.sessions) {
      const isActive = s.id === currentSessionId;
      const preview = escapeHtml((s.last_message || '').substring(0, 60));

      html += `
        <div class="session-item ${isActive ? 'active' : ''}"
             onclick="openSession('${s.id}')"
             data-id="${s.id}">
          <div class="session-item-content">
            <div class="session-title">${escapeHtml(s.title)}</div>
          </div>
          <button class="session-menu-btn" onclick="event.stopPropagation(); toggleSessionMenu(event, '${s.id}')" title="Options">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
        </div>`;
    }

    html += '</div>';
  }

  sessionList.innerHTML = html;
}

// ─── ChatGPT-style 3-dot hover menu ──────────────────────────────────
let activeMenu = null;

function toggleSessionMenu(e, id) {
  e.stopPropagation();
  const existing = document.querySelector('.context-menu');
  if (existing) {
    existing.remove();
    activeMenu = null;
    return;
  }

  const s = sessions.find(x => x.id === id);
  if (!s) return;

  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <button onclick="event.stopPropagation(); renameSession('${id}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Rename
    </button>
    <button onclick="event.stopPropagation(); shareSession('${id}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
        <polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
      </svg>
      Share
    </button>
    <div class="context-menu-divider"></div>
    <button class="danger" onclick="event.stopPropagation(); deleteSession('${id}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
      Delete
    </button>`;

  // Position menu
  menu.style.position = 'fixed';
  menu.style.zIndex = '9999';

  document.body.appendChild(menu);
  activeMenu = menu;

  // Position: try to place near the button, but keep in viewport
  const menuRect = menu.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.left;

  if (top + menuRect.height > window.innerHeight) {
    top = rect.top - menuRect.height - 4;
  }
  if (left + menuRect.width > window.innerWidth) {
    left = window.innerWidth - menuRect.width - 8;
  }
  if (left < 8) left = 8;

  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
}

function closeSessionMenu() {
  const menu = document.querySelector('.context-menu');
  if (menu) {
    menu.remove();
    activeMenu = null;
  }
}

// ─── Session Actions ──────────────────────────────────────────────────

function filterSessions() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    renderSessionList();
    return;
  }
  const filtered = sessions.filter(s =>
    s.title.toLowerCase().includes(q) ||
    (s.last_message || '').toLowerCase().includes(q)
  );
  renderSessionList(filtered);
}

async function createNewSession() {
  currentSessionId = null;
  messagesList.innerHTML = '';
  messagesContainer.classList.add('hidden');
  welcomeScreen.classList.remove('hidden');
  topbarTitle.textContent = 'Sina AI';
  isStreaming = false;
  renderSessionList();
  if (window.innerWidth <= 768) toggleSidebar();
}

async function openSession(id) {
  currentSessionId = id;
  const session = await api(`/api/sessions/${id}`);
  welcomeScreen.classList.add('hidden');
  messagesContainer.classList.remove('hidden');
  topbarTitle.textContent = session.title;
  renderMessages(session.messages);
  renderSessionList();

  // Close mobile sidebar
  if (window.innerWidth <= 768) {
    if (sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      const overlay = document.querySelector('.sidebar-overlay');
      if (overlay) overlay.classList.remove('show');
    }
  }

  // Scroll to bottom after render
  requestAnimationFrame(() => scrollToBottom());
}

async function deleteSession(id) {
  closeSessionMenu();

  await api(`/api/sessions/${id}`, { method: 'DELETE' });
  sessions = sessions.filter(x => x.id !== id);

  if (currentSessionId === id) {
    currentSessionId = null;
    welcomeScreen.classList.remove('hidden');
    messagesContainer.classList.add('hidden');
    topbarTitle.textContent = 'Hermes';
  }
  renderSessionList();
  showToast('Chat deleted');
}

async function deleteCurrentSession() {
  if (!currentSessionId) return;
  await deleteSession(currentSessionId);
}

async function deleteAllSessions() {
  await api('/api/sessions', { method: 'DELETE' });
  currentSessionId = null;
  welcomeScreen.classList.remove('hidden');
  messagesContainer.classList.add('hidden');
  topbarTitle.textContent = 'Hermes';
  await loadSessions();
  showToast('All conversations deleted');
}

async function renameSession(id) {
  closeSessionMenu();
  const s = sessions.find(x => x.id === id);
  if (!s) return;

  const newTitle = prompt('Rename conversation:', s.title);
  if (!newTitle || newTitle.trim() === s.title || !newTitle.trim()) return;

  await api(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title: newTitle.trim() })
  });

  if (currentSessionId === id) topbarTitle.textContent = newTitle.trim();
  await loadSessions();
  showToast('Renamed');
}

async function togglePinSession(id) {
  closeSessionMenu();
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  await api(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ is_pinned: s.is_pinned ? 0 : 1 })
  });
  await loadSessions();
}

function shareSession(id) {
  closeSessionMenu();
  const url = `${window.location.origin}/?session=${id}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied to clipboard');
  }).catch(() => {
    showToast('Could not copy link');
  });
}

async function duplicateSession(id) {
  closeSessionMenu();
  const s = sessions.find(x => x.id === id);
  if (!s) return;

  const newS = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ title: s.title + ' (copy)' })
  });

  const old = await api(`/api/sessions/${id}`);
  for (const m of old.messages) {
    await api(`/api/sessions/${newS.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: m.role, content: m.content })
    });
  }

  await loadSessions();
  openSession(newS.id);
}

// ═══════════════════════════════════════════════════════════════════════
// MESSAGES — ChatGPT-style rendering
// ═══════════════════════════════════════════════════════════════════════

function renderMessages(messages) {
  if (!messages || messages.length === 0) {
    messagesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💬</div>
        <div>No messages yet</div>
      </div>`;
    return;
  }
  messagesList.innerHTML = messages.map(m => createMessageHtml(m)).join('');
  scrollToBottom();
}

function createMessageHtml(m) {
  const isUser = m.role === 'user';
  const content = formatContent(m.content);
  const msgId = m.id || '';

  // Show attached files
  let attachHtml = '';
  if (m.attachments && m.attachments.length) {
    const imgs = m.attachments.filter(a => a.isImage).map(a => `<img src="${a.path}" alt="${a.name}">`).join('');
    const files = m.attachments.filter(a => !a.isImage).map(a => {
      const ext = (a.name.split('.').pop() || '').toUpperCase();
      return `<a href="${a.path}" target="_blank" class="att-file-card"><span class="att-file-icon">📄</span><div class="att-file-info"><span class="att-file-name">${a.name}</span><span class="att-file-ext">${ext}</span></div></a>`;
    }).join('');
    let parts = '';
    if (imgs) parts += `<div class="att-images">${imgs}</div>`;
    if (files) parts += `<div class="att-files">${files}</div>`;
    attachHtml = parts;
  }

  return `
    <div class="message ${m.role}" data-id="${msgId}">
      <div class="message-content">
        ${attachHtml}
        ${isUser ? `<div class="message-user-text">${escapeHtml(m.content)}</div>` : `<div class="message-body">${content}</div>`}
      </div>
      <button class="msg-delete-btn" onclick="deleteMessage('${msgId}')" title="حذف">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>`;
}

async function deleteMessage(msgId) {
  if (!msgId || !currentSessionId) return;
  await api(`/api/sessions/${currentSessionId}/messages/${msgId}`, { method: 'DELETE' });
  const el = messagesList.querySelector(`[data-id="${msgId}"]`);
  if (el) {
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 200);
  }
  await loadSessions();
}

// ─── Chat (SSE Streaming) ─────────────────────────────────────────────
let pendingAttachments = [];

function triggerUpload(inputId) {
  const menu = $('#uploadMenu');
  if (menu) menu.classList.add('hidden');
  const fi = $(`#${inputId}`);
  if (fi) fi.click();
}
window.triggerUpload = triggerUpload;

async function handleFileUpload() {
  // Find which file input triggered this
  const inputs = ['fileInputImage', 'fileInputDoc', 'fileInputCode', 'fileInputAny'];
  let fileInput = null;
  for (const id of inputs) {
    const fi = $(`#${id}`);
    if (fi && fi.files.length) { fileInput = fi; break; }
  }
  if (!fileInput) return;
  const formData = new FormData();
  for (const file of fileInput.files) formData.append('files', file);
  try {
    const resp = await fetch('/api/upload', { method: 'POST', body: formData });
    const files = await resp.json();
    pendingAttachments.push(...files);
    renderAttachmentPreview();
    sendBtn.disabled = !messageInput.value.trim() && !pendingAttachments.length;
  } catch (err) { console.error('Upload failed:', err); }
  fileInput.value = '';
}

function renderAttachmentPreview() {
  const preview = $('#attachmentPreview');
  if (!pendingAttachments.length) { preview.classList.add('hidden'); return; }
  preview.classList.remove('hidden');
  preview.innerHTML = pendingAttachments.map((f, i) => {
    if (f.isImage) {
      return `<div class="att-thumb"><img src="${f.path}"><button class="att-remove" onclick="removeAttachment(${i})">✕</button></div>`;
    }
    return `<div class="att-thumb att-file"><span>📄</span><button class="att-remove" onclick="removeAttachment(${i})">✕</button></div>`;
  }).join('');
}

function removeAttachment(i) { pendingAttachments.splice(i, 1); renderAttachmentPreview(); sendBtn.disabled = !messageInput.value.trim() && !pendingAttachments.length; }
window.removeAttachment = removeAttachment;
async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || isStreaming) return;

  const attachments = [...pendingAttachments];
  pendingAttachments = [];
  renderAttachmentPreview();

  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;

  welcomeScreen.classList.add('hidden');
  messagesContainer.classList.remove('hidden');

  // Add user message immediately
  appendMessage({ role: 'user', content, created_at: new Date().toISOString(), attachments });

  isStreaming = true;
  typingIndicator.classList.remove('hidden');
  scrollToBottom();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, sessionId: currentSessionId, attachments })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = '';
    let assistantEl = null;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const event = JSON.parse(trimmed.slice(6));

          if (event.type === 'status') {
            typingIndicator.classList.remove('hidden');
            const statusText = typingIndicator.querySelector('span:last-child');
            if (statusText && event.content) {
              statusText.textContent = event.content;
            }
          }

          if (event.type === 'chunk') {
            if (!assistantEl) {
              typingIndicator.classList.add('hidden');
              assistantEl = appendStreamingMessage();
            }
            assistantText += event.content;
            updateStreamingMessage(assistantEl, assistantText);
            scrollToBottom();
            // Typing delay — wait before rendering next word
            await new Promise(r => setTimeout(r, 20));
          }

          if (event.type === 'done' || event.type === 'error') {
            typingIndicator.classList.add('hidden');
            isStreaming = false;
            if (assistantEl) {
              finalizeStreamingMessage(assistantEl, event.assistantMessage);
            }
            if (event.sessionId && !currentSessionId) {
              currentSessionId = event.sessionId;
            }
            await loadSessions();
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } catch (err) {
    console.error('Stream error:', err);
    typingIndicator.classList.add('hidden');
    isStreaming = false;
    appendMessage({
      role: 'assistant',
      content: '⚠️ Connection error. Please try again.',
      created_at: new Date().toISOString()
    });
  }
}

function appendStreamingMessage() {
  const id = 'streaming-msg';
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const html = `
    <div class="message assistant" id="${id}">
      <div class="message-header">
        <div class="message-avatar assistant-avatar">⬡</div>
        <span class="message-sender">Hermes</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-body streaming"></div>
    </div>`;
  messagesList.insertAdjacentHTML('beforeend', html);
  return document.getElementById(id);
}

function updateStreamingMessage(el, text) {
  if (!el) return;
  // During streaming: just show raw text (fast, no markdown parsing)
  el.querySelector('.message-body').textContent = text;
}

function finalizeStreamingMessage(el, msgData) {
  if (!el) return;
  el.removeAttribute('id');
  el.querySelector('.message-body').classList.remove('streaming');
  if (msgData && msgData.id) el.dataset.id = msgData.id;

  // Now parse markdown for the final version
  const body = el.querySelector('.message-body');
  if (msgData && msgData.content) {
    body.innerHTML = formatContent(msgData.content);
  }

  // Add copy buttons to any code blocks
  el.querySelectorAll('pre').forEach(addCopyButtonToCodeBlock);
}

function appendMessage(m) {
  messagesList.insertAdjacentHTML('beforeend', createMessageHtml(m));
  scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ─── Suggestions ───────────────────────────────────────────────────────
function sendSuggestion(text) {
  messageInput.value = text;
  sendBtn.disabled = false;
  sendMessage();
}

// ─── Sidebar Toggle (Mobile) ──────────────────────────────────────────
function toggleSidebar() {
  sidebar.classList.toggle('open');
  let overlay = document.querySelector('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.onclick = () => toggleSidebar();
    document.body.appendChild(overlay);
  }
  overlay.classList.toggle('show');
  // Prevent body scroll when sidebar open on mobile
  if (sidebar.classList.contains('open')) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
}

// ─── Health Status ────────────────────────────────────────────────────
async function showHealthStatus() {
  try {
    const h = await api('/api/health');
    showToast(`Status: ${h.status} | Sessions: ${h.sessions} | Messages: ${h.messages}`);
  } catch {
    showToast('Could not fetch status');
  }
}

// ─── Search (Live) ────────────────────────────────────────────────────
function liveSearch(query) {
  const q = query.toLowerCase();
  const filtered = sessions.filter(s =>
    s.title.toLowerCase().includes(q) ||
    (s.last_message || '').toLowerCase().includes(q)
  );

  // Show filtered results in session list
  if (filtered.length > 0) {
    searchResults.classList.add('hidden');
    renderSessionList(filtered);
  } else {
    searchResults.classList.remove('hidden');
    searchResults.innerHTML = '<div class="search-empty">No results found</div>';
    sessionList.innerHTML = '';
  }
}

function clearSearch() {
  searchInput.value = '';
  searchResults.classList.add('hidden');
  searchResults.innerHTML = '';
  if (searchCloseBtn) searchCloseBtn.classList.add('hidden');
  renderSessionList();
}

// ─── Export ────────────────────────────────────────────────────────────
async function exportSession() {
  if (!currentSessionId) return;
  const session = await api(`/api/sessions/${currentSessionId}`);
  const data = {
    title: session.title,
    created_at: session.created_at,
    messages: session.messages.map(m => ({
      role: m.role,
      content: m.content,
      time: m.created_at
    }))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hermes-${session.title}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported');
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ─── Markdown Content Rendering ───────────────────────────────────────

function formatContent(content) {
  if (!content) return '';

  let html = escapeHtml(content);

  // Code blocks: ```lang\ncode\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
    const codeId = 'code-' + Math.random().toString(36).substring(2, 10);
    return `<div class="code-block-wrapper">
      <div class="code-block-header">${langLabel}<button class="copy-code-btn" onclick="copyCodeBlock('${codeId}')">Copy</button></div>
      <pre id="${codeId}"><code>${code.trim()}</code></pre>
    </div>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic: *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Auto-link plain URLs (http/https)
  html = html.replace(/(^|[\s(])((https?:\/\/)[^\s<>"')]+)/g, (match, pre, url) => {
    // Don't double-link if already inside an <a> tag
    return `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
  });

  // Images: ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:12px;margin:8px 0">');
  // Auto-link /uploads/ image refs
  html = html.replace(/(\/uploads\/[^\s"']+\.(?:png|jpg|jpeg|gif|webp|svg))/gi, '<img src="$1" style="max-width:300px;border-radius:12px;margin:8px 0">');

  // Headers: ### text, ## text, # text
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Unordered lists
  html = html.replace(/^[-•*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Newlines to <br> (but not inside pre blocks)
  // Simple approach: only add <br> where there isn't already a block element
  html = html.replace(/\n(?!<)/g, '<br>');

  // Clean up: remove <br> right before block elements
  html = html.replace(/<br>\s*(<ul|<h[2-4]|<blockquote|<hr|<div class="code-block-wrapper")/g, '$1');

  return html;
}

function copyCodeBlock(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    // Find the copy button for this code block
    const btn = el.closest('.code-block')?.querySelector('.copy-code-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    }
  }).catch(() => {});
}

function addCopyButtonToCodeBlock(pre) {
  // If already has a copy button, skip
  if (pre.previousElementSibling?.classList?.contains('code-block-header')) return;

  const codeId = pre.id || ('code-' + Math.random().toString(36).substring(2, 10));
  if (!pre.id) pre.id = codeId;

  const header = document.createElement('div');
  header.className = 'code-block-header';
  header.innerHTML = `<button class="copy-code-btn" onclick="copyCodeBlock('${codeId}')">Copy</button>`;
  pre.parentNode.insertBefore(header, pre);
}

// ─── Time Formatting ──────────────────────────────────────────────────

function formatTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatUptime(seconds) {
  if (!seconds) return '0';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Settings Modal ───────────────────────────────────────────────
async function openSettings() {
  const modal = $('#settingsModal');
  const body = $('#settingsBody');
  modal.classList.remove('hidden');
  
  try {
    const [health, config] = await Promise.all([
      api('/api/health'),
      api('/api/config')
    ]);
    
    let toolsHtml = '';
    if (config.tools && config.tools.length) {
      toolsHtml = `
        <div class="settings-section">
          <h3>Active Tools</h3>
          <div class="tools-grid">
            ${config.tools.map(t => `
              <div class="settings-row">
                <span class="settings-label">${t.icon} ${t.label}</span>
                <span class="settings-badge enabled">ON</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    
    body.innerHTML = `
      <div class="settings-section">
        <h3>Model</h3>
        <div class="settings-input-group">
          <label>Model Name</label>
          <input type="text" id="settingModel" value="${config.model}" class="settings-input" placeholder="e.g. claude-sonnet-4, gpt-4o...">
        </div>
        <div class="settings-input-group">
          <label>Provider</label>
          <input type="text" id="settingProvider" value="${config.provider}" class="settings-input" placeholder="e.g. openrouter, anthropic...">
        </div>
        <div class="settings-input-group">
          <label>Base URL</label>
          <input type="text" id="settingBaseUrl" value="${config.baseUrl || ''}" class="settings-input" placeholder="API endpoint URL">
        </div>
        <button onclick="saveSettings()" class="settings-save-btn">Save</button>
        <div id="settingsStatus" class="settings-status"></div>
      </div>
      ${toolsHtml}
      <div class="settings-section">
        <h3>System</h3>
        <div class="settings-row">
          <span class="settings-label">Mode</span>
          <span class="settings-badge ${config.mode === 'hermes-cli' ? 'enabled' : 'disabled'}">${config.mode}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Status</span>
          <span class="settings-badge ${health.status === 'ok' ? 'enabled' : 'disabled'}">${health.status}</span>
        </div>
      </div>
    `;
  } catch (e) {
    body.innerHTML = '<div class="loading-state">Could not load settings</div>';
  }
}

async function saveSettings() {
  const status = $('#settingsStatus');
  const model = $('#settingModel').value.trim();
  const provider = $('#settingProvider').value.trim();
  const baseUrl = $('#settingBaseUrl').value.trim();
  
  if (!model) {
    status.innerHTML = '<span class="settings-badge disabled">Model is required</span>';
    return;
  }
  
  status.innerHTML = '<span class="settings-badge enabled">Saving...</span>';
  
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, provider, baseUrl })
    });
    const data = await res.json();
    
    if (data.ok) {
      status.innerHTML = '<span class="settings-badge enabled">Saved! Restart server to apply.</span>';
      // Update UI immediately
      const brandText = $('.brand-text');
      const h1 = $('.welcome-screen h1');
      const title = document.title;
      const displayModel = model.split('/').pop();
      if (brandText) brandText.textContent = displayModel;
      if (h1) h1.textContent = displayModel;
      document.title = displayModel + ' AI';
    } else {
      status.innerHTML = `<span class="settings-badge disabled">Error: ${data.error}</span>`;
    }
  } catch (e) {
    status.innerHTML = `<span class="settings-badge disabled">Error: ${e.message}</span>`;
  }
}

function closeSettings() {
  $('#settingsModal').classList.add('hidden');
}

// Close modal on outside click
document.addEventListener('click', (e) => {
  if (e.target.id === 'settingsModal') closeSettings();
});

// ─── Memory Modal ────────────────────────────────────────────────
async function openMemory() {
  const modal = $('#memoryModal');
  const body = $('#memoryBody');
  modal.classList.remove('hidden');
  body.innerHTML = '<div class="loading-state">Loading memories...</div>';
  
  try {
    const data = await api('/api/memory');
    
    if (!data.memories || !data.memories.length) {
      body.innerHTML = '<div class="loading-state">No memories found</div>';
      return;
    }
    
    body.innerHTML = data.memories.map(m => `
      <div class="memory-card">
        <div class="memory-card-header">
          <span class="memory-card-name">${m.name}</span>
          <span class="memory-card-size">${Math.round(m.size / 1024 * 10) / 10}KB</span>
        </div>
        <pre class="memory-card-content">${escapeHtml(m.content)}</pre>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = '<div class="loading-state">Could not load memories</div>';
  }
}

function closeMemory() {
  $('#memoryModal').classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'memoryModal') closeMemory();
});

// ─── Status Modal ────────────────────────────────────────────────
async function openStatus() {
  const modal = $('#statusModal');
  const body = $('#statusBody');
  modal.classList.remove('hidden');
  body.innerHTML = '<div class="loading-state">Loading status...</div>';
  
  try {
    const [health, config] = await Promise.all([
      api('/api/health'),
      api('/api/config')
    ]);
    
    body.innerHTML = `
      <div class="settings-section">
        <h3>Server</h3>
        <div class="settings-row">
          <span class="settings-label">Status</span>
          <span class="settings-badge ${health.status === 'ok' ? 'enabled' : 'disabled'}">${health.status === 'ok' ? 'Online' : 'Offline'}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Mode</span>
          <span class="settings-badge ${config.mode === 'hermes-cli' ? 'enabled' : 'disabled'}">${config.mode}</span>
        </div>
      </div>
      <div class="settings-section">
        <h3>Model</h3>
        <div class="settings-row">
          <span class="settings-label">Name</span>
          <span class="settings-value">${config.model}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">Provider</span>
          <span class="settings-value">${config.provider}</span>
        </div>
      </div>
      ${config.tools && config.tools.length ? `
      <div class="settings-section">
        <h3>Tools (${config.tools.length})</h3>
        <div class="tools-grid">
          ${config.tools.map(t => `
            <div class="settings-row">
              <span class="settings-label">${t.icon} ${t.label}</span>
              <span class="settings-badge enabled">ON</span>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
    `;
  } catch (e) {
    body.innerHTML = '<div class="loading-state">Could not load status</div>';
  }
}

function closeStatus() {
  $('#statusModal').classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'statusModal') closeStatus();
});

// ─── PWA Install ──────────────────────────────────────────────────
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return;
  }
  // Fallback instructions
  const ua = navigator.userAgent;
  let msg = '';
  if (/android/i.test(ua) && /chrome/i.test(ua)) {
    msg = 'در Chrome: منو (سه نقطه) → Install app';
  } else if (/iphone|ipad/i.test(ua)) {
    msg = 'در Safari: دکمه Share → Add to Home Screen';
  } else {
    msg = 'از منوی مرورگر گزینه Install app را بزنید';
  }
  alert(msg);
}
