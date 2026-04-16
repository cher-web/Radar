const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const api = {
  get: (p) => fetch(p).then(r => r.json()),
  post: (p, b) => fetch(p, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(b||{}) }).then(r => r.json()),
  del: (p) => fetch(p, { method: 'DELETE' }).then(r => r.json()),
};

const el = (id) => document.getElementById(id);

let _allEvents = [];
const _accountFilter = new Set();
let _dateFilter = 'future';
const _onboarding = { apiKey: false, session: false, accounts: false };
const ONBOARDING_DISMISS_KEY = 'radar.onboarding.dismissed';

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

function matchesDateFilter(e) {
  const today = todayISO();
  const date = e.event_date;
  switch (_dateFilter) {
    case 'today': return date === today;
    case 'week': return date && date >= today && date <= addDaysISO(today, 6);
    case 'past': return date && date < today;
    case 'tbd': return !date;
    case 'future':
    default: return !date || date >= today;
  }
}

function toast(msg, kind = '') {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ` ${kind}` : '');
  t.hidden = false;
  setTimeout(() => { t.className = 'toast'; t.hidden = true; }, 2500);
}

function formatDateHead(iso) {
  if (!iso) return 'Date TBD';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

async function loadTagOptions() {
  // Select is already populated from HTML; this just syncs with the server
  // in case VALID_TAGS drifts. Failures here are non-fatal.
  try {
    const s = await api.get('/api/settings');
    if (!s.validTags) return;
    const sel = el('tag-select');
    const current = sel.value;
    sel.innerHTML = '';
    for (const t of s.validTags) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      sel.appendChild(opt);
    }
    sel.value = current && s.validTags.includes(current) ? current : 'venue';
  } catch (e) {
    console.warn('loadTagOptions failed, using HTML defaults:', e);
  }
}

async function refreshAccounts() {
  const { accounts } = await api.get('/api/accounts');
  const list = el('accounts-list');
  list.innerHTML = '';
  if (accounts.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No accounts yet — add one below.';
    list.appendChild(li);
    return;
  }
  for (const a of accounts) {
    const li = document.createElement('li');
    li.className = 'account-item' + (_accountFilter.has(a.username) ? ' selected' : '');
    li.title = `Click to filter by @${a.username}`;
    li.innerHTML = `
      <span><span class="handle">@${a.username}</span>${a.tag ? `<span class="tag">${a.tag}</span>` : ''}</span>
      <button class="remove" title="Remove @${a.username}">×</button>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.remove')) return;
      toggleAccountFilter(a.username);
    });
    li.querySelector('.remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove @${a.username}?`)) return;
      const r = await api.del(`/api/accounts/${encodeURIComponent(a.username)}`);
      if (r.error) return toast(r.error, 'error');
      _accountFilter.delete(a.username);
      toast(`Removed @${a.username}`);
      refreshAccounts();
      renderEvents();
      refreshOnboarding();
    });
    list.appendChild(li);
  }
}

function toggleAccountFilter(username) {
  if (_accountFilter.has(username)) _accountFilter.delete(username);
  else _accountFilter.add(username);
  refreshAccounts();
  renderEvents();
}

function clearAccountFilter() {
  if (_accountFilter.size === 0) return;
  _accountFilter.clear();
  refreshAccounts();
  renderEvents();
}

async function refreshEvents() {
  const { events } = await api.get('/api/events?upcoming=false');
  _allEvents = events || [];
  renderEvents();
}

function renderFilterBar() {
  const bar = el('filter-bar');
  const summary = el('filter-summary');
  if (_accountFilter.size === 0) {
    bar.hidden = true;
    return;
  }
  const handles = [..._accountFilter].map((u) => `@${u}`).join(', ');
  summary.textContent = `Filtered: ${handles}`;
  bar.hidden = false;
}

