/* =====================================================================
   VAGUS · Plattform-Schicht
   Ein Programmcode, drei Umgebungen:
   - Claude (claude.ai / Claude-App): COROS über den Claude-Konnektor, Speicher bei Claude
   - eigenständig (Browser, iPhone-App): eigener COROS-Login (OAuth), Speicher am Gerät
   - Geräteabgleich (alle): verschlüsselt über den eigenen Speicherdienst „Vagus Sync“
   ===================================================================== */
const IS_STANDALONE = !(typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function');
const SYNC_SERVER = 'Vagus Sync';
const LS_COROS = 'vagus.coros';
const LS_PEND = 'vagus.coros.pending';
const LS_SYNC = 'vagus.sync';
const LS_ROUTE = 'vagus.coros.route';   // 'direct' | 'relay' – gemerkter Weg zu COROS
const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/dheinz94/vagus/tree/main/worker';
// Nur für automatische Tests (lokale Server statt echter Dienste); im Betrieb leer
const TEST = (typeof window !== 'undefined' && window.__VAGUS_TEST) || null;
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* Speicher gesperrt */ } };

/* ---------- Kleine Krypto-Helfer ---------- */
const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = buf => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randB64url = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(str) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))); }
const Crypt = {
  async derive(pass, saltB64) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: 600000 }, base, 256);
    return b64(bits);
  },
  async key(rawB64) { return crypto.subtle.importKey('raw', unb64(rawB64), 'AES-GCM', false, ['encrypt', 'decrypt']); },
  async seal(obj, rawB64, saltB64) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.key(rawB64), new TextEncoder().encode(JSON.stringify(obj)));
    return { v: 1, salt: saltB64, iv: b64(iv), ct: b64(ct) };
  },
  async open(blob, rawB64) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, await this.key(rawB64), unb64(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
};

/* ---------- MCP-Antworten (JSON oder Server-Sent Events) ---------- */
async function readRpc(res) {
  const raw = await res.text();
  if (!raw) return {};
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream') || /^\s*(event|data):/m.test(raw) && !/^\s*[{[]/.test(raw)) {
    const events = []; let cur = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line) { if (cur.length) { events.push(cur.join('\n')); cur = []; } continue; }
      if (line.startsWith('data:')) cur.push(line.slice(5).replace(/^ /, ''));
    }
    if (cur.length) events.push(cur.join('\n'));
    for (let i = events.length - 1; i >= 0; i--) { try { const j = JSON.parse(events[i]); if (j && (j.result || j.error)) return j; } catch (e) { } }
    return events.length ? JSON.parse(events[events.length - 1]) : {};
  }
  return JSON.parse(raw);
}
function rpcResultToCall(result) {
  const content = Array.isArray(result && result.content) ? result.content : [];
  const txt = content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  let payload = result && result.structuredContent;
  if (payload == null && txt) { try { payload = JSON.parse(txt); } catch (e) { payload = txt; } }
  return { content, structuredContent: result && result.structuredContent, payload };
}