function renderEvents() {
  renderFilterBar();
  const root = el('events');
  const events = _allEvents
    .filter(matchesDateFilter)
    .filter((e) => _accountFilter.size === 0 || _accountFilter.has(e.account));
  if (events.length === 0) {
    const emptyMsg = {
      today: 'No events today.',
      week: 'No events in the next 7 days.',
      past: 'No past events.',
      tbd: 'No events with unknown dates.',
      future: 'No upcoming events yet. Hit “Scan now” to check.',
    }[_dateFilter];
    const msg = _accountFilter.size
      ? `No ${_dateFilter} events for the selected accounts.`
      : emptyMsg;
    root.innerHTML = `<p class="empty">${msg}</p>`;
    return;
  }
  const byDate = new Map();
  for (const e of events) {
    const key = e.event_date || '~undated';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(e);
  }
  const keys = [...byDate.keys()].sort();
  if (_dateFilter === 'past') keys.reverse();
  root.innerHTML = '';
  for (const k of keys) {
    const group = document.createElement('div');
    group.className = 'date-group';
    const head = document.createElement('div');
    head.className = 'date-head';
    head.textContent = k === '~undated' ? 'Date TBD' : formatDateHead(k);
    group.appendChild(head);
    for (const e of byDate.get(k)) {
      const row = document.createElement('div');
      row.className = 'event';
      const meta = [e.venue, e.event_time].filter(Boolean).join(' · ');
      const confClass = e.confidence || 'low';
      const sourceLink = e.source_type === 'post' && e.source_id_kind === 'shortcode'
        ? `https://www.instagram.com/p/${e.source_id}/`
        : `https://www.instagram.com/${e.account}/`;
      const thumb = e.screenshot_url
        ? `<a class="event-thumb" href="${escapeAttr(e.screenshot_url)}" target="_blank" rel="noopener"><img src="${escapeAttr(e.screenshot_url)}" alt="" loading="lazy"></a>`
        : '';
      row.innerHTML = `
        ${thumb}
        <div class="event-body">
          <div class="event-title">${escapeHtml(e.event_name || '(untitled)')}<span class="confidence ${confClass}">${e.confidence || '?'}</span></div>
          ${meta ? `<div class="event-meta">${escapeHtml(meta)}</div>` : ''}
          ${e.ticket_url ? `<div class="event-meta"><a href="${escapeAttr(e.ticket_url)}" target="_blank" rel="noopener">${escapeHtml(e.ticket_url)}</a></div>` : ''}
          <div class="event-via">via <a href="${sourceLink}" target="_blank" rel="noopener">@${escapeHtml(e.account)}</a> (${e.source_type})${e.found_at ? ` · <span class="found-at" title="${escapeAttr(e.found_at)}">found ${humanAgo(new Date(e.found_at))}</span>` : ''}</div>
        </div>
      `;
      group.appendChild(row);
    }
    root.appendChild(group);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

async function refreshSettings() {
  const s = await api.get('/api/settings');
  const anthropicInput = el('anthropic-key');
  const anthropicHint = el('anthropic-key-hint');
  const googleInput = el('google-key');
  const googleHint = el('google-key-hint');

  if (s.anthropic.present) {
    anthropicInput.placeholder = s.anthropic.masked;
    anthropicHint.textContent = `Saved. Model: ${s.anthropic.model}.`;
  } else {
    anthropicInput.placeholder = 'sk-ant-…';
    anthropicHint.textContent = 'Get one at console.anthropic.com.';
  }

  if (s.google.present) {
    googleInput.placeholder = s.google.masked;
    googleHint.textContent = `Saved. Model: ${s.google.model}.`;
  } else {
    googleInput.placeholder = 'AIza…';
    googleHint.textContent = 'Get one at aistudio.google.com/apikey.';
  }

  for (const btn of el('provider-toggle').querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.provider === s.provider);
  }
  el('anthropic-key-block').hidden = s.provider !== 'claude';
  el('google-key-block').hidden = s.provider !== 'gemini';
  const activeKeyPresent = s.provider === 'gemini' ? s.google.present : s.anthropic.present;
  el('provider-hint').textContent = activeKeyPresent
    ? `Active: ${s.provider}. Keys are saved to ./.env (gitignored).`
    : `Active: ${s.provider}. Paste the matching API key below.`;

  el('auth-status').textContent = s.auth.hasSession
    ? 'Session file present. (Exact validity is checked on next scan.)'
    : 'Not logged in. Click below to open Instagram in a browser window.';
}

async function refreshScanStatus() {
  const s = await api.get('/api/scan/status');
  const pill = el('scan-status');
  const btn = el('scan-btn');
  renderScanProgress(s);
  if (s.running) {
    const startedAt = s.startedAt ? new Date(s.startedAt) : null;
    const secs = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : 0;
    pill.className = 'scan-status running';
    const p = s.progress;
    const counter = p && p.total ? ` · ${p.current}/${p.total}` : '';
    pill.textContent = `scanning… ${secs}s${counter}`;
    btn.disabled = true;
    btn.textContent = 'Scanning…';
  } else {
    btn.disabled = false;
    btn.textContent = 'Scan now';
    if (s.error) {
      pill.className = 'scan-status error';
      pill.textContent = `error: ${s.error}`;
    } else if (s.completedAt) {
      const ago = humanAgo(new Date(s.completedAt));
      pill.className = 'scan-status';
      pill.textContent = `${s.eventsFound ?? 0} new · ${ago}`;
    } else {
      pill.className = 'scan-status';
      pill.textContent = '';
    }
  }
  return s.running;
}

function renderScanProgress(s) {
  const bar = el('scan-progress');
  if (!bar) return;
  if (!s.running || !s.progress || !s.progress.total) {
    bar.hidden = true;
    return;
  }
  const { total, current, phase, accountName } = s.progress;
  const pct = Math.min(100, Math.round((current / total) * 100));
  bar.hidden = false;
  bar.querySelector('.scan-progress-fill').style.width = pct + '%';
  const label = [phase, accountName ? `@${accountName}` : null].filter(Boolean).join(' · ');
  bar.querySelector('.scan-progress-label').textContent = `${current}/${total}${label ? ' · ' + label : ''}`;
}

async function refreshOnboarding() {
  try {
    const [s, a] = await Promise.all([api.get('/api/settings'), api.get('/api/accounts')]);
    const providerKeyPresent = s && ((s.provider === 'gemini' && s.google && s.google.present)
      || ((s.provider === 'claude' || !s.provider) && s.anthropic && s.anthropic.present));
    _onboarding.apiKey = !!providerKeyPresent;
    _onboarding.session = !!(s && s.auth && s.auth.hasSession);
    _onboarding.accounts = !!(a && Array.isArray(a.accounts) && a.accounts.length > 0);
  } catch {}
  renderOnboarding();
}

function renderOnboarding() {
  const bar = el('onboarding');
  if (!bar) return;
  const allDone = _onboarding.apiKey && _onboarding.session && _onboarding.accounts;
  const dismissed = localStorage.getItem(ONBOARDING_DISMISS_KEY) === '1';
  if (allDone || dismissed) {
    bar.hidden = true;
    document.body.classList.remove('has-onboarding');
    if (allDone) localStorage.setItem(ONBOARDING_DISMISS_KEY, '1');
  } else {
    bar.hidden = false;
    document.body.classList.add('has-onboarding');
  }
  const map = { key: 'apiKey', login: 'session', account: 'accounts' };
  for (const btn of bar.querySelectorAll('.onboarding-step')) {
    const done = _onboarding[map[btn.dataset.step]];
    btn.classList.toggle('done', done);
    btn.querySelector('.step-mark').textContent = done ? '✓' : '○';
  }
  el('scan-btn').classList.toggle('ready', allDone);
}

function humanAgo(d) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s/60)}m ago`;
  if (s < 86400) return `${Math.round(s/3600)}h ago`;
  return `${Math.round(s/86400)}d ago`;
}

let _statusPoll = null;
function startStatusPolling() {
  if (_statusPoll) return;
  const tick = async () => {
    const running = await refreshScanStatus();
    if (!running) {
      clearInterval(_statusPoll);
      _statusPoll = null;
      await refreshEvents();
    }
  };
  _statusPoll = setInterval(tick, 2000);
}

// --- Event wiring ---

el('add-account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const username = form.username.value.trim();
  const tag = form.tag.value;
  if (!username) return toast('Enter a handle', 'error');
  try {
    const r = await api.post('/api/accounts', { username, tag });
    if (r.error) return toast(r.error, 'error');
    toast(r.created ? `Added @${r.username}` : `Updated @${r.username}`);
    form.username.value = '';
    refreshAccounts();
    refreshOnboarding();
  } catch (err) {
    toast('Add failed: ' + err.message, 'error');
  }
});

el('scan-btn').addEventListener('click', async () => {
  const r = await api.post('/api/scan');
  if (r.error) return toast(r.error, 'error');
  toast('Scan started');
  await refreshScanStatus();
  startStatusPolling();
});

el('settings-btn').addEventListener('click', async () => {
  await refreshSettings();
  el('settings-modal').showModal();
});

el('save-anthropic-key').addEventListener('click', async () => {
  const key = el('anthropic-key').value.trim();
  if (!key) return toast('Enter a key first', 'error');
  const r = await api.post('/api/settings', { provider: 'anthropic', apiKey: key });
  if (r.error) return toast(r.error, 'error');
  el('anthropic-key').value = '';
  toast('Anthropic key saved');
  refreshSettings();
  refreshOnboarding();
});

el('save-google-key').addEventListener('click', async () => {
  const key = el('google-key').value.trim();
  if (!key) return toast('Enter a key first', 'error');
  const r = await api.post('/api/settings', { provider: 'google', apiKey: key });
  if (r.error) return toast(r.error, 'error');
  el('google-key').value = '';
  toast('Gemini key saved');
  refreshSettings();
  refreshOnboarding();
});

el('provider-toggle').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-provider]');
  if (!btn) return;
  const r = await api.post('/api/settings/provider', { provider: btn.dataset.provider });
  if (r.error) return toast(r.error, 'error');
  toast(`Using ${btn.dataset.provider}`);
  refreshSettings();
  refreshOnboarding();
});

el('login-btn').addEventListener('click', async () => {
  const hint = el('login-hint');
  hint.hidden = false;
  hint.textContent = 'A Chromium window will open. Complete login there; this may take up to 5 minutes.';
  el('login-btn').disabled = true;
  try {
    const r = await api.post('/api/auth/login');
    if (r.error) toast(r.error, 'error');
    else toast(`Logged in (${r.cookies} cookies)`);
  } catch (e) {
    toast('Login failed: ' + e.message, 'error');
  } finally {
    el('login-btn').disabled = false;
    hint.hidden = true;
    refreshSettings();
    refreshOnboarding();
  }
});

el('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  toast('Logged out');
  refreshSettings();
  refreshOnboarding();
});

el('clear-filter').addEventListener('click', clearAccountFilter);

window.dismissOnboarding = function (e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  console.log('[radar] dismissing onboarding');
  try { localStorage.setItem(ONBOARDING_DISMISS_KEY, '1'); } catch (err) { console.warn('localStorage blocked:', err); }
  const bar = document.getElementById('onboarding');
  if (bar) bar.hidden = true;
  document.body.classList.remove('has-onboarding');
};

el('onboarding').addEventListener('click', (e) => {
  const step = e.target.closest('.onboarding-step');
  if (!step) return;
  if (step.dataset.step === 'key') {
    el('settings-btn').click();
    setTimeout(async () => {
      try {
        const s = await api.get('/api/settings');
        const target = s.provider === 'gemini' ? 'google-key' : 'anthropic-key';
        el(target).focus();
      } catch { el('anthropic-key').focus(); }
    }, 50);
  } else if (step.dataset.step === 'login') {
    el('settings-btn').click();
    setTimeout(() => el('login-btn').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  } else if (step.dataset.step === 'account') {
    const modal = el('settings-modal');
    if (modal.open) modal.close();
    const input = document.querySelector('#add-account-form input[name="username"]');
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => input.focus(), 200);
  }
});

el('date-filters').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-range]');
  if (!btn) return;
  _dateFilter = btn.dataset.range;
  for (const b of el('date-filters').querySelectorAll('button')) {
    b.classList.toggle('active', b === btn);
  }
  renderEvents();
});

// --- Init ---

async function init() {
  // Each init step is independent — one failing shouldn't take down the others.
  const steps = [
    ['tags', loadTagOptions],
    ['accounts', refreshAccounts],
    ['events', refreshEvents],
    ['scan', refreshScanStatus],
    ['onboarding', refreshOnboarding],
  ];
  for (const [name, fn] of steps) {
    try { await fn(); }
    catch (e) {
      console.error(`init:${name} failed:`, e);
      toast(`${name} failed to load: ${e.message}`, 'error');
    }
  }
  try {
    const scanState = await api.get('/api/scan/status');
    if (scanState.running) startStatusPolling();
  } catch {}
}

init();