/* ---------- Eigener COROS-Zugang (offizieller MCP mit OAuth 2.0 + PKCE) ---------- */
const Coros = {
  GATEWAY: (TEST && TEST.gateway) || 'https://mcp.coros.com',
  SCOPES: 'openid offline_access mcp.tools',
  viaRelay: (lsGet(LS_ROUTE) || {}).r === 'relay', routeKnown: false, session: null, initDone: false,
  st() { return lsGet(LS_COROS); },
  loggedIn() { const s = this.st(); return !!(s && s.refresh); },
  region() { const s = this.st(); const i = s && s.issuer || ''; return /mcpeu/.test(i) ? 'EU' : /mcpus/.test(i) ? 'USA' : /mcpcn/.test(i) ? 'China' : i ? 'automatisch' : ''; },
  redirectUri() { return location.origin + location.pathname; },
  logout() { lsSet(LS_COROS, null); lsSet(LS_PEND, null); lsSet(LS_ROUTE, null); this.initDone = false; this.session = null; this.viaRelay = false; this.routeKnown = false; },
  /** Weg zu COROS einmal mit einer harmlosen GET-Abfrage prüfen: direkt oder über den Speicherdienst */
  async route() {
    if (this.routeKnown) return;
    try { const r = await fetch(this.GATEWAY + '/.well-known/openid-configuration', { method: 'GET' }); this.viaRelay = false; this.routeKnown = true; lsSet(LS_ROUTE, { r: 'direct' }); return r; }
    catch (e) {
      if (!Sync.relayReady()) throw { code: 'network_blocked', message: String(e && e.message || e) };
      this.viaRelay = true; this.routeKnown = true; lsSet(LS_ROUTE, { r: 'relay' });
    }
  },
  /** Netzwerk über den geprüften Weg. Nur wiederholbare Abfragen dürfen bei Fehler den anderen Weg nehmen –
      Anmelde-Codes und Tokens werden nie doppelt gesendet. */
  async net(url, init, once) {
    await this.route();
    if (this.viaRelay) return Sync.relay(url, init);
    try { return await fetch(url, init); }
    catch (e) {
      if (once && Sync.relayReady()) { this.viaRelay = true; lsSet(LS_ROUTE, { r: 'relay' }); } // nächster Versuch über den Speicherdienst, dieser nicht doppelt
      if (once || !Sync.relayReady()) throw { code: once ? 'server_unavailable' : 'network_blocked', retryable: !!once, message: String(e && e.message || e) };
      this.viaRelay = true; lsSet(LS_ROUTE, { r: 'relay' });
      return Sync.relay(url, init);
    }
  },
  async discover() {
    try {
      const r = await this.net(this.GATEWAY + '/.well-known/openid-configuration', { method: 'GET' });
      if (r.ok) { const j = await r.json(); if (j && (/^https:\/\/mcp(eu|us|cn)?\.coros\.com$/.test(String(j.issuer || '').replace(/\/$/, '')) || (TEST && j.issuer))) return String(j.issuer).replace(/\/$/, ''); }
    } catch (e) { if (e && e.code === 'network_blocked') throw e; }
    return this.GATEWAY;
  },
  async login() {
    const issuer = await this.discover();
    const redirect = this.redirectUri();
    const reg = await this.net(issuer + '/connect/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Vagus', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: this.SCOPES, token_endpoint_auth_method: 'none' }) });
    const rj = await reg.json().catch(() => ({}));
    if (!reg.ok || !rj.client_id) throw { code: 'oauth_failed', message: 'Registrierung bei COROS abgelehnt (' + reg.status + ')' };
    const verifier = randB64url(48);
    const challenge = b64url(await sha256(verifier));
    const state = randB64url(18);
    lsSet(LS_PEND, { issuer, clientId: rj.client_id, verifier, state, redirect, at: Date.now() });
    const q = new URLSearchParams({ response_type: 'code', client_id: rj.client_id, redirect_uri: redirect, scope: this.SCOPES, code_challenge: challenge, code_challenge_method: 'S256', resource: issuer + '/mcp', state });
    location.href = issuer + '/oauth2/authorize?' + q.toString();
  },
  /** Rückkehr von der COROS-Anmeldung (?code=…&state=…) */
  async finish(params) {
    const p = lsGet(LS_PEND);
    if (!p) throw { code: 'oauth_failed', message: 'Die Anmeldung wurde in einem anderen Fenster gestartet. Starte sie bitte direkt in der Vagus-App neu.' };
    if (Date.now() - (p.at || 0) > 30 * 60000) { lsSet(LS_PEND, null); throw { code: 'oauth_failed', message: 'Die Anmeldung hat zu lange gedauert. Bitte erneut anmelden.' }; }
    if (params.get('state') !== p.state) throw { code: 'oauth_failed', message: 'Sicherheitsprüfung fehlgeschlagen. Bitte erneut anmelden.' };
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: p.clientId, code: params.get('code'), redirect_uri: p.redirect, code_verifier: p.verifier });
    lsSet(LS_PEND, null); // Code ist nur einmal gültig
    const r = await this.net(p.issuer + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, true);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw { code: 'oauth_failed', message: 'Token-Austausch fehlgeschlagen (' + r.status + ')' };
    lsSet(LS_COROS, { issuer: p.issuer, clientId: p.clientId, redirect: p.redirect, access: j.access_token, refresh: j.refresh_token || null, type: j.token_type || 'Bearer', exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
    lsSet(LS_PEND, null);
  },
  async token(force) {
    const s = this.st(); if (!s) throw { code: 'coros_login' };
    if (!force && s.exp - 60000 > Date.now()) return s;
    if (!s.refresh) { this.logout(); throw { code: 'needs_reauth' }; }
    const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: s.clientId, refresh_token: s.refresh });
    const r = await this.net(s.issuer + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, true);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { if (r.status >= 400 && r.status < 500) { this.logout(); throw { code: 'needs_reauth' }; } throw { code: 'server_unavailable', retryable: true }; }
    const n = Object.assign({}, s, { access: j.access_token, refresh: j.refresh_token || s.refresh, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
    lsSet(LS_COROS, n); return n;
  },
  async rpc(method, params, retried) {
    const s = await this.token();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: (s.type || 'Bearer') + ' ' + s.access, 'MCP-Protocol-Version': '2025-06-18' };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    const r = await this.net(s.issuer + '/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 1e9, method, params: params || {} }) });
    const sid = r.headers.get('mcp-session-id'); if (sid) this.session = sid;
    if (r.status === 401 && !retried) { await this.token(true); return this.rpc(method, params, true); }
    if (r.status === 404 && this.session && !retried) { this.session = null; this.initDone = false; await this.init(); return this.rpc(method, params, true); }
    if (!r.ok) throw { code: r.status >= 500 ? 'server_unavailable' : 'upstream_error', retryable: r.status >= 500, message: 'COROS antwortete mit ' + r.status };
    const j = await readRpc(r);
    if (j.error) throw { code: 'tool_error', message: j.error.message || 'Fehler', result: j };
    return j.result;
  },
  async init() {
    if (this.initDone) return;
    try { await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Vagus', version: '3.0' } }); }
    catch (e) { if (['coros_login', 'needs_reauth', 'network_blocked'].includes(e && e.code)) throw e; return; } // nächster Aufruf versucht es erneut
    this.initDone = true;
    try { await this.notify('notifications/initialized'); } catch (e) { }
  },
  async notify(method) {
    const s = await this.token();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: (s.type || 'Bearer') + ' ' + s.access, 'MCP-Protocol-Version': '2025-06-18' };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    await this.net(s.issuer + '/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method }) });
  },
  async callTool(tool, args) {
    await this.init();
    const result = await this.rpc('tools/call', { name: tool, arguments: args || {} });
    const out = rpcResultToCall(result);
    if (result && result.isError) throw { code: 'tool_error', message: (out.content[0] && out.content[0].text) || 'Fehler', result: out };
    return out;
  }
};

/* ---------- Verschlüsselter Geräteabgleich ---------- */
const Sync = {
  cfg: null,       // {mode:'http'|'mcp', base, key, salt, raw}
  state: { s: 'off', at: 0, msg: '' },
  busy: false, timer: null,
  load() { this.cfg = lsGet(LS_SYNC); return this.cfg; },
  save(c) { this.cfg = c; lsSet(LS_SYNC, c); },
  ready() { return !!(this.cfg && this.cfg.raw && (this.cfg.mode === 'mcp' || (this.cfg.base && this.cfg.key))); },
  relayReady() { return IS_STANDALONE && !!(this.cfg && this.cfg.base && this.cfg.key); },
  setupCode() { return this.cfg && this.cfg.base && this.cfg.key ? 'vagus1:' + this.cfg.base + '#' + this.cfg.key : ''; },
  connectorUrl() { return this.cfg && this.cfg.base && this.cfg.key ? this.cfg.base + '/mcp/' + this.cfg.key : ''; },
  parseTarget(input) {
    const s = String(input || '').trim();
    let m = s.match(/^vagus1:(https?:\/\/[^#\s]+)#([A-Za-z0-9_-]{20,})$/);
    if (m && (m[1].startsWith('https://') || (TEST && /^http:\/\/localhost:\d+/.test(m[1])))) return { base: m[1].replace(/\/+$/, ''), key: m[2] };
    m = s.match(/^(https:\/\/[^\s/]+)\/mcp\/([A-Za-z0-9_-]{20,})\/?$/);
    if (m) return { base: m[1], key: m[2] };
    if (TEST) { const t = s.match(/^(http:\/\/localhost:\d+)(?:\/mcp\/([A-Za-z0-9_-]{20,}))?\/?$/); if (t) return { base: t[1], key: t[2] || null }; }
    m = s.match(/^(https:\/\/[^\s/?#]+)\/?$/);
    if (m) return { base: m[1], key: null };
    return null;
  },
  /* --- Transport --- */
  async http(path, init) {
    const r = await fetch(this.cfg.base + '/v1/' + this.cfg.key + path, init);
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  },
  async get() {
    if (this.cfg.mode === 'mcp') { const r = await app.caps.mcp.callTool(SYNC_SERVER, 'vagus_sync_get', {}, { cache: false }); return asObj(r); }
    const r = await this.http('/blob', { method: 'GET' }); if (r.status !== 200) throw { code: 'sync_http', status: r.status }; return r.j;
  },
  async put(rev, blob) {
    if (this.cfg.mode === 'mcp') { const r = await app.caps.mcp.callTool(SYNC_SERVER, 'vagus_sync_put', { rev, blob }, { cache: false }); return asObj(r); }
    const r = await this.http('/blob', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev, blob }) });
    if (r.status === 409) return { ok: false, conflict: true, rev: r.j.rev };
    if (r.status !== 200) throw { code: 'sync_http', status: r.status }; return r.j;
  },
  async relay(url, init) {
    const h = {}; const src = init && init.headers || {};
    for (const k in src) h[k] = src[k];
    const r = await fetch(this.cfg.base + '/v1/' + this.cfg.key + '/relay?u=' + encodeURIComponent(url), { method: (init && init.method) || 'GET', headers: h, body: init && init.body });
    return r;
  },
  /* --- Einrichtung --- */
  async setupStandalone(target, pass) {
    if (!pass || pass.length < 8) throw { msg: 'Das Passwort braucht mindestens 8 Zeichen.' }; // vor dem Beanspruchen prüfen
    const t = this.parseTarget(target);
    if (!t) throw { msg: 'Das ist keine gültige Adresse. Sie beginnt mit https:// (z. B. https://vagus-sync.deinname.workers.dev) oder mit vagus1:.' };
    let key = t.key;
    if (!key) {
      // Schon beanspruchten Schlüssel für diese Adresse wiederverwenden (z. B. nach einem Netzfehler)
      const prev = lsGet(LS_SYNC);
      key = prev && prev.base === t.base && prev.key ? prev.key : randB64url(24);
      const r = await fetch(t.base + '/v1/' + key + '/claim', { method: 'POST' }).catch(() => null);
      if (!r) throw { msg: 'Der Speicherdienst ist nicht erreichbar. Stimmt die Adresse?' };
      if (r.status === 403) throw { msg: 'Dieser Speicherdienst ist schon eingerichtet. Nimm den Einrichtungscode von deinem ersten Gerät (Mehr → Geräteabgleich).' };
      if (r.status !== 200) throw { msg: 'Der Speicherdienst antwortet nicht wie erwartet (' + r.status + ').' };
    }
    this.save({ mode: 'http', base: t.base, key }); // sofort merken, damit der Schlüssel nie verloren geht
    await this.unlock(pass);
  },
  async setupClaude(pass) {
    if (!pass || pass.length < 8) throw { msg: 'Das Passwort braucht mindestens 8 Zeichen.' };
    this.cfg = { mode: 'mcp' };
    await this.unlock(pass);
  },
  /** Neu beginnen (Passwort vergessen): neuer Schlüssel, Daten dieses Geräts ersetzen den alten Datensatz */
  async reset(pass) {
    if (!pass || pass.length < 8) throw { msg: 'Das Passwort braucht mindestens 8 Zeichen.' };
    if (!this.cfg) throw { msg: 'Der Abgleich ist auf diesem Gerät nicht eingerichtet.' };
    const remote = await this.get();
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const raw = await Crypt.derive(pass, salt);
    const res = await this.put((remote && remote.rev) || 0, await Crypt.seal(buildSyncData(), raw, salt));
    if (!(res && res.ok)) throw { msg: 'Gerade hat ein anderes Gerät abgeglichen. Bitte noch einmal versuchen.' };
    this.cfg.raw = raw; this.cfg.salt = salt; this.save(this.cfg);
    this.state = { s: 'ok', at: Date.now(), msg: '' };
    if (typeof onSyncConfigured === 'function') await onSyncConfigured(this.cfg);
  },
  needsPassword() { return !!(this.cfg && !this.cfg.raw && (this.cfg.mode === 'mcp' || (this.cfg.base && this.cfg.key))); },
  /** Passwort prüfen/festlegen: vorhandenen Datensatz entschlüsseln oder neuen anlegen */
  async unlock(pass) {
    if (!pass || pass.length < 8) throw { msg: 'Das Passwort braucht mindestens 8 Zeichen.' };
    const remote = await this.get();
    let salt;
    if (remote && remote.blob) {
      salt = remote.blob.salt;
      const raw = await Crypt.derive(pass, salt);
      try { await Crypt.open(remote.blob, raw); } catch (e) { throw { msg: 'Das Passwort passt nicht zu den gespeicherten Daten.', wrongPass: true }; }
      this.cfg.raw = raw; this.cfg.salt = salt;
    } else {
      salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      this.cfg.raw = await Crypt.derive(pass, salt); this.cfg.salt = salt;
    }
    this.save(this.cfg);
    if (typeof onSyncConfigured === 'function') await onSyncConfigured(this.cfg);
  },
  forget() { this.save(null); this.state = { s: 'off', at: 0, msg: '' }; if (IS_STANDALONE) { Coros.viaRelay = false; Coros.routeKnown = false; lsSet(LS_ROUTE, null); } },
  /* --- Abgleich --- */
  soon(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms || 2000); },
  async run() {
    if (!this.ready() || this.busy) return false;
    this.busy = true; let changed = false;
    try {
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        const remote = await this.get();
        let rdata = null;
        if (remote && remote.blob) {
          try { rdata = await Crypt.open(remote.blob, this.cfg.raw); }
          catch (e) { this.state = { s: 'error', at: Date.now(), msg: 'Das Passwort wurde auf einem anderen Gerät geändert. Bitte gib das neue Passwort ein.' }; this.cfg.raw = null; this.save(this.cfg); return false; }
          if (mergeSyncData(rdata)) changed = true;
        }
        const mine = buildSyncData();
        if (rdata && sameSyncData(rdata, mine)) { done = true; break; }
        const blob = await Crypt.seal(mine, this.cfg.raw, this.cfg.salt || (remote && remote.blob && remote.blob.salt));
        const res = await this.put(remote ? remote.rev || 0 : 0, blob);
        if (res && res.ok) { done = true; break; }
        if (!(res && res.conflict)) throw { code: 'sync_put' };
      }
      this.state = done ? { s: 'ok', at: Date.now(), msg: '' } : { s: 'error', at: Date.now(), msg: 'Andere Geräte gleichen gerade ab. Vagus versucht es gleich wieder.' };
      if (!done) this.soon(8000);
    } catch (e) {
      const code = e && e.code;
      this.state = { s: 'error', at: Date.now(), msg: code === 'server_not_connected' ? 'Der Konnektor „Vagus Sync“ ist in Claude noch nicht hinzugefügt.' : code === 'not_in_manifest' || code === 'approval_required' ? 'Vagus braucht deine Freigabe für „Vagus Sync“.' : 'Der Speicherdienst ist gerade nicht erreichbar.' };
    } finally { this.busy = false; }
    if (changed && typeof onSyncMerged === 'function') onSyncMerged();
    return changed;
  }
};
function asObj(r) { const p = r && (r.payload != null ? r.payload : r.structuredContent); if (p && typeof p === 'object') return p; try { return JSON.parse(p); } catch (e) { return {}; } }

/* ---------- Was abgeglichen wird: Tagebuch + eigene Profilangaben ---------- */
const SYNC_PROFILE = ['birthday', 'sex', 'heightCm', 'weightKg', 'hrMax', 'leanPct', 'sleepBaseMin', 'wakeTime', 'strengthCodes'];
function buildSyncData() {
  const R = app.real; const P = R.profile || {}; const man = P._manual || {}; const ts = P._ts || {};
  const profile = {};
  for (const k of SYNC_PROFILE) if (man[k]) profile[k] = { v: P[k] === undefined ? null : P[k], at: ts[k] || 1 };
  const journal = {};
  for (const [d, e] of Object.entries(R.journal || {})) if (e) journal[d] = { items: e.items || {}, note: e.note || '', _at: e._at || 1 };
  return { v: 1, journal, profile };
}
function sameSyncData(a, b) { const n = o => JSON.stringify({ j: Object.keys(o.journal || {}).sort().map(k => [k, o.journal[k]._at, o.journal[k].items, o.journal[k].note]), p: Object.keys(o.profile || {}).sort().map(k => [k, o.profile[k].at, o.profile[k].v]) }); return n(a) === n(b); }
function mergeSyncData(rem) {
  if (!rem) return false;
  const R = app.real; let changed = false;
  for (const [d, e] of Object.entries(rem.journal || {})) {
    const l = R.journal[d];
    if (!l || (e._at || 0) > (l._at || 0) || ((e._at || 0) === (l._at || 0) && JSON.stringify([e.items, e.note]) > JSON.stringify([l.items, l.note]))) { R.journal[d] = { items: Object.assign({}, e.items), note: e.note || '', _at: e._at || 1 }; store.markJournal(d); changed = true; }
  }
  const P = R.profile || (R.profile = {}); P._manual = Object.assign({}, P._manual); P._ts = Object.assign({}, P._ts);
  for (const [k, o] of Object.entries(rem.profile || {})) {
    if (!SYNC_PROFILE.includes(k) || !o) continue;
    if ((o.at || 0) > (P._ts[k] || 0)) { if (o.v == null) delete P[k]; else P[k] = o.v; P._manual[k] = true; P._ts[k] = o.at; changed = true; }
  }
  if (changed) store.mark('profile');
  return changed;
}

/* ---------- Fähigkeiten für die eigenständige Version ---------- */
function standaloneCaps() {
  return {
    mcp: {
      async callTool(server, tool, input) {
        if (server !== 'COROS') throw { code: 'server_not_connected' };
        if (!Coros.loggedIn()) throw { code: 'coros_login' };
        return Coros.callTool(tool, input);
      }
    },
    db: null, user: null, sample: null,
    perms: { state: async () => Coros.loggedIn() ? 'granted' : 'prompt', manage: async () => { } },
    downloads: {
      async save({ filename, data }) {
        const blob = new Blob([data], { type: 'application/json' });
        try {
          const file = new File([blob], filename, { type: 'application/json' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return { status: 'saved' }; }
        } catch (e) { if (e && e.name === 'AbortError') throw { code: 'declined' }; }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return { status: 'saved' };
      }
    }
  };
}

/* ---------- KI-Fragen außerhalb von Claude: Claude-App öffnen ---------- */
function askInClaude(prompt) {
  // Wichtig: ohne await vor dem Öffnen – Safari erlaubt das Öffnen nur direkt im Tipp
  let copied = false;
  try { navigator.clipboard.writeText(prompt).then(() => { }, () => { }); copied = true; } catch (e) { }
  const MAX = 6000;
  const q = prompt.length <= MAX ? prompt : 'Ich habe gerade meine Vagus-Werte (COROS-Daten) in die Zwischenablage kopiert und füge sie hier ein. Bitte warte auf den Text und beantworte dann meine Frage am Ende.';
  const a = document.createElement('a'); a.href = 'https://claude.ai/new?q=' + encodeURIComponent(q); a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  return { copied, long: prompt.length > MAX };
}

if (typeof module !== 'undefined') module.exports = { Crypt, readRpc, rpcResultToCall, b64, unb64, b64url };
