/* =====================================================================
   VAGUS · Oberfläche, COROS-Anbindung, Speicher
   ===================================================================== */
const SERVER = 'COROS';
const CONNECT_URL = 'https://claude.ai/directory/coros';
const LS_KEY = 'vagus.v1';
const LS_UI = 'vagus.ui';
const SCHEMA = 2; // v2: COROS-Antworten werden ausgepackt; ältere, falsch gelesene Daten werden einmalig verworfen
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));

function emptyState() { return { profile: {}, days: {}, acts: {}, journal: {}, fitness: null, fitnessHist: [], load: null, corosRecovery: null, stressTs: null, schedule: null, meta: { schema: SCHEMA } }; }

const app = {
  mode: IS_STANDALONE ? 'standalone' : 'claude',
  real: emptyState(), demo: null, demoPref: 'auto',
  S: null, A: null, H: null, ins: null,
  view: 'heute', sub: null, date: todayStr(),
  caps: {}, uid: null, storeMode: 'local', storeErr: null, capsReady: false,
  conn: { state: 'idle', msg: '' }, syncing: false, progress: null, perm: 'unknown',
  toolStatus: {}, raw: {}, schemas: {}, sleepTool: 'querySleepOverview',
  chat: [], chatBusy: false, chatCtl: null,
  trend: { metric: 'recovery', range: 30 },
  journalDate: null, confirmDelete: false, reportAi: null, reportBusy: false,
  skin: 'auto', charts: []
};

/* ---------- Formatierung ---------- */
const NFc = {};
const NF = d => NFc[d] || (NFc[d] = new Intl.NumberFormat('de-AT', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmt = (v, d = 0) => isNum(v) ? NF(d).format(v) : '–';
function fmtDur(min) { if (!isNum(min)) return '–'; let h = Math.floor(min / 60), m = Math.round(min - h * 60); if (m === 60) { h++; m = 0; } return h ? `${h} h ${pad2(m)} min` : `${m} min`; }
function fmtHM(min) { if (!isNum(min)) return '–'; let h = Math.floor(min / 60), m = Math.round(min - h * 60); if (m === 60) { h++; m = 0; } return `${h}:${pad2(m)}`; }
function clockFromNoon(m) { if (!isNum(m)) return '–'; const t = ((Math.round(m) + 720) % 1440 + 1440) % 1440; return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60); }
const DF = {
  short: new Intl.DateTimeFormat('de-AT', { weekday: 'short', day: 'numeric', month: 'short' }),
  dm: new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'numeric' }),
  wd: new Intl.DateTimeFormat('de-AT', { weekday: 'short' }),
  long: new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })
};
const fDay = d => DF.short.format(dateOf(d));
const fDM = d => DF.dm.format(dateOf(d));
function relDay(d) { const t = todayStr(); if (d === t) return 'Heute'; if (d === addDays(t, -1)) return 'Gestern'; return fDay(d); }
function ago(ts) { if (!ts) return 'nie'; const m = Math.round((Date.now() - ts) / 60000); if (m < 1) return 'gerade eben'; if (m < 60) return `vor ${m} Min.`; const h = Math.round(m / 60); if (h < 24) return `vor ${h} Std.`; return `vor ${Math.round(h / 24)} Tg.`; }
const EN_DE = { good: 'Gut', 'very good': 'Sehr gut', excellent: 'Ausgezeichnet', normal: 'Normal', fair: 'Mittel', poor: 'Schwach', low: 'Niedrig', high: 'Hoch', 'very high': 'Sehr hoch', optimal: 'Optimal', recovered: 'Erholt', 'fully recovered': 'Voll erholt', moderate: 'Mäßig', balanced: 'Ausgewogen', productive: 'Produktiv', maintaining: 'Erhaltend', detraining: 'Rückgang', overreaching: 'Überlastung', fatigued: 'Ermüdet', fresh: 'Frisch', unbalanced: 'Unausgewogen', 'below normal': 'Unter Normal', 'above normal': 'Über Normal',
  performance: 'Leistungsbereit', maintaining: 'Erhaltend', optimized: 'Optimal', excessive: 'Zu hoch', recovery: 'Erholung', 'heavy training allowed': 'Intensives Training möglich', 'moderate training allowed': 'Mittleres Training möglich', 'light training allowed': 'Leichtes Training möglich', 'rest recommended': 'Ruhe empfohlen',
  base: 'Grundlage', endurance: 'Ausdauer', aerobic: 'Aerob', anaerobic: 'Anaerob', threshold: 'Schwelle', 'vo2 max': 'VO₂max', vo2max: 'VO₂max', sprint: 'Sprint', easy: 'Leicht', hard: 'Hart', 'very easy': 'Sehr leicht', 'very hard': 'Sehr hart', relaxed: 'Entspannt' };
const tr = v => {
  if (v == null) return ''; const s = String(v).trim(); const k = s.toLowerCase();
  if (EN_DE[k]) return EN_DE[k];
  const head = k.split(/\s*[–—:,.;(]\s*|\s+-\s+/)[0];
  if (EN_DE[head]) return EN_DE[head];
  return /^[\x00-\x7F]+$/.test(s) && /[a-z]{3,}\s+[a-z]{3,}/i.test(s) ? '' : s; // unübersetzte englische Sätze ausblenden
};
const fmtStage = m => !isNum(m) ? '–' : m < 60 ? fmt(m) + ' min' : fmtHM(m) + ' h';
const yrs = y => Math.abs(y) < 0.05 ? '±0,0 J.' : (y < 0 ? '−' : '+') + fmt(Math.abs(y), 1) + ' J.';
const zoneColor = z => z === 'green' ? 'var(--good)' : z === 'yellow' ? 'var(--warn)' : z === 'red' ? 'var(--bad)' : 'var(--ink-3)';
const zoneName = z => z === 'green' ? 'Grün' : z === 'yellow' ? 'Gelb' : z === 'red' ? 'Rot' : '–';
const zonePill = z => z === 'green' ? 'good' : z === 'yellow' ? 'warn' : z === 'red' ? 'bad' : '';

/* ---------- Symbole ---------- */
const IC = {
  heute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M5 12h3l2-4 3 8 2-4h4"/></svg>',
  schlaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  training: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 13h6l-1 8 8-10h-6z"/></svg>',
  bioalter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/></svg>',
  mehr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
  run: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="4.5" r="1.8"/><path d="m8 21 3-6 3 2v5M6 12l3-3 4 1 2 3 3 1M10 15l-2-3"/></svg>',
  strength: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/></svg>',
  bike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="m6 16 4-7h5l3 7M10 9l2 7h-6M14 5h2"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4.5" r="1.8"/><path d="m10 21 2-6 3 3v3M9 12l2-4 3 1 1 4M11 8 8 10v3"/></svg>',
  swim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2.5-1.5 4.5-1.5S19 17 21 17M8 13l3-5 4 2"/><circle cx="17" cy="7" r="1.8"/></svg>',
  other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>'
};
function actIcon(a) {
  if (a.strength) return IC.strength;
  if ([200, 201, 202, 203, 204].includes(a.sport) || /rad|bike|cycl/i.test(a.name || '')) return IC.bike;
  if ([300, 301].includes(a.sport) || /schwimm|swim/i.test(a.name || '')) return IC.swim;
  if ([104, 105, 900].includes(a.sport) || /wander|geh|walk|hike/i.test(a.name || '')) return IC.walk;
  if ([100, 101, 102, 103].includes(a.sport) || /lauf|run/i.test(a.name || '')) return IC.run;
  return IC.other;
}

/* ---------- Speicher ---------- */
const clone = o => { try { return structuredClone(o); } catch (e) { return JSON.parse(JSON.stringify(o)); } };
const store = {
  dirty: new Set(), db: null, timer: null, loaded: false,
  async init() {
    const db = app.caps.db, user = app.caps.user;
    if (db && user) { try { app.uid = await user.id(); } catch (e) { app.uid = null; } }
    if (db && app.uid) { this.db = db; app.storeMode = 'db'; } else app.storeMode = 'local';
  },
  col() { return this.db.collection('data/users/' + app.uid); },
  loadLocal() { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(app.real)); } catch (e) { /* Speicher nicht verfügbar */ } },
  async load() {
    if (app.storeMode !== 'db') { this.loaded = true; return; }
    try {
      const snap = await this.col().get();
      this.loaded = true; app.storeErr = null;
      if (snap.empty) { if (Object.keys(app.real.days).length || Object.keys(app.real.journal).length) { this.markAll(); await this.flush(); } return; }
      const st = emptyState(); const legacyJ = [], jDocs = new Set();
      for (const doc of snap.docs) {
        const b = clone(doc.data() || {}); // gelieferte Dokumente sind eingefroren → Kopie bearbeiten
        if (doc.id === 'profile') st.profile = b.profile || {};
        else if (doc.id === 'meta') { for (const k of ['fitness', 'fitnessHist', 'load', 'corosRecovery', 'stressTs', 'schedule', 'meta']) if (b[k] != null) st[k] = b[k]; }
        else if (doc.id.startsWith('m-')) { Object.assign(st.days, b.days || {}); Object.assign(st.acts, b.acts || {}); for (const [d, e] of Object.entries(b.journal || {})) { legacyJ.push([d, e]); } }
        else if (doc.id.startsWith('j-') && b.entry) { st.journal[doc.id.slice(2)] = b.entry; jDocs.add(doc.id.slice(2)); }
      }
      // ältere Tagebucheinträge aus Monatsdokumenten in eigene Tagesdokumente übernehmen
      for (const [d, e] of legacyJ) if (!jDocs.has(d)) { if (!st.journal[d]) st.journal[d] = e; this.markJournal(d); }
      if (!st.meta) st.meta = {};
      app.real = st; this.saveLocal();
    } catch (e) { this.loaded = false; app.storeErr = (e && e.code) || 'unavailable'; }
  },
  markDay(d) { if (d) this.dirty.add('m-' + d.slice(0, 7)); },
  markJournal(d) { if (d) this.dirty.add('j-' + d); },
  mark(name) { this.dirty.add(name); },
  markAll() {
    this.mark('profile'); this.mark('meta');
    for (const d of [...Object.keys(app.real.days), ...Object.values(app.real.acts).map(a => a.date)]) this.markDay(d);
    for (const d of Object.keys(app.real.journal)) this.markJournal(d);
  },
  bodyFor(name) {
    const R = app.real;
    if (name === 'profile') return { profile: R.profile };
    if (name === 'meta') return { fitness: R.fitness, fitnessHist: (R.fitnessHist || []).slice(-200), load: R.load, corosRecovery: R.corosRecovery, stressTs: R.stressTs, schedule: R.schedule, meta: R.meta };
    if (name.startsWith('j-')) return { entry: R.journal[name.slice(2)] || null };
    const ym = name.slice(2);
    return { days: Object.fromEntries(Object.entries(R.days).filter(([k]) => k.startsWith(ym))), acts: Object.fromEntries(Object.entries(R.acts).filter(([k, a]) => String(a.date || '').startsWith(ym))) };
  },
  /** Vor dem Schreiben mit dem Stand anderer Geräte zusammenführen (neuerer Eintrag gewinnt) */
  mergeRemote(name, b) {
    const R = app.real; const newer = (r, l) => !l || ((r && r._at) || 0) > ((l && l._at) || 0);
    if (name.startsWith('m-')) {
      for (const [d, rd] of Object.entries(b.days || {})) if (newer(rd, R.days[d])) R.days[d] = rd;
      for (const [id, ra] of Object.entries(b.acts || {})) if (newer(ra, R.acts[id])) R.acts[id] = ra;
      for (const [d, e] of Object.entries(b.journal || {})) { if (!R.journal[d]) R.journal[d] = e; this.markJournal(d); }
      return true;
    }
    if (name.startsWith('j-')) { const d = name.slice(2); if (b.entry && newer(b.entry, R.journal[d])) { R.journal[d] = b.entry; return false; } }
    return true;
  },
  async flush() {
    this.saveLocal();
    if (app.storeMode !== 'db') { this.dirty.clear(); return; }
    if (!this.loaded) { await this.load(); if (!this.loaded) return; } // nie ungeprüft überschreiben
    for (const name of [...this.dirty]) {
      try {
        const ref = this.col().doc(name);
        let write = true;
        if (name.startsWith('m-') || name.startsWith('j-')) { try { const snap = await ref.get(); if (snap.exists) write = this.mergeRemote(name, clone(snap.data() || {})); } catch (e) { } }
        if (write) await ref.set(JSON.parse(JSON.stringify(this.bodyFor(name))));
        this.dirty.delete(name);
      } catch (e) { app.storeErr = (e && e.code) || 'unavailable'; if (e && (e.code === 'revoked' || e.code === 'not_granted' || e.code === 'quota_exceeded')) break; }
    }
    this.saveLocal();
  },
  soon() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 900); },
  /** Einmalige Bereinigung: COROS-Werte neu laden, Profil-Eingaben und Tagebuch behalten */
  async migrate() {
    const R0 = app.real; if ((R0.meta && R0.meta.schema) === SCHEMA) return false;
    const hadData = !!(R0.meta && R0.meta.lastSync) || Object.keys(R0.days).length > 0;
    const man = (R0.profile && R0.profile._manual) || {};
    const keepProfile = {}; for (const k in (R0.profile || {})) if (man[k] || k === '_manual' || k === '_ts' || k === 'strengthCodes' || k === 'wakeTime') keepProfile[k] = R0.profile[k];
    const st = emptyState(); st.profile = keepProfile; st.journal = R0.journal || {}; st.meta = { schema: SCHEMA };
    if (app.storeMode === 'db' && this.loaded) {
      try { const snap = await this.col().get(); for (const doc of snap.docs) if (doc.id === 'meta' || doc.id.startsWith('m-')) await this.col().doc(doc.id).delete(); } catch (e) { app.storeErr = (e && e.code) || 'unavailable'; }
    }
    app.real = st; this.mark('profile'); this.mark('meta'); for (const d of Object.keys(st.journal)) this.markJournal(d);
    await this.flush();
    return hadData;
  },
  async wipe() {
    if (app.storeMode === 'db') {
      try { const snap = await this.col().get(); for (const doc of snap.docs) await this.col().doc(doc.id).delete(); } catch (e) { app.storeErr = e && e.code; }
    }
    try { localStorage.removeItem(LS_KEY); } catch (e) { }
  }
};
function saveUi() { try { localStorage.setItem(LS_UI, JSON.stringify({ skin: app.skin, demoPref: app.demoPref, trend: app.trend })); } catch (e) { } }
function loadUi() { try { const u = JSON.parse(localStorage.getItem(LS_UI) || '{}'); if (u.skin) app.skin = u.skin; if (u.demoPref) app.demoPref = u.demoPref; if (u.trend) app.trend = u.trend; } catch (e) { } }

/* ---------- Datenquelle & Berechnung ---------- */
function realHasData() { return Object.keys(app.real.days).length >= 2 || Object.keys(app.real.acts).length >= 2; }
function usingDemo() { return app.demoPref === 'demo' || (app.demoPref === 'auto' && !realHasData()); }
function recompute() {
  if (usingDemo()) { if (!app.demo) app.demo = makeDemo(todayStr()); app.S = app.demo; }
  else app.S = app.real;
  const t = todayStr();
  app.A = analyze(app.S, { today: t });
  app.H = healthspan(app.S, app.A);
  app.ins = journalInsights(app.S, app.A);
  if (app.date > t) app.date = t;
}
function profileForView() { return usingDemo() ? app.demo.profile : app.real.profile; }
function needForNight(wakeDate) {
  const A = app.A, P = A.P;
  const prev = A.D[addDays(wakeDate, -1)];
  const ns = prev && isNum(prev.strain) ? clamp((prev.strain - 8) * 3.5, 0, 50) : 0;
  let debt = 0; const w = [0.5, 0.3, 0.2];
  for (let i = 1; i <= 3; i++) { const q = A.D[addDays(wakeDate, -i)]; if (q && isNum(q.sleepMin) && isNum(q.need)) debt += w[i - 1] * Math.max(0, q.need - q.sleepMin); }
  const nd = clamp(debt * 0.6, 0, 90);
  return { base: P.sleepBase, strain: ns, debt: nd, total: P.sleepBase + ns + nd };
}
function baseStats(key, d, n = 30) {
  const v = []; for (let i = 1; i <= n; i++) { const x = app.S.days[addDays(d, -i)]; if (x && isNum(x[key])) v.push(x[key]); }
  return { mean: mean(v), sd: v.length >= 5 ? sd(v) : null, n: v.length };
}

/* ---------- COROS-Anbindung ---------- */
const FATAL = new Set(['coros_login', 'network_blocked', 'oauth_failed', 'needs_reauth', 'server_not_connected', 'selection_required', 'server_not_found', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'not_granted', 'capability_disabled', 'capability_removed', 'consent_required', 'user_changed', 'cancelled', 'no_mcp']);
const TOOL_NAMES = ['queryUserInfo', 'querySleepOverview', 'querySleepHrv', 'queryTrainingSchedule', 'queryRestingHeartRate', 'queryDailyHealthData', 'queryAvgHeartRate', 'queryStressLevel', 'queryStressTimeSeries', 'queryHealthCheckTimeSeries', 'queryRecoveryStatus', 'queryFitnessAssessmentOverview', 'queryTrainingLoadAssessment', 'querySportRecords', 'getActivityDetail', 'queryDevices'];
const CONN_COPY = {
  server_not_connected: ['COROS ist in deinem Claude-Konto noch nicht verbunden.', 'Füge den COROS-Konnektor einmalig hinzu und melde dich mit deinem COROS-Konto an. Danach hier auf „Mit COROS verbinden“ tippen.'],
  needs_reauth: ['Die COROS-Anmeldung ist abgelaufen.', 'Öffne in Claude Einstellungen → Konnektoren → COROS und verbinde neu.'],
  selection_required: ['Es gibt mehrere COROS-Konnektoren.', 'Wähle im Dialog von Claude aus, welcher verwendet werden soll, und tippe dann erneut auf Synchronisieren.'],
  server_not_found: ['Der COROS-Konnektor wurde nicht gefunden.', 'Entferne ihn in Claude unter Einstellungen → Konnektoren und füge ihn neu hinzu.'],
  not_in_manifest: ['Der Zugriff auf COROS ist für Vagus nicht erlaubt.', 'Du hast den Zugriff abgelehnt oder er ist abgeschaltet. Öffne die Berechtigungen dieser App und erlaube COROS.'],
  approval_required: ['Vagus braucht deine Freigabe für COROS.', 'Tippe auf „Mit COROS verbinden“ und bestätige den Dialog von Claude.'],
  consent_required: ['Vagus braucht deine Freigabe für COROS.', 'Tippe auf „Mit COROS verbinden“ und bestätige den Dialog von Claude.'],
  blocked_by_policy: ['Deine Organisation erlaubt diesen COROS-Zugriff nicht.', 'Das lässt sich nur in den Organisationseinstellungen von Claude ändern.'],
  not_granted: ['Konnektoren sind in dieser Ansicht nicht freigegeben.', 'Öffne Vagus direkt in Claude (Browser oder App).'],
  capability_disabled: ['Diese Ansicht kann keine Konnektoren nutzen.', 'Öffne Vagus direkt in Claude (Browser oder App).'],
  capability_removed: ['Diese Claude-Version unterstützt den Datenabruf noch nicht.', 'Aktualisiere die Claude-App oder öffne Vagus im Browser.'],
  no_mcp: ['Vagus ist außerhalb von Claude geöffnet.', 'Datenabruf von COROS funktioniert nur, wenn die App in Claude (claude.ai oder Claude-App) geöffnet ist.'],
  user_changed: ['Das angemeldete Konto hat gewechselt.', 'Lade die Seite neu.'],
  cancelled: ['Abgebrochen.', ''],
  coros_login: ['Noch nicht mit COROS angemeldet.', 'Tippe unter Mehr → COROS-Verbindung auf „Mit COROS anmelden“.'],
  network_blocked: ['COROS lässt keine direkte Verbindung aus dem Browser zu.', 'Richte zuerst unter Mehr → Geräteabgleich deinen Speicherdienst ein. Er vermittelt dann die Verbindung zu COROS.'],
  oauth_failed: ['Die COROS-Anmeldung hat nicht geklappt.', 'Versuche es unter Mehr → COROS-Verbindung noch einmal.']
};
if (IS_STANDALONE) CONN_COPY.needs_reauth = ['Die COROS-Anmeldung ist abgelaufen.', 'Melde dich unter Mehr → COROS-Verbindung neu an.'];
function fitInput(tool, input) {
  const sc = app.schemas[tool];
  if (!sc || !sc.properties) return input;
  const out = {};
  for (const k in input) if (k in sc.properties) out[k] = input[k];
  for (const r of (sc.required || [])) if (!(r in out)) {
    const t = (sc.properties[r] || {}).type;
    out[r] = r === 'sportTypeCodes' ? [65535] : r === 'limit' ? 20 : r === 'days' ? 7 : t === 'string' ? '' : (t === 'integer' || t === 'number') ? 0 : t === 'array' ? [] : t === 'boolean' ? false : '';
  }
  return out;
}
async function callTool(tool, input) {
  const mcp = app.caps.mcp;
  if (!mcp) throw { code: 'no_mcp' };
  const inp = fitInput(tool, input || {});
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await mcp.callTool(SERVER, tool, inp, { cache: false });
      const parsed = parseResult(res);
      app.raw[tool] = { at: Date.now(), input: inp, text: (parsed.raw || '').slice(0, 12000) };
      app.toolStatus[tool] = { ok: true, at: Date.now(), n: parsed.records.length };
      return parsed;
    } catch (e) {
      const code = (e && e.code) || 'upstream_error';
      if (e && e.retryable && attempt === 0 && !FATAL.has(code)) { await wait((e.retryAfterMs || 0) + 500 + Math.random() * 900); continue; }
      let txt = ''; try { if (e && e.result) txt = parseResult(e.result).raw || ''; } catch (x) { }
      app.toolStatus[tool] = { ok: false, at: Date.now(), code, msg: String((e && e.message) || '').slice(0, 300) };
      app.raw[tool] = { at: Date.now(), input: inp, error: code + (e && e.message ? ': ' + e.message : ''), text: txt.slice(0, 4000) };
      throw { code, message: e && e.message };
    }
  }
}
async function loadSchemas() {
  const mcp = app.caps.mcp; if (!mcp || !mcp.describeTool) return;
  await Promise.all(TOOL_NAMES.map(async t => { try { const d = await mcp.describeTool(SERVER, t); if (d && d.inputSchema) app.schemas[t] = d.inputSchema; } catch (e) { } }));
}
const RANGE = { rhr: [25, 130], avgHr: [25, 200], hrv: [5, 300], stress: [0, 100], steps: [0, 150000], kcal: [0, 20000], resp: [4, 40], spo2: [70, 100], sleepMin: [0, 1440] };
function mergeDay(d, patch, keepExisting) {
  if (!d || !patch || d > todayStr()) return;
  const cur = app.real.days[d] || (app.real.days[d] = { date: d });
  for (const k in patch) {
    const v = patch[k];
    if (v == null || (typeof v === 'number' && !isFinite(v))) continue;
    if (RANGE[k] && !(isNum(v) && v >= RANGE[k][0] && v <= RANGE[k][1])) continue; // unplausible Werte verwerfen
    if (keepExisting && cur[k] != null) continue;
    cur[k] = v;
  }
  cur.src = 'coros'; cur._at = Date.now();
  store.markDay(d);
}
async function fetchWindowed(tool, span, mkInput, onParsed, chunk0) {
  const t = todayStr(); const start = addDays(t, -(span - 1));
  let chunk = Math.min(chunk0 || 31, span), end = t, adaptive = chunk > 7, empties = 0;
  while (end >= start) {
    const s = addDays(end, -(chunk - 1)) < start ? start : addDays(end, -(chunk - 1));
    setProgress((app.progressBase || '') + ' · ab ' + fDM(s));
    const parsed = await callTool(tool, mkInput(compact(s), compact(end)));
    const dated = [...new Set(parsed.records.filter(r => r.date).map(r => r.date))].sort();
    onParsed(parsed);
    if (adaptive && chunk > 7 && dated.length > 0 && dated.length <= 7) { chunk = 7; adaptive = false; continue; } // Werkzeug liefert max. 7 Tage → dasselbe Fenster in 7-Tage-Schritten
    adaptive = false;
    empties = dated.length ? 0 : empties + 1;
    if (empties >= 2 && diffDays(t, s) > 45) break; // keine ältere Historie
    end = addDays(s, -1);
    await wait(120);
  }
}
async function fetchSleep(span) {
  const run = tool => fetchWindowed(tool, span, (s, e) => ({ startDate: s, endDate: e, days: 7 }), p => {
    for (const r of p.records) if (r.date) { const sl = normSleep(r); if (isNum(sl.mainMin) || isNum(sl.totalMin)) mergeDay(r.date, { sleep: sl }); }
  });
  await run('querySleepOverview');
}
async function fetchHrv(span) {
  await fetchWindowed('querySleepHrv', span, (s, e) => ({ startDate: s, endDate: e, days: 7 }), p => {
    for (const r of p.records) if (r.date) { const h = normHrv(r); if (isNum(h.hrv)) mergeDay(r.date, { hrv: h.hrv, hrvRange: (isNum(h.lo) && isNum(h.hi)) ? [h.lo, h.hi] : null, hrvEval: h.eval }); }
  }, 7); // COROS liefert HRV in 7-Tage-Fenstern
}
async function fetchAvgHr(span) {
  await fetchWindowed('queryAvgHeartRate', span, (s, e) => ({ startDate: s, endDate: e, days: 7 }), p => {
    for (const r of p.records) if (r.date) { const v = normSingle(r, [/(avg|average)(heartrate|hr)/, /heartrate/, /hr$/]); if (isNum(v)) mergeDay(r.date, { avgHr: v }); }
  });
}
async function fetchDaysParam(tool, span, mapper, keepMapper) {
  let p = null;
  for (const n of [...new Set([span, Math.min(span, 30), Math.min(span, 7)])]) {
    try { p = await callTool(tool, { days: n }); break; } catch (e) { if (FATAL.has(e.code) || n === Math.min(span, 7)) throw e; }
  }
  for (const r of p.records) if (r.date) { mergeDay(r.date, mapper(r)); if (keepMapper) mergeDay(r.date, keepMapper(r), true); }
}
async function fetchCheck(nDays) {
  const p = await callTool('queryHealthCheckTimeSeries', { startDate: '', endDate: '', days: 7 });
  const c = normCheck(p);
  if (c.date) mergeDay(c.date, { resp: c.resp, spo2: c.spo2 });
  // Atemfrequenz-Verlauf: einzelne Tage abfragen (für die persönliche Basislinie)
  const t = todayStr(); let misses = 0;
  for (let i = 1; i < nDays && misses < 5; i++) {
    const d = addDays(t, -i);
    if (app.real.days[d] && isNum(app.real.days[d].resp)) continue;
    setProgress((app.progressBase || '') + ' · ' + fDM(d));
    try {
      const q = normCheck(await callTool('queryHealthCheckTimeSeries', { startDate: compact(d), endDate: compact(d), days: 7 }));
      if (q.date === d && (isNum(q.resp) || isNum(q.spo2))) { mergeDay(d, { resp: q.resp, spo2: q.spo2 }); misses = 0; } else misses++;
    } catch (e) { if (FATAL.has(e.code)) throw e; break; }
    await wait(100);
  }
}
const INTENSE = /interval|tempo|threshold|schwelle|vo2|speed|race|wettkampf|hill|berg|fartlek|sprint|max/i;
async function fetchSchedule() {
  const t = todayStr();
  const p = await callTool('queryTrainingSchedule', { startDate: compact(t), endDate: compact(addDays(t, 6)) });
  const items = [];
  for (const r of p.records) {
    if (!r.date) continue;
    const kv = r.kv;
    const fromTitle = String(r.title || '').replace(RX_DATE, '').replace(/^[\s\d.)—–:-]+/, '').trim();
    const firstNote = (r.notes || []).find(n => !/plan id|idinplan|do not show|queryTraining|updateTraining/i.test(n));
    const name = getv(kv, [/^(workout|course)?name$/, /^title$/]) || fromTitle || firstNote;
    const bits = [];
    const di = getv(kv, [/distance/]); if (di != null) bits.push(String(di));
    const du = getv(kv, [/estimatedtime|duration|^time$/], /date|day|start/); if (du != null) bits.push('ca. ' + String(du));
    const ld = getv(kv, [/^load$/, /trainingload/]); if (ld != null) bits.push(String(ld).replace(/\bTL\b/, 'Trainingslast'));
    const ty = getv(kv, [/^type$|sporttype|^sport$/]); if (ty != null && !isNum(ty)) bits.push(String(ty));
    items.push({ date: r.date, name: String(name || 'Training').slice(0, 80), info: bits.join(' · ').slice(0, 120) });
  }
  app.real.schedule = { fetched: t, items: items.slice(0, 30) }; store.mark('meta');
}
async function fetchStressTs() {
  const p = await callTool('queryStressTimeSeries', { startDate: '', endDate: '', days: 1 });
  const t = todayStr();
  let pts = parseSeries(p.raw, 'stress').map(x => ({ ...localOf(x.ts, x.tz), v: x.v })).filter(x => x.date === t && x.v >= 0 && x.v <= 100).map(x => [x.min, x.v]);
  if (pts.length < 5) { // Ersatz: Zeilen mit Uhrzeit
    pts = [];
    for (const line of String(p.raw).split(/\n/)) { const m = line.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\D{1,20}?(\d{1,3})(?!\d|:)/); if (m && +m[3] <= 100) pts.push([(+m[1]) * 60 + (+m[2]), +m[3]]); }
  }
  if (pts.length >= 5) { pts.sort((a, b) => a[0] - b[0]); app.real.stressTs = { date: t, pts: pts.slice(0, 600) }; store.mark('meta'); }
}
async function fetchRecovery() {
  const p = await callTool('queryRecoveryStatus', {});
  const r = normRecovery(p); if (Object.keys(r).length) { app.real.corosRecovery = { ...r, date: todayStr() }; store.mark('meta'); }
}
async function fetchFitness() {
  const p = await callTool('queryFitnessAssessmentOverview', {});
  const f = normFitness(p); const t = todayStr();
  if (Object.keys(f).length) {
    app.real.fitness = { ...f, date: t };
    if (isNum(f.vo2max)) { app.real.fitnessHist = (app.real.fitnessHist || []).filter(x => x.date !== t); app.real.fitnessHist.push({ date: t, vo2max: f.vo2max }); }
    store.mark('meta');
  }
}
async function fetchLoad() {
  const p = await callTool('queryTrainingLoadAssessment', { days: 28 });
  const l = normLoad(p);
  app.real.load = clean({ acute: l.acute, chronic: l.chronic, ratio: l.ratio, status: l.status, asOf: l.asOf, history: l.history, date: todayStr() });
  for (const d in (l.daily || {})) mergeDay(d, { corosLoad: l.daily[d] });
  store.mark('meta');
}
async function fetchActivities(span) {
  const t = todayStr(); const start = addDays(t, -(span - 1));
  let limit = 50;
  for (let end = t; end >= start;) {
    const s = addDays(end, -29) < start ? start : addDays(end, -29);
    const input = { startDate: compact(s), endDate: compact(end), sportTypeCodes: [65535], minDistanceKm: 0, maxDistanceKm: 0, minDurationMinutes: 0, maxDurationMinutes: 0, maxAveragePace: '', locationKeyword: '', limit };
    let p;
    try { p = await callTool('querySportRecords', input); }
    catch (e) { if (FATAL.has(e.code) || limit === 20) throw e; limit = 20; continue; }
    for (const r of p.records) {
      const a = normActivity(r);
      if (!a.date) continue;
      if (!a.id) a.id = 'gen-' + compact(a.date) + '-' + (a.start || '').slice(11, 16).replace(':', '') + '-' + (a.sport || 0) + '-' + Math.round(a.durMin || 0);
      const old = app.real.acts[a.id] || {};
      app.real.acts[a.id] = Object.assign({}, a, old.detailed ? { avgHr: old.avgHr ?? a.avgHr, maxHr: old.maxHr, kcal: old.kcal ?? a.kcal, load: old.load, zones: old.zones, te: old.te, ate: old.ate, focus: old.focus, effort: old.effort, detailed: true } : {}, { src: 'coros' });
      app.real.acts[a.id] = clean(app.real.acts[a.id]); app.real.acts[a.id]._at = Date.now();
      store.markDay(a.date);
    }
    end = addDays(s, -1);
    await wait(120);
  }
}
async function fetchDetails(max) {
  const list = Object.values(app.real.acts).filter(a => !a.detailed && a.id && !a.id.startsWith('gen-') && isNum(a.sport) && (a.detailTries || 0) < 3).sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, max);
  let i = 0;
  for (const a of list) {
    i++; setProgress('Aktivitätsdetails ' + i + '/' + list.length);
    try {
      const p = await callTool('getActivityDetail', { labelId: a.id, sportType: a.sport });
      const kv = Object.assign({}, p.meta, ...p.records.map(r => r.kv));
      const d = normActivity({ date: a.date, title: '', kv });
      for (const k of ['avgHr', 'maxHr', 'kcal', 'load', 'zones', 'te', 'ate', 'focus', 'effort', 'pace', 'speed']) if (d[k] != null) a[k] = d[k];
      if (!isNum(a.durMin) && isNum(d.durMin)) a.durMin = d.durMin;
      if (!isNum(a.distKm) && isNum(d.distKm)) a.distKm = d.distKm;
      a.detailed = true;
    } catch (e) { if (FATAL.has(e.code)) throw e; a.detailTries = (a.detailTries || 0) + 1; if (e.code === 'tool_error') { a.detailed = true; a.detailErr = e.code; } }
    a._at = Date.now(); store.markDay(a.date);
    await wait(120);
  }
}
function applyUser(u) {
  const P = app.real.profile; const man = P._manual || {};
  let ch = false;
  for (const k in u) if (!man[k] && u[k] != null && P[k] !== u[k]) { P[k] = u[k]; ch = true; }
  if (ch) store.mark('profile');
}
function setProgress(label, frac) {
  app.progress = { label, frac: frac ?? (app.progress && app.progress.frac) ?? 0 };
  const el = $('#syncLbl'); if (el) el.textContent = label;
  const bar = $('#syncBar'); if (bar) bar.style.width = Math.round((app.progress.frac || 0) * 100) + '%';
  const pl = $('#syncProgLbl'); if (pl) pl.textContent = label;
}
async function sync(mode) {
  if (app.syncing) return;
  if (!app.caps.mcp) { app.conn = { state: 'error', code: 'no_mcp' }; render(); return; }
  if (IS_STANDALONE && !Coros.loggedIn()) { app.conn = { state: 'error', code: 'coros_login' }; render(); return; }
  app.syncing = true; app.conn = { state: 'syncing' };
  render();
  const t = todayStr(); const last = app.real.meta.lastSync;
  const first = !last; const hist = mode === 'history';
  const span = hist ? 180 : first ? 35 : clamp(diffDays(t, ymd(new Date(last))) + 3, 4, 180);
  const sections = {};
  const steps = [
    ['Verbinde mit COROS', async () => { const p = await callTool('queryUserInfo', {}); applyUser(normUser(p)); if (!Object.keys(app.schemas).length) await loadSchemas(); }],
    ['Schlaf', () => fetchSleep(span)],
    ['Herzfrequenzvariabilität', () => fetchHrv(span)],
    ['Ruhepuls', () => fetchDaysParam('queryRestingHeartRate', span, r => ({ rhr: normSingle(r, [/resting/, /rhr/]) }))],
    ['Tageswerte', () => fetchDaysParam('queryDailyHealthData', span, r => { const x = normDaily(r); return { steps: x.steps, kcal: x.kcal }; }, r => { const x = normDaily(r); return { stress: x.stress, rhr: x.rhr, hrv: x.hrv, avgHr: x.avgHr, sleepMin: x.sleepMin }; })],
    ['Stress', () => fetchDaysParam('queryStressLevel', span, r => ({ stress: normSingle(r, [/stress/]) }))],
    ['Ø-Herzfrequenz', () => fetchAvgHr(span)],
    ['Gesundheitscheck', () => fetchCheck(hist ? 21 : first ? 14 : Math.min(span, 7))],
    ['Trainingsplan', fetchSchedule],
    ['Stressverlauf', fetchStressTs],
    ['COROS-Erholung', fetchRecovery],
    ['Fitness', fetchFitness],
    ['Trainingslast', fetchLoad],
    ['Aktivitäten', () => fetchActivities(span)],
    ['Aktivitätsdetails', () => fetchDetails(hist ? 60 : first ? 25 : 12)]
  ];
  try {
    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      app.progressBase = label; setProgress(label + ' …', i / steps.length);
      try { await fn(); sections[label] = 'ok'; }
      catch (e) { if (i === 0 || FATAL.has(e.code)) throw e; sections[label] = e.code || 'Fehler'; }
    }
    app.real.meta.lastSync = Date.now(); app.real.meta.schema = SCHEMA;
    if (hist) app.real.meta.historyLoaded = Date.now();
    app.real.meta.sections = sections;
    store.mark('meta');
    setProgress('Speichere …', 1);
    await store.flush();
    const failed = Object.entries(sections).filter(([k, v]) => v !== 'ok').map(([k]) => k);
    app.conn = { state: 'ready', failed };
    app.perm = 'granted';
    if (first && !hist && !app.real.meta.historyLoaded) app.autoHistory = true; // danach automatisch 6 Monate laden
  } catch (e) {
    app.conn = { state: 'error', code: e.code || 'upstream_error', msg: e.message };
    await store.flush();
  } finally {
    app.syncing = false; app.progress = null;
    recompute(); render();
    if (app.autoHistory) { app.autoHistory = false; setTimeout(() => sync('history'), 400); }
    else Sync.run().then(ch => { if (ch) { recompute(); render(); } });
  }
}

/* ---------- Diagramme ---------- */
function niceTicks(lo, hi, n) {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo; const step0 = span / n; const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag; const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = []; for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}
const tipEl = () => $('#tip');
function showTip(html, x, y) { const t = tipEl(); t.innerHTML = html; t.hidden = false; const r = t.getBoundingClientRect(); let L = x + 14, T = y - r.height - 10; if (L + r.width > innerWidth - 8) L = x - r.width - 14; if (T < 8) T = y + 16; t.style.left = Math.max(8, L) + 'px'; t.style.top = T + 'px'; }
function hideTip() { const t = tipEl(); if (t) t.hidden = true; }
function attachHover(el, svg, xs, htmlAt, top, bottom) {
  const line = svg.querySelector('.xhair');
  const move = ev => {
    const r = svg.getBoundingClientRect(); const mx = ev.clientX - r.left;
    let best = -1, bd = 1e9; xs.forEach((x, i) => { if (x == null) return; const d = Math.abs(x - mx); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    const h = htmlAt(best); if (!h) { hideTip(); if (line) line.style.display = 'none'; return; }
    if (line) { line.setAttribute('x1', xs[best]); line.setAttribute('x2', xs[best]); line.style.display = ''; }
    showTip(h, ev.clientX, ev.clientY);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { hideTip(); if (line) line.style.display = 'none'; });
}
function chartEmpty(el, msg) { el.innerHTML = `<div class="faint small" style="padding:22px 0;text-align:center">${esc(msg || 'Noch keine Daten für diesen Zeitraum.')}</div>`; }
/** Linie über Datumsachse. pts: [{x, y}] (x = Datum oder Zahl) */
function chartLine(el, pts, o = {}) {
  const W = Math.max(240, el.clientWidth || 320), H = o.h || 170;
  const m = { l: o.ml || 38, r: 12, t: 14, b: 24 };
  const ys = pts.map(p => p.y).filter(isNum);
  if (ys.length < 2) return chartEmpty(el, o.empty);
  let lo = o.yMin ?? Math.min(...ys), hi = o.yMax ?? Math.max(...ys);
  if (o.band) { lo = Math.min(lo, o.band[0]); hi = Math.max(hi, o.band[1]); }
  if (isNum(o.ref)) { lo = Math.min(lo, o.ref); hi = Math.max(hi, o.ref); }
  const pad = (hi - lo) * 0.1 || 1; if (o.yMin == null) lo -= pad; if (o.yMax == null) hi += pad;
  const ticks = niceTicks(lo, hi, 4); lo = o.yMin ?? ticks[0]; hi = o.yMax ?? ticks[ticks.length - 1];
  const n = pts.length; const X = i => m.l + (n <= 1 ? 0.5 : i / (n - 1)) * (W - m.l - m.r); const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const col = o.color || 'var(--accent)';
  let g = '';
  for (const tv of ticks) { if (tv < lo - 1e-9 || tv > hi + 1e-9) continue; g += `<line class="gridl" x1="${m.l}" x2="${W - m.r}" y1="${Y(tv)}" y2="${Y(tv)}"/><text class="ax" x="${m.l - 6}" y="${Y(tv) + 4}" text-anchor="end">${esc(o.yFmt ? o.yFmt(tv) : fmt(tv, 0))}</text>`; }
  if (o.band) g += `<rect x="${m.l}" y="${Y(o.band[1])}" width="${W - m.l - m.r}" height="${Math.max(0, Y(o.band[0]) - Y(o.band[1]))}" style="fill:${col};opacity:.09"/>`;
  if (isNum(o.ref)) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.ref)}" y2="${Y(o.ref)}" style="stroke:var(--ink-2)" stroke-width="1.2" stroke-dasharray="5 4"/>` + (o.refLabel ? `<text class="ax" x="${W - m.r}" y="${Y(o.ref) - 5}" text-anchor="end">${esc(o.refLabel)}</text>` : '');
  // Pfad (mit Lücken)
  let d = '', area = '', seg = [];
  const flush = () => { if (seg.length >= 1) { d += 'M' + seg.map(p => p.join(',')).join('L'); if (o.area !== false && seg.length > 1) area += `M${seg[0][0]},${H - m.b}L` + seg.map(p => p.join(',')).join('L') + `L${seg[seg.length - 1][0]},${H - m.b}Z`; } seg = []; };
  pts.forEach((p, i) => { if (isNum(p.y)) seg.push([X(i).toFixed(1), Y(p.y).toFixed(1)]); else flush(); }); flush();
  g += `<path d="${area}" style="fill:${col};opacity:.12"/><path d="${d}" fill="none" style="stroke:${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (n <= 35) pts.forEach((p, i) => { if (isNum(p.y)) g += `<circle cx="${X(i)}" cy="${Y(p.y)}" r="${p.hl ? 4.5 : 2.6}" style="fill:${p.color || col};stroke:var(--surface)" stroke-width="1.5"/>`; });
  let li = -1; for (let i = n - 1; i >= 0; i--) if (isNum(pts[i].y)) { li = i; break; }
  if (li >= 0) g += `<circle cx="${X(li)}" cy="${Y(pts[li].y)}" r="5" style="fill:${col};stroke:var(--surface)" stroke-width="2"/>`;
  // x-Achse
  const xl = o.xFmt || (v => typeof v === 'string' ? fDM(v) : String(v));
  const idx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
  for (const i of idx) g += `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(xl(pts[i].x))}</text>`;
  g += `<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/>`;
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'Verlauf')}">${g}</svg>`;
  const svg = el.querySelector('svg');
  attachHover(el, svg, pts.map((p, i) => X(i)), i => isNum(pts[i].y) ? `<div class="faint tiny">${esc(o.tipX ? o.tipX(pts[i].x) : (typeof pts[i].x === 'string' ? fDay(pts[i].x) : pts[i].x))}</div><b>${esc(o.tipFmt ? o.tipFmt(pts[i].y) : fmt(pts[i].y, 1))}</b>${pts[i].note ? '<div class="faint tiny">' + esc(pts[i].note) + '</div>' : ''}` : null);
}
/** Balken: items [{x, y, color, mark, note}] */
function chartBars(el, items, o = {}) {
  const W = Math.max(240, el.clientWidth || 320), H = o.h || 160;
  const m = { l: o.ml || 34, r: 10, t: 12, b: 24 };
  const ys = items.map(p => p.y).filter(isNum);
  if (!ys.length) return chartEmpty(el, o.empty);
  const marks = items.map(p => p.mark).filter(isNum);
  let hi = o.yMax ?? Math.max(...ys, ...marks) * 1.08; const lo = o.yMin ?? 0;
  const ticks = niceTicks(lo, hi, 4); hi = o.yMax ?? ticks[ticks.length - 1];
  const n = items.length; const bw = (W - m.l - m.r) / n; const gap = Math.max(2, Math.min(8, bw * 0.28));
  const X = i => m.l + i * bw + gap / 2; const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  let g = '';
  for (const tv of ticks) { if (tv > hi + 1e-9) continue; g += `<line class="gridl" x1="${m.l}" x2="${W - m.r}" y1="${Y(tv)}" y2="${Y(tv)}"/><text class="ax" x="${m.l - 6}" y="${Y(tv) + 4}" text-anchor="end">${esc(o.yFmt ? o.yFmt(tv) : fmt(tv, 0))}</text>`; }
  if (o.band) g += `<rect x="${m.l}" y="${Y(o.band[1])}" width="${W - m.l - m.r}" height="${Math.max(0, Y(o.band[0]) - Y(o.band[1]))}" style="fill:var(--ink-3);opacity:.1"/>`;
  items.forEach((p, i) => {
    const w = Math.max(2, bw - gap);
    if (isNum(p.y)) { const y = Y(Math.max(lo, p.y)), h = Math.max(1, Y(lo) - y); const r = Math.min(4, w / 2); g += `<path d="M${X(i)},${Y(lo)}V${y + r}Q${X(i)},${y} ${X(i) + r},${y}H${X(i) + w - r}Q${X(i) + w},${y} ${X(i) + w},${y + r}V${Y(lo)}Z" style="fill:${p.color || o.color || 'var(--accent)'}"/>`; }
    if (isNum(p.mark)) g += `<line x1="${X(i) - 1}" x2="${X(i) + w + 1}" y1="${Y(p.mark)}" y2="${Y(p.mark)}" style="stroke:var(--ink)" stroke-width="2" stroke-linecap="round"/>`;
  });
  const every = Math.ceil(n / (W < 420 ? 7 : 12));
  const xl = o.xFmt || (v => typeof v === 'string' && /^\d{4}-/.test(v) ? (n <= 8 ? DF.wd.format(dateOf(v)) : fDM(v)) : String(v));
  items.forEach((p, i) => { if (i % every === 0 || i === n - 1 && n <= 14) g += `<text class="ax" x="${X(i) + (bw - gap) / 2}" y="${H - 6}" text-anchor="middle">${esc(xl(p.x))}</text>`; });
  g += `<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/>`;
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'Balkendiagramm')}">${g}</svg>`;
  attachHover(el, el.querySelector('svg'), items.map((p, i) => X(i) + (bw - gap) / 2), i => isNum(items[i].y) ? `<div class="faint tiny">${esc(typeof items[i].x === 'string' && /^\d{4}-/.test(items[i].x) ? fDay(items[i].x) : items[i].x)}</div><b>${esc(o.tipFmt ? o.tipFmt(items[i].y) : fmt(items[i].y, 1))}</b>${items[i].note ? '<div class="faint tiny">' + esc(items[i].note) + '</div>' : ''}` : null);
}
/** Schlafrhythmus: Balken von Einschlafen bis Aufwachen */
function chartSleepRange(el, items) {
  const W = Math.max(240, el.clientWidth || 320), H = 190; const m = { l: 44, r: 10, t: 10, b: 24 };
  const ok = items.filter(p => isNum(p.bed) && isNum(p.wake));
  if (ok.length < 2) return chartEmpty(el, 'Noch keine Schlafzeiten.');
  let lo = Math.min(...ok.map(p => p.bed)) - 30, hi = Math.max(...ok.map(p => p.wake)) + 30;
  lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
  const n = items.length; const bw = (W - m.l - m.r) / n; const gap = Math.max(3, bw * 0.4);
  const X = i => m.l + i * bw + gap / 2; const Y = v => m.t + (v - lo) / (hi - lo) * (H - m.t - m.b);
  let g = '';
  const stepH = (hi - lo) > 720 ? 180 : 120;
  for (let v = lo; v <= hi; v += stepH) g += `<line class="gridl" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${clockFromNoon(v)}</text>`;
  items.forEach((p, i) => { if (!isNum(p.bed) || !isNum(p.wake)) return; const w = Math.max(3, bw - gap); g += `<rect x="${X(i)}" y="${Y(p.bed)}" width="${w}" height="${Math.max(2, Y(p.wake) - Y(p.bed))}" rx="${Math.min(4, w / 2)}" style="fill:var(--sleep)"/>`; });
  const every = Math.ceil(n / (W < 420 ? 7 : 14));
  items.forEach((p, i) => { if (i % every === 0) g += `<text class="ax" x="${X(i) + (bw - gap) / 2}" y="${H - 6}" text-anchor="middle">${esc(n <= 8 ? DF.wd.format(dateOf(p.x)) : fDM(p.x))}</text>`; });
  g += `<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/>`;
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Schlafenszeiten">${g}</svg>`;
  attachHover(el, el.querySelector('svg'), items.map((p, i) => X(i) + (bw - gap) / 2), i => isNum(items[i].bed) ? `<div class="faint tiny">Nacht auf ${esc(fDay(items[i].x))}</div><b>${clockFromNoon(items[i].bed)} – ${clockFromNoon(items[i].wake)}</b>` : null);
}
function ring({ frac, color, value, unit, label, size = 132, stroke = 11 }) {
  const c = size / 2, r = c - stroke / 2 - 2, C = 2 * Math.PI * r; const f = clamp(isNum(frac) ? frac : 0, 0, 1);
  const vs = String(value); const fs = vs.length > 4 ? size * 0.2 : size * 0.26;
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || '')}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" class="ring-track" stroke-width="${stroke}"/>` +
    (f > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>` : '') +
    `<text x="${c}" y="${c + fs * 0.32}" text-anchor="middle" class="ring-val" font-size="${fs}">${esc(vs)}</text>` +
    (unit ? `<text x="${c}" y="${c + fs * 0.32 + 17}" text-anchor="middle" class="ring-unit" font-size="11">${esc(unit)}</text>` : '') + `</svg>`;
}
function queueChart(fn) { const id = 'c' + app.charts.length; app.charts.push({ id, fn }); return `<div class="chart" id="${id}"></div>`; }
function drawCharts() { for (const c of app.charts) { const el = document.getElementById(c.id); if (el) { try { c.fn(el); } catch (e) { chartEmpty(el, 'Diagramm konnte nicht gezeichnet werden.'); } } } }

/* ---------- Bausteine ---------- */
function card(title, body, opts = {}) {
  return `<section class="card ${opts.cls || ''}">${title ? `<div class="card-h"><h2>${title}</h2>${opts.right ? `<span class="eyebrow">${opts.right}</span>` : ''}</div>` : ''}${body}</section>`;
}
function stagesBar(sl) {
  const parts = [['Wach', sl.awakeMin, 'var(--st-awake)'], ['Leicht', sl.lightMin, 'var(--st-light)'], ['REM', sl.remMin, 'var(--st-rem)'], ['Tief', sl.deepMin, 'var(--st-deep)']].filter(p => isNum(p[1]) && p[1] > 0);
  if (!parts.length) return '<p class="faint small">Keine Schlafphasen für diese Nacht.</p>';
  const tot = sum(parts.map(p => p[1]));
  return `<div class="hbar" style="height:18px" role="img" aria-label="Schlafphasen">${parts.map(p => `<span style="width:${(p[1] / tot * 100).toFixed(2)}%;background:${p[2]}" title="${p[0]}: ${fmtDur(p[1])}"></span>`).join('')}</div>
  <div class="legend">${parts.map(p => `<span><i style="background:${p[2]}"></i>${p[0]} · <b class="num">${fmtStage(p[1])}</b> <span class="faint">(${fmt(p[1] / tot * 100)} %)</span></span>`).join('')}</div>`;
}
const ZONE_COL = ['color-mix(in srgb, var(--strain) 25%, var(--surface-2))', 'color-mix(in srgb, var(--strain) 45%, var(--surface-2))', 'color-mix(in srgb, var(--strain) 65%, var(--surface-2))', 'color-mix(in srgb, var(--strain) 85%, var(--surface-2))', 'var(--strain)'];
function zonesBar(z) {
  if (!z) return '';
  const tot = sum(z); if (!tot) return '';
  return `<div class="hbar" style="height:8px;margin-top:6px" role="img" aria-label="Herzfrequenzzonen">${z.map((v, i) => v > 0 ? `<span style="width:${(v / tot * 100).toFixed(2)}%;background:${ZONE_COL[i]}" title="Zone ${i + 1}: ${fmt(v)} min"></span>` : '').join('')}</div>`;
}
function actRow(a) {
  const bits = [a.label || null, a.start ? a.start.slice(11, 16) : null, isNum(a.durMin) ? fmtDur(a.durMin) : null, isNum(a.distKm) ? fmt(a.distKm, 2) + ' km' : null, isNum(a.avgHr) ? 'Ø ' + fmt(a.avgHr) + ' bpm' : null].filter(Boolean);
  const det = [
    isNum(a.maxHr) ? ['Max. Puls', fmt(a.maxHr) + ' bpm'] : null, a.pace ? ['Ø Tempo', a.pace] : null, a.speed ? ['Ø Geschwindigkeit', a.speed] : null, isNum(a.kcal) ? ['Energie', fmt(a.kcal) + ' kcal'] : null,
    isNum(a.te) ? ['Aerober Effekt', fmt(a.te, 1)] : null, isNum(a.ate) ? ['Anaerober Effekt', fmt(a.ate, 1)] : null,
    a.focus ? ['Trainingsschwerpunkt', tr(a.focus) || a.focus] : null, a.effort ? ['Empfundene Anstrengung', tr(a.effort) || a.effort] : null,
    isNum(a.load) ? ['COROS-Trainingslast', fmt(a.load)] : null, isNum(a.trimp) ? ['TRIMP', fmt(a.trimp)] : null,
    ...(a.zonesUsed ? a.zonesUsed.map((v, i) => ['Zone ' + (i + 1) + (a.zonesEstimated ? ' (geschätzt)' : ''), fmt(v) + ' min']) : [])
  ].filter(Boolean);
  return `<details class="act"><summary class="li" style="list-style:none;cursor:pointer"><div class="ic">${actIcon(a)}</div><div style="min-width:0"><div class="tt">${esc(a.name)}</div><div class="ss">${esc(bits.join(' · '))}</div>${zonesBar(a.zonesUsed)}</div><div class="rv"><div class="num" style="color:var(--strain)">${fmt(a.strain, 1)}</div><div class="faint tiny">Belastung</div></div></summary>
    <div class="kv" style="margin:2px 0 12px">${det.map(([l, v]) => `<div><div class="v" style="font-size:16px">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('') || '<p class="faint small">Keine weiteren Details von COROS.</p>'}</div></details>`;
}
function bannerHtml() {
  let h = '';
  if (usingDemo() && !(app.conn.state === 'error' && app.conn.code === 'coros_login')) h += `<div class="banner"><div class="grow"><b>Du siehst Beispieldaten.</b> Verbinde dein COROS-Konto, dann rechnet Vagus mit deinen eigenen Werten.</div><button class="btn sm primary" data-act="${IS_STANDALONE && !Coros.loggedIn() ? 'corosLogin' : 'sub'}" data-v="verbindung">Verbinden</button></div>`;
  if (app.conn.state === 'error' && app.conn.code) {
    const c = CONN_COPY[app.conn.code] || ['COROS hat nicht geantwortet.', 'Versuche es in ein paar Minuten noch einmal. Details stehen unter Mehr → COROS-Verbindung.'];
    h += `<div class="banner err"><div class="grow"><b>${esc(c[0])}</b> ${esc(c[1])}</div>${app.conn.code === 'coros_login' || (IS_STANDALONE && app.conn.code === 'needs_reauth') ? `<button class="btn sm primary" data-act="corosLogin">Anmelden</button>` : app.conn.code === 'network_blocked' ? `<button class="btn sm" data-act="sub" data-v="abgleich">Einrichten</button>` : `<button class="btn sm" data-act="sub" data-v="verbindung">Details</button>`}</div>`;
  }
  return h;
}
function deltaTxt(v, base, unit, dec = 0, invert) {
  if (!isNum(v) || !isNum(base)) return '';
  const d = v - base; const s = (d > 0 ? '+' : d < 0 ? '−' : '±') + fmt(Math.abs(d), dec) + (unit ? ' ' + unit : '');
  return s;
}

/* ---------- Ansicht: Heute ---------- */
function viewHeute() {
  const d = app.date, A = app.A, S = app.S, r = A.D[d] || {}, x = S.days[d] || {};
  const isToday = d === todayStr();
  let h = bannerHtml();
  const recTxt = r.recovery != null ? r.recovery : '–';
  const recSub = r.calibrating ? `Kalibrierung ${Math.min(r.hrvN || 0, 4)}/4 Tage` : r.recovery != null ? zoneName(r.zone) + (r.recoveryPartial ? ' · ohne HRV' : '') : 'keine Messung';
  const strainTxt = isNum(r.strain) ? fmt(r.strain, 1) : '–';
  const sp = r.sleepPerf;
  h += `<section class="hero3">
    <button class="gauge" data-act="scroll" data-v="rec">${ring({ frac: (r.recovery || 0) / 100, color: zoneColor(r.zone), value: recTxt, unit: r.recovery != null ? '%' : '', label: 'Erholung' })}<div class="glabel">Erholung</div><div class="gsub">${esc(recSub)}</div></button>
    <button class="gauge" data-act="tab" data-v="training">${ring({ frac: (r.strain || 0) / 21, color: 'var(--strain)', value: strainTxt, unit: 'von 21', label: 'Belastung' })}<div class="glabel">Belastung</div><div class="gsub">${r.target ? 'Ziel ' + r.target[0] + '–' + r.target[1] : '&nbsp;'}</div></button>
    <button class="gauge" data-act="tab" data-v="schlaf">${ring({ frac: (sp || 0) / 100, color: 'var(--sleep)', value: isNum(sp) ? fmt(sp) : '–', unit: isNum(sp) ? '%' : '', label: 'Schlafleistung' })}<div class="glabel">Schlaf</div><div class="gsub">${isNum(r.sleepMin) ? fmtHM(r.sleepMin) + ' h' : 'keine Nacht'}</div></button>
  </section>`;
  // Empfehlung
  const next = needForNight(addDays(d, 1));
  const wake = (profileForView().wakeTime || '07:00');
  const wm = minuteOfDay(wake) ?? 420;
  const bedMin = ((wm - next.total - 15) % 1440 + 1440) % 1440;
  const rec = {
    green: ['Bereit für Leistung', 'Deine Messwerte liegen über deinem persönlichen Schnitt. Ein intensives Training oder ein langer Lauf ist heute gut verkraftbar.'],
    yellow: ['Moderat belasten', 'Dein Körper ist teilweise erholt. Training im mittleren Bereich ist sinnvoll, harte Intervalle eher verschieben.'],
    red: ['Erholung zuerst', 'Deine Werte zeigen Belastung oder Schlafmangel. Leichte Bewegung, viel trinken und früh ins Bett bringen am meisten.']
  }[r.zone] || ['Noch keine Erholung berechnet', r.calibrating ? 'Vagus lernt gerade deine Ausgangswerte kennen. Nach 4 Nächten mit HRV-Messung erscheint deine Erholung.' : 'Für diesen Tag fehlt die nächtliche HRV-Messung deiner Uhr.'];
  let target = '';
  if (r.target) {
    const cur = r.strain || 0; const pct = v => clamp(v / 21 * 100, 0, 100);
    target = `<div class="stack" style="gap:8px;margin-top:14px">
      <div class="row between small"><span class="muted">Ziel-Belastung</span><span><b class="num">${r.target[0]}–${r.target[1]}</b> <span class="faint">· bisher ${fmt(cur, 1)}</span></span></div>
      <div style="position:relative;height:12px;border-radius:6px;background:var(--surface-2)"><div style="position:absolute;left:${pct(r.target[0])}%;width:${pct(r.target[1]) - pct(r.target[0])}%;top:0;bottom:0;background:color-mix(in srgb, var(--strain) 28%, transparent);border-radius:6px"></div><div style="position:absolute;left:0;width:${pct(cur)}%;top:3px;bottom:3px;background:var(--strain);border-radius:4px"></div></div>
      ${r.targetNote === 'acwr' ? `<p class="small faint">Die letzten 7 Tage liegen deutlich über deinem 4-Wochen-Schnitt (Verhältnis ${fmt(r.acwr, 2)}). Das Ziel ist deshalb um 2 Punkte gesenkt.</p>` : ''}
    </div>`;
  }
  h += `<div class="grid2">`;
  h += `<section class="card stripe ${r.zone || ''}" id="rec"><div class="eyebrow">Tagesempfehlung · ${esc(relDay(d))}</div><h2 style="font-size:22px;margin:6px 0 6px">${esc(rec[0])}</h2><p class="muted">${esc(rec[1])}</p>${target}
    <div class="divider" style="margin:14px 0 12px"></div>
    <div class="row between small"><span class="muted">Schlafbedarf ${isToday ? 'heute Nacht' : 'folgende Nacht'}</span><b class="num">${fmtHM(next.total)} h</b></div>
    <div class="row between small" style="margin-top:4px"><span class="muted">Schlafenszeit (Wecker ${esc(wake)})</span><b class="num">${clockFromNoon(fromNoon(bedMin))}</b></div>
  </section>`;
  // Gesundheitsmonitor
  const rows = [];
  const mrow = (t, s, v, unit, pill) => `<div class="metric"><div class="ml"><div class="t">${t}</div><div class="s">${s}</div></div><div>${pill || ''}</div><div class="mv">${v}<small>${unit}</small></div></div>`;
  const status = (v, st, higherBad, unitTxt, dec = 0) => {
    if (!isNum(v) || !isNum(st.mean)) return { s: st.n ? '' : 'noch keine Vergleichswerte', p: '' };
    const s = `30-Tage-Schnitt ${fmt(st.mean, dec)} ${unitTxt}`;
    if (!st.sd) return { s, p: '' };
    const z = (v - st.mean) / st.sd; const bad = higherBad ? z > 1.5 : z < -1.5; const good = higherBad ? z < -1 : z > 1;
    return { s, p: bad ? '<span class="pill warn"><i></i>auffällig</span>' : good ? '<span class="pill good"><i></i>sehr gut</span>' : '<span class="pill"><i style="background:var(--ink-3)"></i>normal</span>' };
  };
  let st = status(x.hrv, baseStats('hrv', d), false, 'ms'); rows.push(mrow('Herzfrequenzvariabilität', st.s, fmt(x.hrv), 'ms', st.p));
  st = status(x.rhr, baseStats('rhr', d), true, 'bpm'); rows.push(mrow('Ruhepuls', st.s, fmt(x.rhr), 'bpm', st.p));
  st = status(x.resp, baseStats('resp', d), true, '/min', 1); rows.push(mrow('Atemfrequenz', st.s || 'aus dem Gesundheitscheck der Uhr', fmt(x.resp, 1), '/min', st.p));
  if (isNum(x.spo2)) rows.push(mrow('Blutsauerstoff (SpO₂)', 'aus dem Gesundheitscheck', fmt(x.spo2), '%', x.spo2 < 93 ? '<span class="pill warn"><i></i>niedrig</span>' : ''));
  st = status(x.stress, baseStats('stress', d), true, ''); rows.push(mrow('Stress (Tagesschnitt)', st.s || 'COROS-Skala 0–100', fmt(x.stress), '', st.p));
  rows.push(mrow('Schritte', isNum(baseStats('steps', d).mean) ? `30-Tage-Schnitt ${fmt(baseStats('steps', d).mean)}` : '', fmt(x.steps), '', ''));
  const cr = app.S.corosRecovery;
  if (isToday && cr && isNum(cr.pct)) rows.push(mrow('COROS-Erholungsstatus', esc([tr(cr.level), cr.full ? 'voll erholt in ' + cr.full : ''].filter(Boolean).join(' · ')), fmt(cr.pct), '%', ''));
  h += card('Gesundheitsmonitor', `<div class="metrics">${rows.join('')}</div>`, { right: esc(relDay(d)) });
  h += `</div>`;
  // Geplantes Training aus dem COROS-Kalender
  const sch = (app.S.schedule && app.S.schedule.items || []).filter(i => i.date === d);
  if (sch.length) {
    const intense = sch.some(i => INTENSE.test(i.name + ' ' + i.info));
    const hint = !r.zone ? '' : r.zone === 'red' ? (intense ? 'Deine Erholung ist rot. Tausche die harte Einheit gegen eine lockere oder verschiebe sie um einen Tag.' : 'Rote Erholung: halte die Einheit locker und eher kurz.') : r.zone === 'yellow' ? (intense ? 'Gelbe Erholung: Einheit wie geplant, aber Intensität am unteren Ende des Zielbereichs.' : 'Passt zu deiner heutigen Erholung.') : 'Gute Voraussetzungen für die geplante Einheit.';
    h += card('Geplant in COROS', `<div class="list">${sch.map(i => `<div class="li"><div class="ic">${IC.training}</div><div style="min-width:0"><div class="tt">${esc(i.name)}</div><div class="ss">${esc(i.info)}</div></div><div></div></div>`).join('')}</div>${hint ? `<p class="small muted" style="margin-top:8px">${esc(hint)}</p>` : ''}`, { right: esc(relDay(d)) });
  }
  // Treiber der Erholung
  if (r.recoveryParts) {
    const p = r.recoveryParts;
    const items = [
      ['HRV', p.hrv, isNum(x.hrv) && r.hrvBase ? deltaTxt(x.hrv / r.hrvBase * 100, 100, '%') : 'keine Messung'],
      ['Ruhepuls', p.rhr, isNum(x.rhr) && r.rhrBase ? deltaTxt(x.rhr, r.rhrBase, 'bpm') : '–'],
      ['Schlafleistung', p.sleep, isNum(r.sleepPerf) ? fmt(r.sleepPerf) + ' %' : '–'],
      ['Atemfrequenz', p.resp, isNum(x.resp) && r.respBase ? deltaTxt(x.resp, r.respBase, '/min', 1) : 'keine Messung']
    ];
    h += card('Was deine Erholung bestimmt', items.map(([l, z, t]) => {
      const w = isNum(z) ? clamp(Math.abs(z) / 3 * 50, 1, 50) : 0;
      return `<div class="contrib"><span class="small">${l}</span><div class="bar">${isNum(z) ? `<span style="${z >= 0 ? 'left:50%' : 'right:50%'};width:${w}%;background:${z >= 0 ? 'var(--younger)' : 'var(--older)'}"></span>` : ''}</div><span class="val">${esc(t)}</span></div>`;
    }).join('') + `<p class="tiny faint" style="margin-top:8px">Balken nach rechts heben die Erholung, nach links senken sie. Vergleich mit deinem persönlichen 30-Tage-Schnitt.</p>`);
  }
  // Aktivitäten
  const acts = r.acts || [];
  h += `<div class="grid2">`;
  h += card('Aktivitäten', acts.length ? `<div class="list">${acts.map(actRow).join('')}</div>` : `<p class="faint small">Keine Aktivität aufgezeichnet. Alltagsbewegung zählt trotzdem zur Belastung (${fmt(r.strain, 1)}).</p>`, { right: esc(relDay(d)) });
  // Tagebuch (gestern Abend)
  const jd = addDays(d, -1); const je = (app.S.journal[jd] || { items: {} });
  const quick = JOURNAL.slice(0, 9);
  h += card('Tagebuch', `<p class="small muted" style="margin-bottom:10px">Was war ${jd === addDays(todayStr(), -1) ? 'gestern Abend' : 'am Abend von ' + esc(fDay(jd))}? Antippen, was zutrifft.</p>
    <div class="chips">${quick.map(b => `<button class="chipbtn" data-act="jtoggle" data-d="${jd}" data-v="${b.id}" aria-pressed="${je.items && je.items[b.id] === true}">${esc(b.label)}</button>`).join('')}</div>
    <div class="row between" style="margin-top:12px"><span class="tiny faint">${app.S.journal[jd] ? 'Gespeichert' : 'Noch nicht ausgefüllt'}</span><button class="btn sm" data-act="sub" data-v="tagebuch">Alle Fragen & Einblicke</button></div>`);
  h += `</div>`;
  // Stress heute
  const sts = app.S.stressTs;
  if (sts && sts.date === d && sts.pts && sts.pts.length >= 5) {
    h += card('Stressverlauf', queueChart(el => chartLine(el, sts.pts.map(p => ({ x: p[0], y: p[1] })), { color: 'var(--warn)', yMin: 0, yMax: 100, h: 150, xFmt: v => pad2(Math.floor(v / 60)) + ':' + pad2(v % 60), tipX: v => pad2(Math.floor(v / 60)) + ':' + pad2(v % 60) + ' Uhr', tipFmt: v => 'Stress ' + fmt(v), label: 'Stress im Tagesverlauf' })), { right: 'COROS 0–100' });
  }
  // 7-Tage-Erholung
  const last7 = dateRange(addDays(d, -6), d);
  h += card('Erholung · 7 Tage', queueChart(el => chartBars(el, last7.map(k => ({ x: k, y: A.D[k] ? A.D[k].recovery : null, color: zoneColor(A.D[k] && A.D[k].zone), note: A.D[k] && isNum(A.D[k].strain) ? 'Belastung ' + fmt(A.D[k].strain, 1) : '' })), { yMax: 100, h: 150, tipFmt: v => fmt(v) + ' % Erholung', label: 'Erholung der letzten 7 Tage' })));
  return h;
}

/* ---------- Ansicht: Schlaf ---------- */
function viewSchlaf() {
  const d = app.date, A = app.A, r = A.D[d] || {}, x = app.S.days[d] || {}, sl = x.sleep || {};
  let h = bannerHtml();
  const debt = isNum(r.sleepMin) ? Math.max(0, r.need - r.sleepMin) : null;
  h += `<section class="card"><div class="row" style="gap:18px;align-items:center">
    <div style="width:132px;flex:none">${ring({ frac: (r.sleepPerf || 0) / 100, color: 'var(--sleep)', value: isNum(r.sleepPerf) ? fmt(r.sleepPerf) : '–', unit: isNum(r.sleepPerf) ? '% Leistung' : '', label: 'Schlafleistung' })}</div>
    <div style="min-width:0"><div class="eyebrow">Nacht auf ${esc(fDay(d))}</div>
      <div class="num" style="font-size:34px;font-weight:720;margin:4px 0">${isNum(r.sleepMin) ? fmtHM(r.sleepMin) + ' h' : '–'}</div>
      <div class="muted small">von <b class="num">${fmtHM(r.need)} h</b> Schlafbedarf${isNum(sl.score) ? ' · COROS-Schlafscore <b class="num">' + fmt(sl.score) + '</b>' : ''}</div>
      ${isNum(sl.napMin) && sl.napMin > 0 ? `<div class="small faint">inkl. ${fmtDur(sl.napMin)} Nickerchen</div>` : ''}
    </div></div></section>`;
  h += `<div class="grid2">`;
  h += card('Schlafphasen', stagesBar(sl));
  const kv = [
    ['Konsistenz', isNum(r.consistency) ? fmt(r.consistency) : '–', '%', 'Schlafzeiten der letzten 4 Nächte'],
    ['Effizienz', isNum(r.efficiency) ? fmt(r.efficiency) : '–', '%', 'Schlafzeit / Zeit im Bett'],
    ['Erholsamer Schlaf', isNum(r.restorative) ? fmt(r.restorative) : '–', '%', 'Tief- + REM-Anteil'],
    ['Schlafschuld', isNum(debt) ? fmtHM(debt) : '–', 'h', 'Bedarf minus Schlaf'],
    ['Eingeschlafen', r.bed != null ? clockFromNoon(r.bed) : '–', '', ''],
    ['Aufgewacht', r.wake != null ? clockFromNoon(r.wake) : '–', '', '']
  ];
  h += card('Kennzahlen', `<div class="kv">${kv.map(k => `<div><div class="v">${k[1]}<small>${k[2]}</small></div><div class="l">${k[0]}${k[3] ? ' · ' + k[3] : ''}</div></div>`).join('')}</div>`);
  // Bedarf
  h += card('So setzt sich dein Schlafbedarf zusammen', `<div class="metrics">
    <div class="metric"><div class="ml"><div class="t">Grundbedarf</div><div class="s">in den Einstellungen änderbar</div></div><div></div><div class="mv">${fmtHM(r.needBase)}<small>h</small></div></div>
    <div class="metric"><div class="ml"><div class="t">+ Belastung am Vortag</div><div class="s">mehr Belastung braucht mehr Regeneration</div></div><div></div><div class="mv">${fmt(r.needStrain)}<small>min</small></div></div>
    <div class="metric"><div class="ml"><div class="t">+ Schlafschuld</div><div class="s">Defizit der letzten 3 Nächte, gewichtet</div></div><div></div><div class="mv">${fmt(r.needDebt)}<small>min</small></div></div>
    <div class="metric"><div class="ml"><div class="t"><b>= Bedarf</b></div></div><div></div><div class="mv">${fmtHM(r.need)}<small>h</small></div></div></div>`);
  // Planer
  const next = needForNight(addDays(d, 1));
  const wake = profileForView().wakeTime || '07:00'; const wm = minuteOfDay(wake) ?? 420;
  const rowsP = [['Spitzenleistung', 1.0], ['Leistung', 0.85], ['Minimum', 0.7]].map(([l, f]) => { const b = ((wm - next.total * f - 15) % 1440 + 1440) % 1440; return `<div class="metric"><div class="ml"><div class="t">${l}</div><div class="s">${fmt(f * 100)} % des Bedarfs · ${fmtHM(next.total * f)} h Schlaf</div></div><div></div><div class="mv">${pad2(Math.floor(b / 60))}:${pad2(Math.round(b % 60) % 60)}<small>Uhr</small></div></div>`; }).join('');
  h += card('Schlafplaner · heute Nacht', `<div class="row wrap-row" style="gap:12px;margin-bottom:6px"><div class="field" style="max-width:180px"><label for="wakeTime">Weckzeit morgen</label><input type="time" id="wakeTime" value="${esc(wake)}" data-pf="wakeTime"></div><p class="small faint" style="flex:1;min-width:180px">Bedarf heute Nacht <b class="num">${fmtHM(next.total)} h</b>. Die Zeiten rechnen 15 Minuten zum Einschlafen ein.</p></div><div class="metrics">${rowsP}</div>`);
  h += `</div>`;
  const n14 = dateRange(addDays(d, -13), d);
  h += `<div class="grid2">`;
  h += card('Schlaf · 14 Nächte', queueChart(el => chartBars(el, n14.map(k => ({ x: k, y: A.D[k] && isNum(A.D[k].sleepMin) ? A.D[k].sleepMin / 60 : null, mark: A.D[k] ? A.D[k].need / 60 : null, color: 'var(--sleep)', note: A.D[k] && isNum(A.D[k].sleepPerf) ? fmt(A.D[k].sleepPerf) + ' % Leistung · Bedarf ' + fmtHM(A.D[k].need) + ' h' : '' })), { tipFmt: v => fmtHM(v * 60) + ' h Schlaf', yFmt: v => fmt(v) + ' h', label: 'Schlafdauer der letzten 14 Nächte' })) + `<div class="legend"><span><i style="background:var(--sleep)"></i>Schlaf</span><span><i style="background:var(--ink);height:3px;vertical-align:3px"></i>Bedarf</span></div>`);
  h += card('Schlafrhythmus · 14 Nächte', queueChart(el => chartSleepRange(el, n14.map(k => ({ x: k, bed: A.D[k] ? A.D[k].bed : null, wake: A.D[k] ? A.D[k].wake : null })))) + `<p class="tiny faint" style="margin-top:6px">Gleichmäßige Zeiten verbessern Konsistenz und Bio-Alter.</p>`);
  h += `</div>`;
  return h;
}

/* ---------- Ansicht: Training ---------- */
function viewTraining() {
  const d = app.date, A = app.A, S = app.S, r = A.D[d] || {};
  let h = bannerHtml();
  const tot = (r.trimpAct || 0) + (r.trimpBg || 0);
  const sAct = tot ? r.strain * (r.trimpAct || 0) / tot : 0, sBg = tot ? r.strain * (r.trimpBg || 0) / tot : 0;
  h += `<section class="card"><div class="row" style="gap:18px;align-items:center">
    <div style="width:132px;flex:none">${ring({ frac: (r.strain || 0) / 21, color: 'var(--strain)', value: isNum(r.strain) ? fmt(r.strain, 1) : '–', unit: 'Belastung', label: 'Tagesbelastung' })}</div>
    <div style="min-width:0;flex:1"><div class="eyebrow">${esc(relDay(d))}</div>
      <div class="kv" style="margin-top:8px"><div><div class="v">${fmt(sAct, 1)}</div><div class="l">aus Training</div></div><div><div class="v">${fmt(sBg, 1)}</div><div class="l">aus Alltag & Schritten</div></div></div>
      ${r.target ? `<p class="small muted" style="margin-top:10px">Ziel heute <b class="num">${r.target[0]}–${r.target[1]}</b> bei ${zoneName(r.zone).toLowerCase()}er Erholung.</p>` : ''}
    </div></div></section>`;
  // Steuerung (ACWR)
  h += `<div class="grid2">`;
  if (isNum(r.acwr)) {
    const pos = clamp((r.acwr - 0.4) / 1.6 * 100, 0, 100);
    const txt = r.acwr < 0.8 ? 'Deine Belastung liegt unter deinem gewohnten Niveau. Fitness kann so langsam sinken.' : r.acwr <= 1.3 ? 'Optimal: Du steigerst dich in einem Tempo, das dein Körper gut verträgt.' : r.acwr <= 1.5 ? 'Erhöht: Du hast zuletzt deutlich mehr gemacht als gewohnt. Achte auf Erholung.' : 'Hoch: Sprunghafte Steigerung. Das Verletzungsrisiko steigt in diesem Bereich.';
    h += card('Belastungssteuerung', `<div class="row between"><span class="muted small">Verhältnis 7 Tage zu 28 Tagen</span><b class="num" style="font-size:22px">${fmt(r.acwr, 2)}</b></div>
      <div style="position:relative;height:12px;border-radius:6px;margin:14px 0 6px;background:linear-gradient(90deg,var(--neutral) 0 25%,var(--good) 25% 56.25%,var(--warn) 56.25% 68.75%,var(--bad) 68.75% 100%)"><div style="position:absolute;left:${pos}%;top:-6px;width:4px;height:24px;border-radius:2px;background:var(--ink);box-shadow:0 0 0 2px var(--surface);transform:translateX(-2px)"></div></div>
      <div class="tiny faint num" style="position:relative;height:16px">${[0.4, 0.8, 1.3, 1.5, 2.0].map(v => { const p = (v - 0.4) / 1.6 * 100; return `<span style="position:absolute;left:${p}%;transform:translateX(${p === 0 ? '0' : p === 100 ? '-100%' : '-50%'})">${fmt(v, 1)}</span>`; }).join('')}</div>
      <p class="small muted" style="margin-top:10px">${txt}</p>`);
  } else h += card('Belastungssteuerung', '<p class="faint small">Nach 2 Wochen mit Daten vergleicht Vagus deine akute mit der gewohnten Belastung.</p>');
  // Zonen 7 Tage
  const w7 = dateRange(addDays(d, -6), d); const z = [0, 0, 0, 0, 0]; let est = false;
  for (const k of w7) for (const a of (A.D[k] ? A.D[k].acts : [])) { if (a.zonesUsed) a.zonesUsed.forEach((v, i) => z[i] += v); if (a.zonesEstimated) est = true; }
  const z13 = z[0] + z[1] + z[2], z45 = z[3] + z[4]; const zmax = Math.max(...z, 1);
  h += card('Herzfrequenzzonen · 7 Tage', `${z.map((v, i) => `<div class="contrib" style="grid-template-columns:72px 1fr 64px"><span class="small">Zone ${i + 1}</span><div class="hbar" style="height:10px;background:var(--surface-2)"><span style="width:${(v / zmax * 100).toFixed(1)}%;background:${ZONE_COL[i]};border-radius:5px"></span></div><span class="val">${fmt(v)} min</span></div>`).join('')}
    <div class="kv" style="margin-top:10px"><div><div class="v">${fmt(z13)}<small>min</small></div><div class="l">Zone 1–3 · Ziel 150–300</div></div><div><div class="v">${fmt(z45)}<small>min</small></div><div class="l">Zone 4–5 · Ziel ≥ 75</div></div></div>
    <p class="tiny faint" style="margin-top:8px">Zonen in % deiner max. Herzfrequenz (${fmt(A.P.hrMax)} bpm): 50–60, 60–70, 70–80, 80–90, 90–100.${est ? ' Wo COROS keine Zonenzeiten liefert, schätzt Vagus sie aus dem Durchschnittspuls.' : ''}</p>`);
  h += `</div>`;
  // Aktivitäten 14 Tage
  const recent = []; for (let i = 0; i < 14; i++) { const k = addDays(d, -i); for (const a of (A.D[k] ? A.D[k].acts : []).slice().reverse()) recent.push([k, a]); }
  h += card('Aktivitäten · 14 Tage', recent.length ? `<div class="list">${recent.map(([k, a]) => actRow({ ...a, name: a.name + ' · ' + relDay(k) })).join('')}</div>` : '<p class="faint small">Keine Aktivitäten in den letzten 14 Tagen.</p>');
  // Belastung 28 Tage
  const w28 = dateRange(addDays(d, -27), d);
  h += card('Tagesbelastung · 28 Tage', queueChart(el => chartBars(el, w28.map(k => ({ x: k, y: A.D[k] ? A.D[k].strain : null, color: 'var(--strain)', note: A.D[k] && A.D[k].recovery != null ? 'Erholung ' + A.D[k].recovery + ' %' : '' })), { yMax: 21, tipFmt: v => 'Belastung ' + fmt(v, 1), label: 'Tagesbelastung der letzten 28 Tage' })));
  // Fitness
  const f = S.fitness;
  const med = vo2Median(A.P.age, A.P.sex);
  let fit = '';
  if (f) {
    fit += `<div class="kv">
      <div><div class="v">${fmt(f.vo2max, 1)}<small>ml/kg/min</small></div><div class="l">VO₂max · Altersmedian ${fmt(med, 1)}</div></div>
      ${isNum(f.runLevel) ? `<div><div class="v">${fmt(f.runLevel, 1)}</div><div class="l">Laufleistung (COROS)</div></div>` : ''}
      ${isNum(f.thresholdHr) ? `<div><div class="v">${fmt(f.thresholdHr)}<small>bpm</small></div><div class="l">Schwellenpuls</div></div>` : ''}
      ${f.thresholdPace ? `<div><div class="v" style="font-size:17px">${esc(f.thresholdPace)}</div><div class="l">Schwellentempo</div></div>` : ''}
    </div>`;
    if (f.predictions) fit += `<div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th>Wettkampfprognose</th><th>Zeit</th></tr></thead><tbody>${Object.entries(f.predictions).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
    const fh = (S.fitnessHist || []).filter(x => isNum(x.vo2max));
    if (fh.length >= 3) fit += `<div style="margin-top:12px">${queueChart(el => chartLine(el, fh.map(x => ({ x: x.date, y: x.vo2max })), { color: 'var(--age)', h: 140, tipFmt: v => 'VO₂max ' + fmt(v, 1), ref: med, refLabel: 'Altersmedian', label: 'VO2max-Verlauf' }))}</div>`;
  } else fit = '<p class="faint small">Nach der ersten Synchronisation erscheinen hier VO₂max und Wettkampfprognosen von COROS.</p>';
  h += `<div class="grid2">` + card('Fitness', fit);
  const L = S.load;
  if (L && (isNum(L.acute) || isNum(L.chronic) || L.status)) {
    h += card('COROS-Trainingslast', `<div class="kv">${isNum(L.acute) ? `<div><div class="v">${fmt(L.acute)}</div><div class="l">kurzfristig</div></div>` : ''}${isNum(L.chronic) ? `<div><div class="v">${fmt(L.chronic)}</div><div class="l">langfristig</div></div>` : ''}${isNum(L.ratio) ? `<div><div class="v">${fmt(L.ratio, 2)}</div><div class="l">Verhältnis</div></div>` : ''}</div>${tr(L.status) ? `<p class="small muted" style="margin-top:10px">COROS-Bewertung: ${esc(tr(L.status))}</p>` : ''}`);
  }
  h += `</div>`;
  return h;
}

/* ---------- Ansicht: Bio-Alter ---------- */
function viewBioAlter() {
  const H = app.H, A = app.A;
  let h = bannerHtml();
  if (H.age == null) {
    h += card('Bio-Alter', `<p class="muted">Für dein Bio-Alter braucht Vagus dein Geburtsdatum. COROS liefert es normalerweise automatisch; du kannst es auch selbst eintragen.</p><div style="margin-top:12px"><button class="btn primary" data-act="sub" data-v="profil">Geburtsdatum eintragen</button></div>`);
    return h;
  }
  const provisional = !H.unlocked && H.daysWith >= 10 && isNum(H.bioAge);
  if (!H.unlocked && !provisional) {
    h += card('Bio-Alter wird freigeschaltet', `<p class="muted">Vagus braucht mindestens 21 Tage mit Messwerten in den letzten 31 Tagen, um dein Bio-Alter zuverlässig zu schätzen.</p>
      <div class="row between small" style="margin:14px 0 6px"><span>Fortschritt</span><b class="num">${H.daysWith}/21 Tage</b></div><div class="progress"><span style="width:${clamp(H.daysWith / 21 * 100, 0, 100)}%"></span></div>
      <p class="small faint" style="margin-top:12px">Tipp: Unter Mehr → COROS-Verbindung kannst du bis zu 6 Monate Verlauf laden. Dann ist das Bio-Alter sofort verfügbar.</p>`);
    return h;
  }
  if (provisional) h += `<div class="banner info"><div class="grow"><b>Vorläufiger Wert.</b> Bisher ${H.daysWith} von 21 Tagen mit Messwerten. Ab 21 Tagen ist das Bio-Alter stabil, vorher kann es noch deutlich schwanken.<div class="progress" style="margin-top:8px"><span style="width:${clamp(H.daysWith / 21 * 100, 0, 100)}%"></span></div></div></div>`;
  const L = H.long; const diff = L.delta;
  const pace = H.pace;
  const pacePos = isNum(pace) ? clamp((pace + 1) / 4 * 100, 0, 100) : 50;
  const paceTxt = !isNum(pace) ? 'Das Alterungstempo vergleicht die letzten 30 Tage mit deinem Langzeitwert. Es erscheint, sobald etwa 6 Wochen Daten vorliegen.' : pace < 0 ? 'Dein Bio-Alter sinkt gerade. Die letzten 30 Tage sind besser als dein 6-Monats-Schnitt.' : pace < 0.9 ? 'Du alterst langsamer als der Kalender. Weiter so.' : pace <= 1.1 ? 'Du alterst etwa im Tempo des Kalenders.' : 'Du alterst gerade schneller als der Kalender. Die letzten 30 Tage sind schwächer als dein Schnitt.';
  h += `<section class="card"><div class="agehero">
    <div><div class="eyebrow">Bio-Alter · ${provisional ? 'vorläufig' : '6 Monate'}</div>
      <div class="bigage" style="margin:8px 0 6px">${fmt(H.bioAge, 1)}<small>Jahre</small></div>
      <div class="row wrap-row" style="gap:8px"><span class="pill ${diff <= 0 ? 'good' : 'bad'}"><i></i>${fmt(Math.abs(diff), 1)} Jahre ${diff <= 0 ? 'jünger' : 'älter'}</span><span class="small faint">Kalenderalter ${fmt(H.age, 1)}</span></div>
    </div>
    <div><div class="row between"><span class="eyebrow">Alterungstempo · 30 Tage</span><b class="num" style="font-size:26px">${isNum(pace) ? fmt(pace, 1) + '×' : '–'}</b></div>
      <div class="pacebar" style="margin:14px 0 6px" role="img" aria-label="Alterungstempo ${fmt(pace, 1)}">${isNum(pace) ? `<div class="mk" style="left:${pacePos}%"></div>` : ''}</div>
      <div class="row between tiny faint num"><span>−1×</span><span>0×</span><span>1×</span><span>2×</span><span>3×</span></div>
      <p class="small muted" style="margin-top:10px">${esc(paceTxt)}</p></div>
  </div></section>`;
  // Faktoren
  const S30 = H.short ? Object.fromEntries(H.short.metrics.map(m => [m.key, m])) : {};
  const maxY = Math.max(1.5, ...L.metrics.map(m => Math.abs(m.years || 0)));
  const fv = (m, v) => !isNum(v) ? '–' : m.key === 'sleepH' ? fmtHM(v * 60) + ' h' : ['z13', 'z45', 'strength'].includes(m.key) ? fmt(v) + ' min/Wo.' : m.key === 'rhr' ? fmt(v) + ' bpm' : m.key === 'vo2' ? fmt(v, 1) : fmt(v, m.dec) + (m.unit === '%' ? ' %' : '');
  let groups = '';
  for (const g of ['Schlaf', 'Belastung', 'Fitness']) {
    groups += `<div class="eyebrow" style="margin:${g === 'Schlaf' ? 0 : 16}px 0 4px">${g}</div>`;
    for (const m of L.metrics.filter(x => x.group === g)) {
      const y = m.years; const w = isNum(y) ? clamp(Math.abs(y) / maxY * 50, 1, 50) : 0;
      const s30 = S30[m.key]; const tr = s30 && isNum(s30.value) && isNum(m.value) ? (s30.years < m.years - 0.05 ? '<span class="up">▲ besser</span>' : s30.years > m.years + 0.05 ? '<span class="down">▼ schwächer</span>' : '<span class="faint">→ stabil</span>') : '';
      const tgt = m.key === 'vo2' ? 'über Altersmedian ' + fmt(vo2Median(A.P.age, A.P.sex), 1) : m.target;
      groups += `<div class="hsrow"><div style="min-width:0"><div style="font-weight:600">${esc(m.label)}</div><div class="small"><b class="num">${fv(m, m.value)}</b> <span class="faint">· 30 Tage: ${s30 ? fv(m, s30.value) : '–'}</span></div><div class="tiny faint">Ziel ${esc(tgt)}</div></div>
        <div><div class="dbar">${isNum(y) ? `<span style="${y <= 0 ? 'right:50%' : 'left:50%'};width:${w}%;background:${y <= 0 ? 'var(--younger)' : 'var(--older)'}"></span>` : ''}</div><div class="yrs">${isNum(y) ? yrs(y) : (m.key === 'lean' ? '<button class="btn sm" data-act="sub" data-v="profil" style="padding:2px 8px">eintragen</button>' : 'keine Daten')} ${tr}</div></div></div>`;
    }
  }
  h += card('Die 9 Faktoren', groups + `<div class="legend"><span><i style="background:var(--younger)"></i>macht jünger</span><span><i style="background:var(--older)"></i>macht älter</span></div>`, { right: '6 Monate · Trend 30 Tage' });
  if (H.hist.length >= 2) {
    h += card('Verlauf', queueChart(el => chartLine(el, H.hist.map(p => ({ x: p.date, y: p.bioAge })), { color: 'var(--age)', ref: H.age, refLabel: 'Kalenderalter', tipFmt: v => 'Bio-Alter ' + fmt(v, 1), yFmt: v => fmt(v, 0), label: 'Bio-Alter Verlauf' })), { right: 'wöchentlich' });
  }
  h += card('So entsteht die Zahl', `<p class="small muted">Jeder Faktor wird über Studien zur Sterblichkeit in ein relatives Risiko übersetzt und daraus in Lebensjahre umgerechnet (Sterberisiko verdoppelt sich etwa alle 8 Jahre). Weil die Faktoren zusammenhängen, zählt Vagus ihre Summe nur zu 60 %. Das ist eine fundierte Schätzung und keine medizinische Diagnose.</p><div style="margin-top:10px"><button class="btn sm" data-act="sub" data-v="methodik">Methodik & Quellen</button></div>`);
  return h;
}

/* ---------- Ansicht: Mehr (Menü) ---------- */
const SUBS = [
  ['trends', 'Trends', 'Verläufe über 7 bis 180 Tage, Wochentagsmuster'],
  ['tagebuch', 'Tagebuch & Einblicke', 'Gewohnheiten erfassen und ihre Wirkung sehen'],
  ['bericht', 'Wochen- & Monatsbericht', 'Letzte 7 oder 30 Tage im Vergleich, mit KI-Zusammenfassung'],
  ['coach', 'KI-Coach', 'Fragen zu deinen Daten stellen'],
  ['profil', 'Profil & Design', 'Alter, Herzfrequenz, Schlafbedarf, vier Designs'],
  ['verbindung', 'COROS-Verbindung', 'Synchronisieren, Verlauf laden, Diagnose'],
  ['abgleich', 'Geräteabgleich', 'Tagebuch und Einstellungen auf allen Geräten gleich halten'],
  ['methodik', 'Methodik & Quellen', 'Wie Vagus rechnet']
];
function viewMehr() {
  let h = bannerHtml();
  h += `<section class="card"><div class="list">${SUBS.map(([id, t, s]) => `<button class="li menu-li" data-act="sub" data-v="${id}"><div class="ic">${IC[{ trends: 'heute', tagebuch: 'schlaf', bericht: 'bioalter', coach: 'training', profil: 'mehr', verbindung: 'other', abgleich: 'other', methodik: 'mehr' }[id]] || IC.other}</div><div><div class="tt">${t}</div><div class="ss">${s}</div></div><div class="faint">${IC.chev}</div></button>`).join('')}</div></section>`;
  return h;
}
function subHeader(title) { return `<div class="row" style="gap:8px"><button class="btn sm" data-act="back" aria-label="Zurück">${IC.back}Mehr</button><h1 style="font-size:20px">${esc(title)}</h1></div>`; }

/* ---------- Trends ---------- */
const TREND_METRICS = [
  ['recovery', 'Erholung', d => app.A.D[d].recovery, '%', 0, 'var(--good)'],
  ['hrv', 'HRV', d => (app.S.days[d] || {}).hrv, 'ms', 0, 'var(--accent)'],
  ['rhr', 'Ruhepuls', d => (app.S.days[d] || {}).rhr, 'bpm', 0, 'var(--older)'],
  ['sleep', 'Schlafdauer', d => isNum(app.A.D[d].sleepMin) ? app.A.D[d].sleepMin / 60 : null, 'h', 1, 'var(--sleep)'],
  ['sleepPerf', 'Schlafleistung', d => app.A.D[d].sleepPerf, '%', 0, 'var(--sleep)'],
  ['consistency', 'Konsistenz', d => app.A.D[d].consistency, '%', 0, 'var(--sleep)'],
  ['strain', 'Belastung', d => app.A.D[d].strain, '', 1, 'var(--strain)'],
  ['steps', 'Schritte', d => (app.S.days[d] || {}).steps, '', 0, 'var(--strain)'],
  ['stress', 'Stress', d => (app.S.days[d] || {}).stress, '', 0, 'var(--warn)'],
  ['resp', 'Atemfrequenz', d => (app.S.days[d] || {}).resp, '/min', 1, 'var(--accent)']
];
function viewTrends() {
  const [key, label, get, unit, dec, col] = TREND_METRICS.find(m => m[0] === app.trend.metric) || TREND_METRICS[0];
  const n = app.trend.range; const end = todayStr();
  const ds = dateRange(addDays(end, -(n - 1)), end).filter(d => app.A.D[d]);
  const prev = dateRange(addDays(end, -(2 * n - 1)), addDays(end, -n)).filter(d => app.A.D[d]);
  const vals = ds.map(get), pv = prev.map(get);
  const m = mean(vals), mp = mean(pv);
  const f = v => key === 'sleep' ? fmtHM(v * 60) + ' h' : fmt(v, dec) + (unit && unit !== 'h' ? ' ' + unit : '');
  let h = subHeader('Trends');
  h += `<section class="card"><div class="chips" style="margin-bottom:12px">${TREND_METRICS.map(t => `<button class="chipbtn" data-act="trendMetric" data-v="${t[0]}" aria-pressed="${t[0] === key}">${t[1]}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Zeitraum">${[7, 30, 90, 180].map(r => `<button data-act="trendRange" data-v="${r}" aria-pressed="${r === n}">${r} Tage</button>`).join('')}</div>
    <div style="margin-top:14px">${queueChart(el => chartLine(el, ds.map(d => ({ x: d, y: get(d) })), { color: col, h: 210, tipFmt: f, yFmt: v => key === 'sleep' ? fmt(v, 0) + ' h' : fmt(v, 0), label: label + ' Verlauf' }))}</div>
    <div class="kv" style="margin-top:12px">
      <div><div class="v">${isNum(m) ? f(m) : '–'}</div><div class="l">Schnitt</div></div>
      <div><div class="v">${nums(vals).length ? f(Math.min(...nums(vals))) : '–'}</div><div class="l">Minimum</div></div>
      <div><div class="v">${nums(vals).length ? f(Math.max(...nums(vals))) : '–'}</div><div class="l">Maximum</div></div>
      <div><div class="v">${isNum(m) && isNum(mp) ? (m >= mp ? '+' : '−') + (key === 'sleep' ? fmtHM(Math.abs(m - mp) * 60) + ' h' : fmt(Math.abs(m - mp), dec)) : '–'}</div><div class="l">zu den ${n} Tagen davor</div></div>
    </div></section>`;
  // Wochentagsmuster
  const wd = [[], [], [], [], [], [], []];
  for (const d of dateRange(addDays(end, -179), end)) { if (!app.A.D[d]) continue; const v = get(d); if (isNum(v)) wd[(dateOf(d).getDay() + 6) % 7].push(v); }
  const names = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  h += card('Wochentagsmuster · 6 Monate', queueChart(el => chartBars(el, wd.map((a, i) => ({ x: names[i], y: mean(a), color: col, note: a.length + ' Tage' })), { tipFmt: f, yFmt: v => fmt(v, 0), xFmt: v => v, label: label + ' nach Wochentag' })));
  return h;
}

/* ---------- Tagebuch ---------- */
function viewTagebuch() {
  const t = todayStr();
  const jd = app.journalDate || addDays(t, -1);
  const e = app.S.journal[jd] || { items: {}, note: '' };
  let h = subHeader('Tagebuch & Einblicke');
  const days = dateRange(addDays(t, -13), t).reverse();
  h += `<section class="card"><div class="card-h"><h2>Eintrag</h2><span class="eyebrow">Abend von ${esc(fDay(jd))}</span></div>
    <div class="chips" style="margin-bottom:14px">${days.map(d => `<button class="chipbtn" data-act="jdate" data-v="${d}" aria-pressed="${d === jd}">${esc(relDay(d))}${app.S.journal[d] ? ' ✓' : ''}</button>`).join('')}</div>
    <div class="chips">${JOURNAL.map(b => `<button class="chipbtn" data-act="jtoggle" data-d="${jd}" data-v="${b.id}" aria-pressed="${e.items && e.items[b.id] === true}">${esc(b.label)}</button>`).join('')}</div>
    <div class="field" style="margin-top:14px"><label for="jnote">Notiz</label><textarea id="jnote" rows="2" data-d="${jd}" placeholder="z. B. Abendessen um 21 Uhr, Lernnacht">${esc(e.note || '')}</textarea></div>
    ${usingDemo() ? '<p class="tiny faint" style="margin-top:8px">Im Beispielmodus werden Einträge nicht gespeichert.</p>' : ''}</section>`;
  const ins = app.ins.filter(i => i.effect != null);
  const maxE = Math.max(5, ...ins.map(i => Math.abs(i.effect)));
  h += card('Was deine Erholung beeinflusst', ins.length ? ins.map(i => {
    const w = clamp(Math.abs(i.effect) / maxE * 50, 1, 50);
    return `<div class="contrib" style="grid-template-columns:minmax(110px,1.3fr) 2fr auto"><span class="small">${esc(i.label)}<br><span class="tiny faint">${i.nYes}× ja · ${i.nNo}× nein${isNum(i.sleepEffect) ? ' · Schlaf ' + (i.sleepEffect >= 0 ? '+' : '−') + fmt(Math.abs(i.sleepEffect)) + ' Pkt.' : ''}</span></span><div class="bar"><span style="${i.effect >= 0 ? 'left:50%' : 'right:50%'};width:${w}%;background:${i.effect >= 0 ? 'var(--younger)' : 'var(--older)'}"></span></div><span class="val">${i.effect >= 0 ? '+' : '−'}${fmt(Math.abs(i.effect))} Pkt.</span></div>`;
  }).join('') + `<p class="tiny faint" style="margin-top:8px">Balken: Unterschied der Erholung am Folgetag in Prozentpunkten, mit und ohne Verhalten; darunter die Wirkung auf die Schlafleistung der folgenden Nacht. Erscheint ab je 3 Tagen mit „ja“ und „nein“. Zusammenhänge sind keine Beweise.</p>` : '<p class="faint small">Fülle das Tagebuch ein paar Wochen lang aus. Sobald ein Verhalten an mindestens 3 Tagen zutraf und an 3 Tagen nicht, zeigt Vagus hier seinen Einfluss.</p>');
  return h;
}

/* ---------- Monatsbericht ---------- */
function viewBericht() {
  const t = todayStr(); const A = app.A, S = app.S; const N = app.reportRange || 30;
  const cur = periodStats(S, A, t, N), prv = periodStats(S, A, addDays(t, -N), N);
  const rows = [
    ['Erholung Ø', cur.recovery, prv.recovery, 0, ' %', 1],
    ['Belastung Ø', cur.strain, prv.strain, 1, '', 0],
    ['Schlaf Ø', cur.sleepH, prv.sleepH, 'hm', '', 1],
    ['Schlafleistung Ø', cur.sleepPerf, prv.sleepPerf, 0, ' %', 1],
    ['Schlafkonsistenz Ø', cur.consistency, prv.consistency, 0, ' %', 1],
    ['HRV Ø', cur.hrv, prv.hrv, 0, ' ms', 1],
    ['Ruhepuls Ø', cur.rhr, prv.rhr, 0, ' bpm', -1],
    ['Schritte Ø', cur.steps, prv.steps, 0, '', 1],
    ['Stress Ø', cur.stress, prv.stress, 0, '', -1],
    ['Trainings', cur.actCount, prv.actCount, 0, '', 0],
    ['Trainingszeit', cur.actMin / 60, prv.actMin / 60, 1, ' h', 0]
  ];
  const fv = (v, dec, u) => !isNum(v) ? '–' : dec === 'hm' ? fmtHM(v * 60) + ' h' : fmt(v, dec) + u;
  let h = subHeader('Wochen- & Monatsbericht');
  h += `<section class="card"><div class="seg" role="group" aria-label="Zeitraum" style="margin-bottom:14px">${[[7, 'Woche'], [30, 'Monat']].map(([v, l]) => `<button data-act="reportRange" data-v="${v}" aria-pressed="${v === N}">${l}</button>`).join('')}</div>
    <div class="card-h"><h2>Letzte ${N} Tage</h2><span class="eyebrow">bis ${esc(fDay(t))}</span></div>
    <div class="hbar" style="height:14px" role="img" aria-label="Verteilung der Erholungszonen">${['green', 'yellow', 'red'].map(z => cur[z] ? `<span style="width:${cur[z] / Math.max(1, cur.green + cur.yellow + cur.red) * 100}%;background:${zoneColor(z)}"></span>` : '').join('')}</div>
    <div class="legend"><span><i style="background:var(--good)"></i>${cur.green} grüne Tage</span><span><i style="background:var(--warn)"></i>${cur.yellow} gelbe</span><span><i style="background:var(--bad)"></i>${cur.red} rote</span></div>
    <div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th>Kennzahl</th><th>${N} Tage</th><th>davor</th><th>Änderung</th></tr></thead><tbody>
    ${rows.map(([l, a, b, dec, u, dir]) => { const dv = isNum(a) && isNum(b) ? a - b : null; const good = dv == null || dir === 0 ? '' : (dv * dir > 0 ? 'up' : dv * dir < 0 ? 'down' : ''); return `<tr><td>${l}</td><td class="num">${fv(a, dec, u)}</td><td class="num faint">${fv(b, dec, u)}</td><td class="num ${good}">${dv == null ? '–' : (Math.abs(dv) < (dec === 0 ? 0.5 : dec === 'hm' ? 1 / 120 : 0.05) ? '±0' : (dv >= 0 ? '+' : '−') + (dec === 'hm' ? fmtHM(Math.abs(dv) * 60) : fmt(Math.abs(dv), dec === 0 ? 0 : 1)))}</td></tr>`; }).join('')}
    </tbody></table></div></section>`;
  // Höhepunkte
  const ds = A.dates.filter(d => d > addDays(t, -N) && A.D[d].recovery != null);
  if (ds.length) {
    const best = ds.reduce((a, b) => A.D[b].recovery > A.D[a].recovery ? b : a), worst = ds.reduce((a, b) => A.D[b].recovery < A.D[a].recovery ? b : a);
    const topIns = app.ins.filter(i => i.effect != null).slice(0, 2);
    h += card('Auffälligkeiten', `<div class="metrics">
      <div class="metric"><div class="ml"><div class="t">Beste Erholung</div><div class="s">${esc(fDay(best))}</div></div><div></div><div class="mv">${A.D[best].recovery}<small>%</small></div></div>
      <div class="metric"><div class="ml"><div class="t">Niedrigste Erholung</div><div class="s">${esc(fDay(worst))}</div></div><div></div><div class="mv">${A.D[worst].recovery}<small>%</small></div></div>
      ${app.H.unlocked ? `<div class="metric"><div class="ml"><div class="t">Bio-Alter</div><div class="s">Alterungstempo ${fmt(app.H.pace, 1)}×</div></div><div></div><div class="mv">${fmt(app.H.bioAge, 1)}<small>J.</small></div></div>` : ''}
      ${topIns.map(i => `<div class="metric"><div class="ml"><div class="t">${esc(i.label)}</div><div class="s">Erholung am Folgetag</div></div><div></div><div class="mv">${i.effect >= 0 ? '+' : '−'}${fmt(Math.abs(i.effect))}<small>Pkt.</small></div></div>`).join('')}
    </div>`);
  }
  const ai = app.reportAi;
  h += card('KI-Zusammenfassung', `<p class="small muted">Claude fasst die letzten ${N} Tage zusammen und schlägt drei konkrete nächste Schritte vor.${app.caps.sample ? '' : ' Dafür öffnet sich die Claude-App.'}</p>
    <div id="reportOut" class="small" style="white-space:pre-wrap;margin-top:${ai ? 12 : 0}px">${ai ? esc(ai) : ''}</div>
    <div style="margin-top:12px"><button class="btn primary sm" data-act="reportAi" ${app.reportBusy ? 'disabled' : ''}>${app.reportBusy ? 'Schreibt …' : !app.caps.sample ? 'In Claude erstellen' : ai ? 'Neu erstellen' : 'Zusammenfassung erstellen'}</button></div>`);
  return h;
}

/* ---------- KI-Coach ---------- */
function coachContext() {
  const t = todayStr(), A = app.A, S = app.S, P = A.P, r = A.D[t] || {}, x = S.days[t] || {};
  const rows = dateRange(addDays(t, -13), t).map(d => { const q = A.D[d] || {}, y = S.days[d] || {}; const ac = (q.acts || []).map(a => a.name + ' ' + Math.round(a.durMin || 0) + 'min').join(' + '); return [d, q.recovery ?? '', y.hrv ?? '', y.rhr ?? '', isNum(q.sleepMin) ? (q.sleepMin / 60).toFixed(1) : '', isNum(q.sleepPerf) ? Math.round(q.sleepPerf) : '', isNum(q.strain) ? q.strain.toFixed(1) : '', y.steps ?? '', ac].join(';'); });
  const H = app.H;
  const hs = H.long ? H.long.metrics.map(m => `${m.label}: ${isNum(m.value) ? (Math.round(m.value * 10) / 10) + ' ' + m.unit : 'keine Daten'} (${isNum(m.years) ? (m.years > 0 ? '+' : '') + m.years.toFixed(1) + ' J.' : '–'})`).join('; ') : 'noch nicht verfügbar';
  const ins = app.ins.filter(i => i.effect != null).slice(0, 5).map(i => `${i.label}: ${i.effect > 0 ? '+' : ''}${i.effect.toFixed(0)} Punkte Erholung am Folgetag (${i.nYes} ja/${i.nNo} nein)`).join('; ') || 'noch keine';
  const f = S.fitness || {};
  return `Du bist der persönliche Gesundheits- und Trainingscoach in der App „Vagus“, die Daten einer COROS-Sportuhr auswertet (ähnlich wie WHOOP). Antworte auf Deutsch, klar und konkret, in höchstens 180 Wörtern, außer der Nutzer will mehr. Beziehe dich auf die Zahlen unten. Stelle keine Diagnosen; bei auffälligen Werten (z. B. Ruhepuls dauerhaft stark erhöht, SpO₂ unter 92 %, Krankheitszeichen) empfiehl ärztliche Abklärung.
${usingDemo() ? 'ACHTUNG: Das sind Beispieldaten, nicht die echten Werte des Nutzers. Weise kurz darauf hin.' : ''}
Profil: Alter ${P.age != null ? P.age.toFixed(0) : 'unbekannt'}, Geschlecht ${P.sex === 'm' ? 'männlich' : P.sex === 'f' ? 'weiblich' : 'unbekannt'}, max. Herzfrequenz ${P.hrMax}, Grund-Schlafbedarf ${fmtHM(P.sleepBase)} h.
Heute (${t}): Erholung ${r.recovery ?? 'n/v'} % (${zoneName(r.zone)}), HRV ${x.hrv ?? 'n/v'} ms (30-Tage-Schnitt ${r.hrvBase ? r.hrvBase.toFixed(0) : 'n/v'}), Ruhepuls ${x.rhr ?? 'n/v'} (Schnitt ${r.rhrBase ? r.rhrBase.toFixed(0) : 'n/v'}), Schlaf ${isNum(r.sleepMin) ? fmtHM(r.sleepMin) : 'n/v'} h bei Bedarf ${fmtHM(r.need)} h, Belastung bisher ${isNum(r.strain) ? r.strain.toFixed(1) : 'n/v'} von 21, Ziel-Belastung ${r.target ? r.target.join('–') : 'n/v'}, Verhältnis akut/chronisch ${isNum(r.acwr) ? r.acwr.toFixed(2) : 'n/v'}.
Letzte 14 Tage (Datum;Erholung %;HRV ms;Ruhepuls;Schlaf h;Schlafleistung %;Belastung 0-21;Schritte;Aktivitäten):
${rows.join('\n')}
Bio-Alter: ${H.bioAge != null ? H.bioAge.toFixed(1) : 'n/v'} (Kalenderalter ${H.age != null ? H.age.toFixed(1) : 'n/v'}), Alterungstempo ${isNum(H.pace) ? H.pace.toFixed(2) + '×' : 'n/v'}. Faktoren (6 Monate, Beitrag in Jahren): ${hs}.
Tagebuch-Einblicke: ${ins}.
Fitness: VO2max ${f.vo2max ?? 'n/v'}, Prognosen ${f.predictions ? JSON.stringify(f.predictions) : 'n/v'}.`;
}
function viewCoachExternal() {
  let h = subHeader('KI-Coach');
  const sugg = ['Warum ist meine Erholung heute so?', 'Wie hart sollte ich heute trainieren?', 'Was senkt mein Bio-Alter am schnellsten?', 'Wie kann ich meinen Schlaf diese Woche verbessern?'];
  h += `<section class="card"><p class="muted small">Stell deine Frage. Vagus öffnet dann die Claude-App und gibt deine aktuellen Werte (letzte 14 Tage, Bio-Alter, Tagebuch-Einblicke) gleich mit. Das läuft über dein Claude-Abo und kostet nichts extra.</p>
    <div class="chips" style="margin-top:12px">${sugg.map(q => `<button class="chipbtn" data-act="askClaude" data-v="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <div class="composer" style="margin-top:14px"><label for="coachIn" class="faint" hidden>Frage</label><textarea id="coachIn" rows="2" placeholder="Eigene Frage …"></textarea><button class="btn primary" data-act="askClaudeIn">In Claude fragen</button></div>
    <p class="small" id="askMsg" style="margin-top:10px">${esc(app.askMsg || '')}</p>
    <p class="tiny faint" style="margin-top:6px">Antworten sind Einschätzungen, keine ärztliche Beratung.</p></section>`;
  return h;
}
function askClaudeWith(question) {
  const q = String(question || '').trim(); if (!q) return;
  const r = askInClaude(coachContext() + '\n\nMeine Frage: ' + q);
  app.askMsg = r.long ? (r.copied ? 'Claude öffnet sich. Deine Werte sind in der Zwischenablage: im Eingabefeld lange tippen und „Einsetzen“ wählen.' : 'Claude öffnet sich. Die Werte waren zu lang für die Übergabe; bitte kopiere sie über „Diagnose kopieren“.') : 'Claude öffnet sich mit deiner Frage und deinen Werten.';
  const el = $('#askMsg'); if (el) el.textContent = app.askMsg;
}
function viewCoach() {
  if (!app.caps.sample) return viewCoachExternal();
  let h = subHeader('KI-Coach');
  const sugg = ['Warum ist meine Erholung heute so?', 'Wie hart sollte ich heute trainieren?', 'Was senkt mein Bio-Alter am schnellsten?', 'Wie kann ich meinen Schlaf diese Woche verbessern?'];
  h += `<section class="card"><div class="chat" id="chat">${app.chat.length ? app.chat.map((m, i) => `<div class="msg ${m.role === 'user' ? 'me' : 'ai'}" ${i === app.chat.length - 1 && m.role === 'assistant' && app.chatBusy ? 'id="coachLive"' : ''}>${esc(m.content)}</div>`).join('') : `<p class="muted small">Stell eine Frage zu deinen Werten. Der Coach sieht deine letzten 14 Tage, dein Bio-Alter und deine Tagebuch-Einblicke. Beim ersten Mal fragt Claude, ob Vagus dein Claude-Kontingent nutzen darf.</p>`}</div>
    ${!app.chat.length ? `<div class="chips" style="margin-top:12px">${sugg.map(s => `<button class="chipbtn" data-act="coachAsk" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <div class="composer" style="margin-top:14px"><label for="coachIn" class="faint" hidden>Frage</label><textarea id="coachIn" rows="2" placeholder="Frage an deinen Coach …"></textarea>${app.chatBusy ? `<button class="btn" data-act="coachStop">Stopp</button>` : `<button class="btn primary" data-act="coachSend">Senden</button>`}</div>
    ${app.chat.length ? `<div style="margin-top:10px"><button class="btn sm" data-act="coachClear">Neues Gespräch</button></div>` : ''}
    <p class="tiny faint" style="margin-top:10px">Antworten sind Einschätzungen, keine ärztliche Beratung.</p></section>`;
  return h;
}
const SAMPLE_COPY = {
  not_granted: 'Claude ist für Vagus nicht freigegeben. Du kannst das in den Berechtigungen dieser App ändern.',
  sampling_disabled: 'Für dein Konto ist diese Funktion nicht verfügbar.',
  rate_limited: 'Gerade zu viele Anfragen oder dein Nutzungslimit ist erreicht. Versuche es später noch einmal.',
  session_expired: 'Bitte melde dich bei Claude neu an.',
  refused: 'Claude hat diese Anfrage abgelehnt. Formuliere sie bitte anders.',
  prompt_too_large: 'Zu viele Daten für eine Anfrage.',
  upstream_error: 'Die Verbindung ist abgebrochen. Versuche es noch einmal.',
  not_declared: 'Diese Version von Vagus darf Claude nicht nutzen.',
  capability_disabled: 'In dieser Ansicht ist die KI-Funktion nicht verfügbar. Öffne Vagus direkt in Claude.',
  capability_removed: 'Diese Claude-Version unterstützt die KI-Funktion noch nicht. Aktualisiere die App.',
  empty_completion: 'Claude hat keine Antwort geliefert. Formuliere die Frage etwas einfacher.',
  invalid_request: 'Die Anfrage war fehlerhaft. Bitte lade Vagus neu.'
};
async function coachSend(text) {
  text = String(text || '').trim(); if (!text || app.chatBusy) return;
  const sample = app.caps.sample;
  app.chat.push({ role: 'user', content: text });
  if (!sample) { app.chat.push({ role: 'assistant', content: 'Der KI-Coach funktioniert nur, wenn Vagus in Claude geöffnet ist (claude.ai oder Claude-App).' }); render(); return; }
  app.chat.push({ role: 'assistant', content: 'Denkt nach …' }); app.chatBusy = true; render();
  const ctl = new AbortController(); app.chatCtl = ctl;
  const turns = [{ role: 'user', content: coachContext() }, ...app.chat.slice(0, -1).slice(-12)];
  try {
    const res = await sample(turns, { cache: false, signal: ctl.signal, onText: ({ text }) => { app.chat[app.chat.length - 1].content = text; const el = $('#coachLive'); if (el) el.textContent = text; } });
    app.chat[app.chat.length - 1].content = res.text + (res.truncated ? '\n\n(Antwort gekürzt)' : '');
  } catch (e) {
    const last = app.chat[app.chat.length - 1];
    if (e && e.code === 'cancelled') last.content = (e.text || '') + (e.text ? '\n\n(gestoppt)' : '(gestoppt)');
    else last.content = (e && e.text ? e.text + '\n\n' : '') + (SAMPLE_COPY[e && e.code] || SAMPLE_COPY.upstream_error);
  } finally { app.chatBusy = false; app.chatCtl = null; render(); const c = $('#chat'); if (c) c.lastElementChild && c.lastElementChild.scrollIntoView({ block: 'nearest' }); }
}
function reportPrompt(N) {
  const t = todayStr(); const cur = periodStats(app.S, app.A, t, N), prv = periodStats(app.S, app.A, addDays(t, -N), N);
  return coachContext() + `\n\nVergleich (letzte ${N} Tage vs. ${N} Tage davor): ${JSON.stringify({ aktuell: cur, davor: prv })}\n\nAufgabe: Schreibe einen ${N === 7 ? 'Wochenbericht' : 'Monatsbericht'} auf Deutsch mit (1) drei Sätzen Gesamtbild, (2) den zwei wichtigsten Veränderungen mit Zahlen, (3) drei konkreten, messbaren Empfehlungen für die nächsten ${N} Tage. Kein Markdown außer einfachen Aufzählungsstrichen. Höchstens 220 Wörter.`;
}
async function reportAi() {
  const sample = app.caps.sample;
  if (!sample) { const r = askInClaude(reportPrompt(app.reportRange || 30)); app.reportAi = r.long ? 'Claude öffnet sich. Die Daten sind in der Zwischenablage: im Eingabefeld lange tippen und „Einsetzen“ wählen.' : 'Claude öffnet sich und erstellt den Bericht.'; render(); return; }
  const regen = !!app.reportAi; const N = app.reportRange || 30;
  app.reportBusy = true; app.reportAi = ''; render();
  const t = todayStr(); const cur = periodStats(app.S, app.A, t, N), prv = periodStats(app.S, app.A, addDays(t, -N), N);
  const prompt = coachContext() + `\n\nVergleich (letzte ${N} Tage vs. ${N} Tage davor): ${JSON.stringify({ aktuell: cur, davor: prv })}\n\nAufgabe: Schreibe einen ${N === 7 ? 'Wochenbericht' : 'Monatsbericht'} auf Deutsch mit (1) drei Sätzen Gesamtbild, (2) den zwei wichtigsten Veränderungen mit Zahlen, (3) drei konkreten, messbaren Empfehlungen für die nächsten ${N} Tage. Kein Markdown außer einfachen Aufzählungsstrichen. Höchstens 220 Wörter.`;
  try {
    const res = await sample(prompt, { cache: regen ? { gcTime: 3600000, refresh: true } : { gcTime: 3600000 }, onText: ({ text }) => { app.reportAi = text; const el = $('#reportOut'); if (el) { el.textContent = text; el.style.marginTop = '12px'; } } });
    app.reportAi = res.text;
  } catch (e) { app.reportAi = (e && e.text ? e.text + '\n\n' : '') + (SAMPLE_COPY[e && e.code] || SAMPLE_COPY.upstream_error); }
  finally { app.reportBusy = false; render(); }
}

/* ---------- Profil & Design ---------- */
const SKINS = [
  ['auto', 'Automatisch', 'folgt Hell/Dunkel deines Geräts', ['#0d1215', '#f1f3ef', '#3d8fe8', '#9a8cf0']],
  ['nacht', 'Nacht', 'dunkles Schiefergrau', ['#0d1215', '#151c20', '#3d8fe8', '#2fbf71']],
  ['papier', 'Papier', 'hell und ruhig', ['#f1f3ef', '#ffffff', '#2a78d6', '#6250d6']],
  ['oled', 'OLED', 'tiefschwarz, maximaler Kontrast', ['#000000', '#0e0e0e', '#4f9dff', '#ffffff']],
  ['cockpit', 'Cockpit', 'Nachtblau mit Raster und Monospace', ['#07111f', '#10233b', '#59d0ff', '#a093ff']]
];
function viewProfil() {
  const P = app.real.profile; const A = app.A; const DP = profileDerived(P);
  const seen = new Map(); for (const a of Object.values(app.real.acts)) if (isNum(a.sport)) seen.set(a.sport, a.name);
  const sc = P.strengthCodes || [402];
  let h = subHeader('Profil & Design');
  if (usingDemo()) h += `<div class="banner info"><div class="grow">Diese Angaben gelten für deine echten COROS-Daten. Die Beispieldaten nutzen ein eigenes Musterprofil.</div></div>`;
  h += card('Körperdaten', `<div class="form">
    <div class="field"><label for="pf-birthday">Geburtsdatum</label><input type="date" id="pf-birthday" data-pf="birthday" value="${esc(P.birthday || '')}"><span class="hint">für Bio-Alter und Herzfrequenzzonen</span></div>
    <div class="field"><label for="pf-sex">Geschlecht</label><select id="pf-sex" data-pf="sex"><option value="">nicht angegeben</option><option value="m" ${P.sex === 'm' ? 'selected' : ''}>männlich</option><option value="f" ${P.sex === 'f' ? 'selected' : ''}>weiblich</option></select><span class="hint">für Belastungsformel und Normwerte</span></div>
    <div class="field"><label for="pf-height">Größe (cm)</label><input type="number" inputmode="numeric" id="pf-height" data-pf="heightCm" value="${esc(P.heightCm ?? '')}"></div>
    <div class="field"><label for="pf-weight">Gewicht (kg)</label><input type="number" inputmode="decimal" step="0.1" id="pf-weight" data-pf="weightKg" value="${esc(P.weightKg ?? '')}"></div>
    <div class="field"><label for="pf-hrmax">Max. Herzfrequenz</label><input type="number" inputmode="numeric" id="pf-hrmax" data-pf="hrMax" value="${esc(P.hrMax ?? '')}" placeholder="geschätzt ${DP.hrMax}"><span class="hint">leer lassen = Schätzung 208 − 0,7 × Alter</span></div>
    <div class="field"><label for="pf-lean">Magermasse (%)</label><input type="number" inputmode="decimal" step="0.1" id="pf-lean" data-pf="leanPct" value="${esc(P.leanPct ?? '')}" placeholder="z. B. 80"><span class="hint">100 − Körperfett % (Waage, DEXA, InBody)</span></div>
  </div>`);
  h += card('Schlaf & Training', `<div class="form">
    <div class="field"><label for="pf-sleep">Grund-Schlafbedarf (Minuten)</label><input type="number" inputmode="numeric" id="pf-sleep" data-pf="sleepBaseMin" value="${esc(P.sleepBaseMin ?? '')}" placeholder="465 = 7 h 45 min"><span class="hint">Erwachsene: meist 450–510</span></div>
    <div class="field"><label for="pf-wake">Übliche Weckzeit</label><input type="time" id="pf-wake" data-pf="wakeTime" value="${esc(P.wakeTime || '07:00')}"></div>
  </div>
  <div class="field" style="margin-top:14px"><label>Als Krafttraining zählen</label>
    <div class="chips">${[...new Set([402, ...seen.keys()])].sort((a, b) => a - b).map(c => `<button class="chipbtn" data-act="strength" data-v="${c}" aria-pressed="${sc.includes(c)}">${esc(sportName(c, seen.get(c)))}</button>`).join('')}</div>
    <span class="hint">Sportarten aus deinen COROS-Aktivitäten. Krafttraining fließt in das Bio-Alter ein.</span></div>`);
  h += card('Design', `<div class="skins">${SKINS.map(([id, name, desc, sw]) => `<button class="skin" data-act="skin" data-v="${id}" aria-pressed="${app.skin === id}"><div class="sw" style="background:${sw[0]}"><i style="background:${sw[1]};height:60%"></i><i style="background:${sw[2]};height:85%"></i><i style="background:${sw[3]};height:45%"></i></div><b>${name}</b><span>${desc}</span></button>`).join('')}</div>`);
  return h;
}

/* ---------- Verbindung ---------- */
function viewVerbindung() {
  let h = subHeader('COROS-Verbindung');
  const last = app.real.meta.lastSync;
  const st = app.conn;
  const hasMcp = !!app.caps.mcp;
  const err = st.state === 'error' ? (CONN_COPY[st.code] || ['COROS hat nicht geantwortet.', 'Versuche es in ein paar Minuten noch einmal.']) : null;
  h += `<section class="card"><div class="card-h"><h2>Status</h2><span class="eyebrow">${last ? 'zuletzt ' + esc(ago(last)) : 'noch nie synchronisiert'}</span></div>
    ${app.syncing ? `<p class="small" id="syncProgLbl">${esc(app.progress ? app.progress.label : 'Läuft …')}</p><div class="progress" style="margin-top:8px"><span id="syncBar" style="width:${Math.round(((app.progress && app.progress.frac) || 0) * 100)}%"></span></div>` : ''}
    ${err ? `<div class="banner err" style="margin-bottom:12px"><div class="grow"><b>${esc(err[0])}</b> ${esc(err[1])}${st.code === 'server_not_connected' ? `<div style="margin-top:8px"><a href="${CONNECT_URL}" target="_blank" rel="noopener">COROS-Konnektor in Claude öffnen</a></div>` : ''}${st.code === 'not_in_manifest' || st.code === 'approval_required' ? `<div style="margin-top:8px"><button class="btn sm" data-act="perms">Berechtigungen öffnen</button></div>` : ''}</div></div>` : ''}
    ${st.state === 'ready' && st.failed && st.failed.length ? `<div class="banner" style="margin-bottom:12px"><div class="grow">Synchronisiert. Diese Bereiche kamen ohne Daten zurück: ${esc(st.failed.join(', '))}. Details stehen unten in der Diagnose.</div></div>` : ''}
    ${!hasMcp && app.capsReady ? `<div class="banner err" style="margin-bottom:12px"><div class="grow"><b>Vagus ist außerhalb von Claude geöffnet.</b> Der Datenabruf funktioniert nur in claude.ai oder in der Claude-App.</div></div>` : ''}
    <div class="row wrap-row" style="gap:10px">
      ${IS_STANDALONE && !Coros.loggedIn()
        ? `<button class="btn primary" data-act="corosLogin" ${app.loginBusy ? 'disabled' : ''}>${app.loginBusy ? 'Öffne COROS …' : 'Mit COROS anmelden'}</button>`
        : `<button class="btn primary" data-act="sync" ${app.syncing || !hasMcp ? 'disabled' : ''}>${last ? 'Jetzt synchronisieren' : 'Mit COROS verbinden'}</button>
      <button class="btn" data-act="history" ${app.syncing || !hasMcp ? 'disabled' : ''}>Verlauf laden (6 Monate)</button>`}
    </div>
    <p class="small faint" style="margin-top:10px">Nach der ersten Verbindung lädt Vagus automatisch 6 Monate Verlauf. Danach synchronisiert die App beim Öffnen, höchstens alle 15 Minuten. „Verlauf laden“ holt die 180 Tage erneut und kann einige Minuten dauern.${app.real.meta.historyLoaded ? ' Zuletzt geladen ' + esc(ago(app.real.meta.historyLoaded)) + '.' : ''}</p>
  </section>`;
  if (IS_STANDALONE) h += card('COROS-Konto', Coros.loggedIn()
    ? `<div class="row between wrap-row" style="gap:10px"><span class="pill good"><i></i>angemeldet${Coros.region() ? ' · Server ' + esc(Coros.region()) : ''}</span><button class="btn sm" data-act="corosLogout">Abmelden</button></div>
       <p class="small faint" style="margin-top:10px">Die Anmeldung bleibt nur auf diesem Gerät gespeichert und erneuert sich automatisch.${Coros.viaRelay ? ' Die Verbindung läuft über deinen Speicherdienst.' : ''}</p>`
    : `<p class="small muted">Vagus meldet sich mit dem offiziellen COROS-Login an. Du gibst dein Passwort nur auf der Seite von COROS ein, nicht in Vagus.</p>
       <p class="small faint" style="margin-top:8px">Am iPhone: Melde dich in der <b>installierten App</b> an (Icon am Home-Bildschirm), nicht in Safari. Das iPhone speichert beide getrennt.</p>`);
  else h += card('Einrichtung in 3 Schritten', `<div class="metrics">
    <div class="metric"><div class="ml"><div class="t">1 · COROS in Claude hinzufügen</div><div class="s">Einmalig: Konnektor öffnen, „Verbinden“ wählen, mit dem COROS-Konto anmelden.</div></div><div></div><div><a class="btn sm" href="${CONNECT_URL}" target="_blank" rel="noopener">Öffnen</a></div></div>
    <div class="metric"><div class="ml"><div class="t">2 · Vagus den Zugriff erlauben</div><div class="s">Oben „Mit COROS verbinden“ tippen und den Dialog von Claude bestätigen.</div></div><div></div><div class="mv" style="font-size:14px">${app.perm === 'granted' || last ? '<span class="pill good"><i></i>erledigt</span>' : ''}</div></div>
    <div class="metric"><div class="ml"><div class="t">3 · Verlauf abwarten</div><div class="s">Startet nach der ersten Verbindung automatisch und liefert Bio-Alter und Trends.</div></div><div></div><div class="mv" style="font-size:14px">${app.real.meta.historyLoaded ? '<span class="pill good"><i></i>erledigt</span>' : ''}</div></div>
  </div>
  <details><summary>Konnektor wird nicht gefunden?</summary><p class="small muted" style="margin-top:8px">In Claude: Einstellungen → Konnektoren → „Eigenen Konnektor hinzufügen“. Name genau <b>COROS</b>, Adresse <span class="mono">https://mcpeu.coros.com/mcp</span> (EU-Konto) oder <span class="mono">https://mcp.coros.com/mcp</span>. Danach mit dem COROS-Konto anmelden.</p></details>
  <details><summary>Wo ist mein COROS-Konnektor?</summary><p class="small muted" style="margin-top:8px">Vagus ruft den Konnektor mit dem Namen <b>COROS</b> auf. Heißt er bei dir anders (z. B. „COROS MCP“), benenne ihn in Claude unter Einstellungen → Konnektoren in <b>COROS</b> um oder füge ihn wie oben beschrieben neu hinzu.</p></details>`);
  h += card('Datenquelle & Speicher', `<div class="seg" role="group" aria-label="Datenquelle">${[['auto', 'Automatisch'], ['real', 'Meine Daten'], ['demo', 'Beispieldaten']].map(([v, l]) => `<button data-act="demo" data-v="${v}" aria-pressed="${app.demoPref === v}">${l}</button>`).join('')}</div>
    <p class="small muted" style="margin-top:10px">Aktuell: <b>${usingDemo() ? 'Beispieldaten' : 'deine COROS-Daten'}</b> · ${Object.keys(app.real.days).length} Tage, ${Object.keys(app.real.acts).length} Aktivitäten gespeichert.</p>
    <p class="small faint" style="margin-top:6px">${app.storeMode === 'db' ? 'Gespeichert in deinem privaten Bereich dieser App bei Claude. Nur du siehst diese Daten, auch wenn du den Link teilst.' : IS_STANDALONE ? 'Gespeichert auf diesem Gerät. Tagebuch und Einstellungen gleichst du unter Mehr → Geräteabgleich mit deinen anderen Geräten ab.' : 'Gespeichert nur in diesem Browser.'}${app.storeErr ? ' Letzter Speicherfehler: ' + esc(app.storeErr) + '.' : ''}</p>
    <div class="row wrap-row" style="gap:10px;margin-top:12px">
      ${app.caps.downloads ? `<button class="btn sm" data-act="export">Daten exportieren (JSON)</button>` : ''}
      <label class="btn sm" for="importFile" style="cursor:pointer">Daten importieren</label><input type="file" id="importFile" accept="application/json,.json" hidden>
      ${app.confirmDelete ? `<span class="small">Wirklich alle gespeicherten Daten löschen?</span><button class="btn sm danger" data-act="delYes">Ja, löschen</button><button class="btn sm" data-act="delNo">Abbrechen</button>` : `<button class="btn sm danger" data-act="delAsk">Alle Daten löschen</button>`}
    </div><p class="small" id="expMsg" style="margin-top:8px"></p>`);
  // Diagnose
  const tools = Object.keys(app.toolStatus);
  h += card('Diagnose', tools.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>COROS-Werkzeug</th><th>Status</th><th>Anzahl</th></tr></thead><tbody>${tools.map(t => { const s = app.toolStatus[t]; return `<tr><td class="mono wrapcell" style="font-size:11.5px">${esc(t)}</td><td>${s.ok ? '<span class="pill good"><i></i>ok</span>' : `<span class="pill bad"><i></i>${esc(s.code)}</span>`}</td><td class="num">${s.ok ? s.n : '–'}</td></tr>`; }).join('')}</tbody></table></div>
    ${tools.map(t => { const r = app.raw[t]; if (!r) return ''; return `<details><summary class="small">${esc(t)} · Rohdaten</summary><div class="tiny faint mono" style="margin-top:6px">Eingabe: ${esc(JSON.stringify(r.input))}</div>${r.error ? `<div class="tiny" style="color:var(--bad);margin-top:4px">${esc(r.error)}</div>` : ''}<pre class="raw">${esc(r.text || '(leer)')}</pre></details>`; }).join('')}
    <div style="margin-top:12px"><button class="btn sm" data-act="copyDiag">Diagnose kopieren</button> <span class="small faint" id="copyMsg"></span></div>
    <p class="tiny faint" style="margin-top:8px">Fehlt ein Wert, kopiere die Diagnose und schicke sie Claude im Chat. Dann lässt sich die Auswertung an das Antwortformat von COROS anpassen.</p>` : '<p class="faint small">Nach der ersten Synchronisation siehst du hier, welche COROS-Werkzeuge geantwortet haben, inklusive Rohdaten.</p>');
  return h;
}

/* ---------- Geräteabgleich ---------- */
function viewAbgleich() {
  let h = subHeader('Geräteabgleich');
  const on = Sync.ready(); const st = Sync.state;
  const status = !on ? '' : st.s === 'error' ? `<div class="banner err" style="margin-bottom:12px"><div class="grow">${esc(st.msg)}</div></div>` : `<p class="small"><span class="pill good"><i></i>aktiv</span> <span class="faint">${st.at ? 'zuletzt abgeglichen ' + esc(ago(st.at)) : 'noch nicht abgeglichen'}</span></p>`;
  h += card('So funktioniert es', `<p class="small muted">Tagebuch und deine eigenen Angaben (Magermasse, Weckzeit, Schlafbedarf …) werden zwischen Claude, Browser und iPhone abgeglichen. Vor dem Hochladen verschlüsselt Vagus alles mit deinem Passwort. Dein Speicherdienst sieht nur unlesbaren Datensalat. Die COROS-Werte holt jedes Gerät ohnehin selbst.</p>
    <p class="small faint" style="margin-top:8px">Passwort gut aufbewahren: Ohne es lassen sich die Einträge auf einem neuen Gerät nicht entschlüsseln. Niemand kann es zurücksetzen.</p>`);
  if (Sync.needsPassword()) {
    h += card('Passwort eingeben', `${st.msg ? `<div class="banner err" style="margin-bottom:12px"><div class="grow">${esc(st.msg)}</div></div>` : ''}
      <div class="field"><label for="syncPass">Passwort für die Verschlüsselung</label><input id="syncPass" type="password" autocomplete="current-password" placeholder="mindestens 8 Zeichen"></div>
      <div class="row wrap-row" style="gap:10px;margin-top:12px"><button class="btn primary" data-act="syncUnlock" ${app.syncBusy ? 'disabled' : ''}>Entsperren</button>
      ${app.confirmReset ? `<span class="small">Alte abgeglichene Daten werden durch die dieses Geräts ersetzt. Andere Geräte brauchen danach das neue Passwort.</span><button class="btn sm danger" data-act="syncReset">Ja, mit diesem Passwort neu beginnen</button><button class="btn sm" data-act="syncResetNo">Abbrechen</button>` : `<button class="btn sm" data-act="syncResetAsk">Passwort vergessen? Neu beginnen</button>`}
      <button class="btn sm danger" data-act="syncForget">Auf diesem Gerät beenden</button></div>
      <p class="small" style="margin-top:10px">${esc(app.syncMsg || '')}</p>`);
    return h;
  }
  if (on) {
    let b = status + `<div class="row wrap-row" style="gap:10px"><button class="btn primary sm" data-act="syncNow" ${app.syncBusy ? 'disabled' : ''}>${app.syncBusy ? 'Gleicht ab …' : 'Jetzt abgleichen'}</button><button class="btn sm danger" data-act="syncForget">Auf diesem Gerät beenden</button></div>`;
    if (IS_STANDALONE) {
      const code = Sync.setupCode(), conn = Sync.connectorUrl();
      b += `<div class="divider" style="margin:14px 0"></div>
        <div class="field"><label>Einrichtungscode für weitere Geräte</label><div class="row" style="gap:8px"><input readonly value="${esc(code)}" class="mono" style="font-size:12px" aria-label="Einrichtungscode"><button class="btn sm" data-act="copyText" data-text="${esc(code)}">Kopieren</button></div><span class="hint">Auf dem anderen Gerät unter Mehr → Geräteabgleich einfügen, zusammen mit deinem Passwort.</span></div>
        <div class="field" style="margin-top:12px"><label>Konnektor-Adresse für Claude</label><div class="row" style="gap:8px"><input readonly value="${esc(conn)}" class="mono" style="font-size:12px" aria-label="Konnektor-Adresse"><button class="btn sm" data-act="copyText" data-text="${esc(conn)}">Kopieren</button></div><span class="hint">In Claude: Einstellungen → Konnektoren → „Eigenen Konnektor hinzufügen“, Name <b>Vagus Sync</b>, diese Adresse einfügen. Wie ein Passwort behandeln und nicht weitergeben.</span></div>
        <p class="small" id="copyMsg2" style="margin-top:6px"></p>`;
    }
    h += card('Status', b);
  } else if (IS_STANDALONE) {
    h += card('Einrichten', `<div class="form" style="grid-template-columns:1fr">
      <div class="field"><label for="syncTarget">Adresse deines Speicherdienstes oder Einrichtungscode</label><input id="syncTarget" value="${esc(app.syncTarget || '')}" placeholder="https://vagus-sync.deinname.workers.dev  oder  vagus1:…" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="hint">Erstes Gerät: die Adresse aus Cloudflare. Jedes weitere Gerät: den Einrichtungscode vom ersten Gerät.</span></div>
      <div class="field"><label for="syncPass">Passwort für die Verschlüsselung</label><input id="syncPass" type="password" autocomplete="new-password" placeholder="mindestens 8 Zeichen"><span class="hint">Auf allen Geräten dasselbe Passwort verwenden.</span></div>
    </div><div style="margin-top:12px"><button class="btn primary" data-act="syncSetup" ${app.syncBusy ? 'disabled' : ''}>Abgleich einrichten</button></div><p class="small" style="margin-top:10px">${esc(app.syncMsg || '')}</p>
    <details><summary>Noch keinen Speicherdienst?</summary><ol class="small muted" style="margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>Öffne <a href="${DEPLOY_URL}" target="_blank" rel="noopener">diesen Cloudflare-Link</a> und melde dich bei Cloudflare an.</li>
      <li>Verbinde bei Nachfrage dein GitHub-Konto und tippe auf <b>Create and deploy</b>. Cloudflare richtet alles selbst ein.</li>
      <li>Kopiere am Ende die Adresse, die auf <b>.workers.dev</b> endet, und füge sie oben ein.</li></ol></details>`);
  } else {
    h += card('Einrichten in Claude', `<div class="metrics">
      <div class="metric"><div class="ml"><div class="t">1 · Konnektor hinzufügen</div><div class="s">In Claude: Einstellungen → Konnektoren → „Eigenen Konnektor hinzufügen“. Name genau <b>Vagus Sync</b>, als Adresse die „Konnektor-Adresse für Claude“ aus der iPhone- oder Browser-App (Mehr → Geräteabgleich).</div></div><div></div><div></div></div>
      <div class="metric"><div class="ml"><div class="t">2 · Passwort eingeben</div><div class="s">Dasselbe Passwort wie auf deinen anderen Geräten.</div></div><div></div><div></div></div></div>
      <div class="field" style="margin-top:10px"><label for="syncPass">Passwort für die Verschlüsselung</label><input id="syncPass" type="password" autocomplete="current-password" placeholder="mindestens 8 Zeichen"></div>
      <div style="margin-top:12px"><button class="btn primary" data-act="syncSetup" ${app.syncBusy ? 'disabled' : ''}>Abgleich einrichten</button></div><p class="small" style="margin-top:10px">${esc(app.syncMsg || '')}</p>`);
  }
  return h;
}
/** Nach der Einrichtung: Schlüssel in Claude privat sichern, damit andere Claude-Geräte ihn kennen */
async function onSyncConfigured(cfg) {
  if (store.db && cfg && cfg.mode === 'mcp') { try { await store.col().doc('sync').set({ cfg: { mode: 'mcp', raw: cfg.raw, salt: cfg.salt } }); } catch (e) { } }
}
function onSyncMerged() { store.soon(); recompute(); render(); }
async function importFile(file) {
  const msg = $('#expMsg');
  try {
    const d = JSON.parse(await file.text());
    if (!d || typeof d !== 'object' || !(d.days || d.journal || d.acts)) throw new Error('kein Vagus-Export');
    const R = app.real; let n = 0;
    for (const [k, v] of Object.entries(d.days || {})) if (v && (!R.days[k] || (v._at || 0) > (R.days[k]._at || 0))) { R.days[k] = v; store.markDay(k); n++; }
    for (const [k, v] of Object.entries(d.acts || {})) if (v && v.date && (!R.acts[k] || (v._at || 0) > (R.acts[k]._at || 0))) { R.acts[k] = v; store.markDay(v.date); }
    for (const [k, v] of Object.entries(d.journal || {})) if (v && (!R.journal[k] || (v._at || 1) > (R.journal[k]._at || 0))) { R.journal[k] = Object.assign({ _at: 1 }, v); store.markJournal(k); n++; }
    const P = R.profile; const dp = d.profile || {}; const man = dp._manual || {};
    for (const k of Object.keys(man)) if (man[k] && !(P._manual || {})[k] && dp[k] != null) { P[k] = dp[k]; P._manual = Object.assign({}, P._manual, { [k]: true }); P._ts = Object.assign({}, P._ts, { [k]: (dp._ts || {})[k] || Date.now() }); }
    store.mark('profile'); await store.flush(); Sync.soon(500); recompute(); render();
    const m2 = $('#expMsg'); if (m2) m2.textContent = 'Import abgeschlossen: ' + n + ' Tage und Tagebucheinträge übernommen.';
  } catch (e) { if (msg) msg.textContent = 'Diese Datei konnte nicht gelesen werden. Wähle eine Export-Datei von Vagus (.json).'; }
}

/* ---------- Methodik ---------- */
function viewMethodik() {
  let h = subHeader('Methodik & Quellen');
  const sec = (t, b) => `<section class="card"><h2 style="font-size:17px;margin-bottom:8px">${t}</h2><div class="small muted" style="display:flex;flex-direction:column;gap:8px;max-width:72ch">${b}</div></section>`;
  h += sec('Erholung (0–100 %)', `<p>Vagus vergleicht die nächtliche HRV deiner Uhr mit deinem eigenen 30-Tage-Schnitt (auf logarithmischer Skala, weil HRV schief verteilt ist), ebenso Ruhepuls, Schlafleistung und – wenn vorhanden – Atemfrequenz. Gewichtung: HRV 55 %, Ruhepuls 25 %, Schlaf 15 %, Atmung 5 %. Die Summe wird über eine S-Kurve auf 0–100 % abgebildet; ein durchschnittlicher Tag landet bei etwa 58 %. Grün ab 67 %, Rot bis 33 %.</p><p>Die ersten 4 Nächte mit HRV dienen der Kalibrierung.</p>`);
  h += sec('Belastung (0–21)', `<p>Jede Aktivität wird mit dem TRIMP nach Banister bewertet: Dauer × Herzfrequenzreserve × exponentieller Gewichtung. Krafttraining bekommt 60 % Aufschlag, weil der Puls die muskuläre Arbeit unterschätzt. Alltagsbewegung zählt über die Schritte. Die Summe wird logarithmisch auf 0–21 gestaucht: Jeder weitere Punkt kostet mehr Aufwand als der vorige.</p><p>Das Belastungsziel richtet sich nach der Erholung (Rot 4–10, Gelb 10–14, Grün 14–18) und sinkt um 2, wenn das Verhältnis von 7- zu 28-Tage-Last über 1,4 liegt.</p>`);
  h += sec('Schlaf', `<p>Schlafbedarf = Grundbedarf + Zuschlag für die Belastung des Vortags (bis 50 min) + Abbau von Schlafschuld der letzten 3 Nächte (bis 90 min). Schlafleistung = geschlafene Zeit ÷ Bedarf. Konsistenz bewertet die Streuung von Einschlaf- und Aufwachzeit über 4 Nächte.</p>`);
  h += sec('Bio-Alter & Alterungstempo', `<p>Neun Faktoren (wie bei WHOOP Healthspan): Schlafkonsistenz, Schlafdauer, Zeit in Zone 1–3 und 4–5, Krafttraining, Schritte, VO₂max, Ruhepuls und Magermasse. Für jeden Faktor liefert eine große Studie das relative Sterberisiko gegenüber einem Durchschnittswert. Dieses Risiko wird mit der Gompertz-Regel (Sterberisiko verdoppelt sich etwa alle 8 Jahre) in Lebensjahre umgerechnet. Weil die Faktoren sich überschneiden, zählt die Summe zu 60 %.</p><p>Das Bio-Alter nutzt 6 Monate. Das Alterungstempo vergleicht die letzten 30 Tage damit: 1× heißt Kalendertempo, 0× heißt Stillstand, negative Werte heißen, dass dein Bio-Alter gerade sinkt.</p>
    <ul style="margin:0;padding-left:18px">${HS_METRICS.map(m => `<li><b>${esc(m.label)}</b>: ${esc(m.src)}</li>`).join('')}<li><b>VO₂max-Normwerte</b>: FRIEND-Register (Kaminsky et al., Mayo Clin Proc 2015)</li></ul>`);
  h += sec('Grenzen', `<p>Vagus ist kein Medizinprodukt. COROS misst anders als WHOOP (keine Hauttemperatur, HRV nur nachts), deshalb sind die Zahlen nicht direkt mit einem WHOOP-Konto vergleichbar. Herzfrequenzzonen schätzt Vagus aus dem Durchschnittspuls, wenn COROS keine Zonenzeiten liefert.</p>`);
  return h;
}

/* ---------- Rahmen & Navigation ---------- */
const TABS = [['heute', 'Heute'], ['schlaf', 'Schlaf'], ['training', 'Training'], ['bioalter', 'Bio-Alter'], ['mehr', 'Mehr']];
const SUB_IDS = SUBS.map(s => s[0]);
function renderTop() {
  const t = todayStr();
  const dateNav = ['heute', 'schlaf', 'training'].includes(app.view) && !app.sub;
  const chip = (() => {
    if (app.syncing) return ['busy', app.progress ? app.progress.label : 'Synchronisiere …'];
    if (app.conn.state === 'error') return ['err', 'Verbindung prüfen'];
    if (usingDemo()) return ['demo', 'Beispieldaten'];
    return ['ok', 'COROS · ' + ago(app.real.meta.lastSync)];
  })();
  $('#top').innerHTML = `<div class="top-in">
    <div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h4l2-6 4 13 3-9 2 2h5" style="stroke:var(--accent)"/></svg><span>Vagus</span></div>
    ${dateNav ? `<div class="datenav"><button data-act="day" data-v="-1" aria-label="Vorheriger Tag">‹</button><span class="dl">${esc(relDay(app.date))}</span><button data-act="day" data-v="1" aria-label="Nächster Tag" ${app.date >= t ? 'disabled' : ''}>›</button></div>` : '<div style="margin-left:auto"></div>'}
    <button class="chip-sync ${chip[0]}" data-act="sub" data-v="verbindung" aria-label="${esc('Verbindungsstatus: ' + chip[1])}"><span class="dot"></span><span class="lbl" id="syncLbl">${esc(chip[1])}</span></button>
  </div>`;
}
function renderTabs() {
  $('#tabs').innerHTML = `<div class="tabs-in">${TABS.map(([id, l]) => `<button class="tab" data-act="tab" data-v="${id}" ${app.view === id ? 'aria-current="page"' : ''}>${IC[id]}<span>${l}</span></button>`).join('')}</div>`;
}
function render() {
  if (!app.A) recompute();
  applySkin();
  renderTop(); renderTabs();
  app.charts = [];
  let h = '';
  try {
    if (app.sub) h = { trends: viewTrends, tagebuch: viewTagebuch, bericht: viewBericht, coach: viewCoach, profil: viewProfil, verbindung: viewVerbindung, abgleich: viewAbgleich, methodik: viewMethodik }[app.sub]();
    else h = { heute: viewHeute, schlaf: viewSchlaf, training: viewTraining, bioalter: viewBioAlter, mehr: viewMehr }[app.view]();
  } catch (e) { h = `<div class="banner err"><div class="grow"><b>Diese Ansicht konnte nicht geladen werden.</b> ${esc(e && e.message)}</div></div>`; }
  const main = $('#view');
  const ta = document.activeElement && document.activeElement.id; // Fokus erhalten
  main.innerHTML = h;
  drawCharts();
  if (ta) { const el = document.getElementById(ta); if (el && el.focus && /coachIn|jnote/.test(ta)) el.focus(); }
}
function applySkin() {
  const root = document.documentElement;
  if (app.skin === 'auto') root.removeAttribute('data-skin'); else root.setAttribute('data-skin', app.skin);
}
function setHash(tok) { try { history.replaceState(null, '', '#' + tok); } catch (e) { } }
function go(view) { app.view = view; app.sub = null; setHash(view); render(); window.scrollTo(0, 0); }
function openSub(id) { app.sub = id; app.view = 'mehr'; setHash(id); render(); window.scrollTo(0, 0); }

/* ---------- Ereignisse ---------- */
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, v = t.dataset.v;
  switch (a) {
    case 'tab': go(v); break;
    case 'sub': openSub(v); break;
    case 'back': app.sub = null; app.view = 'mehr'; setHash('mehr'); render(); break;
    case 'scroll': { const el = document.getElementById(v); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
    case 'day': { const nd = addDays(app.date, +v); if (nd <= todayStr()) { app.date = nd; render(); } break; }
    case 'sync': sync('quick'); break;
    case 'history': sync('history'); break;
    case 'perms': try { await app.caps.perms.manage(); } catch (e) { } break;
    case 'jtoggle': {
      const d = t.dataset.d; const J = (usingDemo() ? app.demo : app.real).journal; const e = J[d] || (J[d] = { items: {}, note: '' });
      e.items = Object.assign({}, e.items); e.items[v] = !(e.items[v] === true); e._at = Date.now();
      if (!usingDemo()) { store.markJournal(d); store.soon(); Sync.soon(); }
      recompute(); render(); break;
    }
    case 'jdate': app.journalDate = v; render(); break;
    case 'trendMetric': app.trend.metric = v; saveUi(); render(); break;
    case 'trendRange': app.trend.range = +v; saveUi(); render(); break;
    case 'skin': app.skin = v; saveUi(); render(); break;
    case 'demo': app.demoPref = v; saveUi(); recompute(); render(); break;
    case 'strength': {
      const P = app.real.profile; const c = +v; const s = new Set(P.strengthCodes || [402]);
      s.has(c) ? s.delete(c) : s.add(c); P.strengthCodes = [...s]; P._manual = Object.assign({}, P._manual, { strengthCodes: true }); P._ts = Object.assign({}, P._ts, { strengthCodes: Date.now() });
      store.mark('profile'); store.soon(); Sync.soon(); recompute(); render(); break;
    }
    case 'coachAsk': coachSend(v); break;
    case 'askClaude': askClaudeWith(v); break;
    case 'askClaudeIn': { const el = $('#coachIn'); askClaudeWith(el ? el.value : ''); break; }
    case 'corosLogin': app.loginBusy = true; render(); try { await Coros.login(); } catch (e) { app.loginBusy = false; app.conn = { state: 'error', code: (e && e.code) || 'oauth_failed', msg: e && e.message }; render(); } break;
    case 'corosLogout': Coros.logout(); app.conn = { state: 'idle' }; render(); break;
    case 'syncSetup': {
      const pass = ($('#syncPass') || {}).value || ''; const target = ($('#syncTarget') || {}).value || '';
      app.syncTarget = target; app.syncMsg = 'Richte ein …'; app.syncBusy = true; render();
      try { if (IS_STANDALONE) await Sync.setupStandalone(target, pass); else await Sync.setupClaude(pass); app.syncMsg = 'Eingerichtet. Abgleich läuft …'; render(); await Sync.run(); app.syncMsg = ''; recompute(); }
      catch (e) { app.syncMsg = (e && e.msg) || ((e && e.code) === 'server_not_connected' ? 'Der Konnektor „Vagus Sync“ ist in Claude noch nicht hinzugefügt (siehe Schritt oben).' : 'Das hat nicht geklappt. Prüfe die Adresse und versuche es erneut.'); }
      app.syncBusy = false; render(); break;
    }
    case 'syncUnlock': case 'syncReset': {
      const pass = ($('#syncPass') || {}).value || '';
      app.syncMsg = a === 'syncReset' ? 'Beginne neu …' : 'Prüfe Passwort …'; app.syncBusy = true; render();
      try { if (a === 'syncReset') await Sync.reset(pass); else await Sync.unlock(pass); app.syncMsg = ''; await Sync.run(); recompute(); }
      catch (e) { app.syncMsg = (e && e.msg) || 'Das hat nicht geklappt. Bitte erneut versuchen.'; }
      app.syncBusy = false; app.confirmReset = false; render(); break;
    }
    case 'syncResetAsk': app.confirmReset = true; render(); break;
    case 'syncResetNo': app.confirmReset = false; render(); break;
    case 'syncNow': app.syncBusy = true; render(); await Sync.run(); app.syncBusy = false; recompute(); render(); break;
    case 'syncForget': Sync.forget(); if (store.db) { try { await store.col().doc('sync').delete(); } catch (e) { } } render(); break;
    case 'copyText': {
      const txt = t.dataset.text || ''; const m = $('#copyMsg2');
      try { await navigator.clipboard.writeText(txt); if (m) m.textContent = 'Kopiert.'; } catch (e) { if (m) m.textContent = 'Bitte markieren und kopieren: ' + txt; }
      break;
    }
    case 'coachSend': { const el = $('#coachIn'); const txt = el ? el.value : ''; if (el) el.value = ''; coachSend(txt); break; }
    case 'coachStop': if (app.chatCtl) app.chatCtl.abort(); break;
    case 'coachClear': app.chat = []; render(); break;
    case 'reportAi': reportAi(); break;
    case 'reportRange': app.reportRange = +v; app.reportAi = null; render(); break;
    case 'delAsk': app.confirmDelete = true; render(); break;
    case 'delNo': app.confirmDelete = false; render(); break;
    case 'delYes': Sync.forget(); if (store.db) { try { await store.col().doc('sync').delete(); } catch (e) { } } await store.wipe(); app.real = emptyState(); app.confirmDelete = false; app.toolStatus = {}; app.raw = {}; recompute(); render(); break;
    case 'export': {
      const msg = $('#expMsg');
      try { await app.caps.downloads.save({ filename: 'vagus-export-' + todayStr() + '.json', data: JSON.stringify(app.real, null, 2) }); if (msg) msg.textContent = 'Export gespeichert.'; }
      catch (e) { if (msg) msg.textContent = e && e.code === 'declined' ? 'Export abgebrochen.' : 'Export ist in dieser Ansicht nicht möglich.'; }
      break;
    }
    case 'copyDiag': {
      const txt = Object.entries(app.raw).map(([k, r]) => `### ${k}\nEingabe: ${JSON.stringify(r.input)}\n${r.error ? 'Fehler: ' + r.error + '\n' : ''}${(r.text || '').slice(0, 3000)}`).join('\n\n');
      const m = $('#copyMsg');
      try { await navigator.clipboard.writeText(txt); if (m) m.textContent = 'Kopiert.'; }
      catch (e) { const pre = document.querySelector('pre.raw'); if (pre) { const range = document.createRange(); range.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); } if (m) m.textContent = 'Kopieren nicht möglich – Text markieren und kopieren.'; }
      break;
    }
  }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset && el.dataset.pf) {
    const k = el.dataset.pf; const P = app.real.profile; let v = el.value;
    if (['heightCm', 'weightKg', 'hrMax', 'leanPct', 'sleepBaseMin'].includes(k)) v = v === '' ? null : parseFloat(String(v).replace(',', '.'));
    if (v === '' || v == null || (typeof v === 'number' && !isFinite(v))) delete P[k]; else P[k] = v;
    P._manual = Object.assign({}, P._manual, { [k]: true }); P._ts = Object.assign({}, P._ts, { [k]: Date.now() });
    Sync.soon();
    if (usingDemo() && k === 'wakeTime') app.demo.profile.wakeTime = v;
    store.mark('profile'); store.soon(); recompute(); render();
  }
  if (el.id === 'jnote') {
    const d = el.dataset.d; const J = (usingDemo() ? app.demo : app.real).journal; const e = J[d] || (J[d] = { items: {}, note: '' }); e.note = el.value.slice(0, 500); e._at = Date.now();
    if (!usingDemo()) { store.markJournal(d); store.soon(); Sync.soon(); }
  }
  if (el.id === 'importFile' && el.files && el.files[0]) importFile(el.files[0]);
});
document.addEventListener('keydown', ev => {
  if (ev.target && ev.target.id === 'coachIn' && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); const txt = ev.target.value; ev.target.value = ''; coachSend(txt); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || app.syncing) return;
  const last = app.real.meta.lastSync || 0;
  if (app.capsReady && app.caps.mcp && (!IS_STANDALONE || Coros.loggedIn()) && last && Date.now() - last > 15 * 60000) sync('quick');
  else if (Sync.ready()) Sync.run().then(ch => { if (ch) { recompute(); render(); } });
});
let rzT = null;
window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(drawCharts, 150); });

/* ---------- Start ---------- */
(async function boot() {
  loadUi();
  const local = store.loadLocal(); if (local) app.real = Object.assign(emptyState(), local);
  const hash = (location.hash || '').slice(1);
  if (TABS.some(t => t[0] === hash)) app.view = hash; else if (SUB_IDS.includes(hash)) { app.view = 'mehr'; app.sub = hash; }
  recompute(); render();
  Sync.load();
  if (IS_STANDALONE) {
    app.caps = standaloneCaps();
    const qs = new URLSearchParams(location.search);
    if (qs.get('code') && qs.get('state')) {
      try { await Coros.finish(qs); app.conn = { state: 'idle' }; app.real.meta.lastSync = app.real.meta.lastSync || 0; }
      catch (e) { app.conn = { state: 'error', code: (e && e.code) || 'oauth_failed', msg: e && e.message }; }
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { }
    } else if (qs.get('error')) {
      app.conn = { state: 'error', code: 'oauth_failed', msg: qs.get('error_description') || qs.get('error') };
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { }
    }
  }
  // Fähigkeiten der Claude-Umgebung
  const C = window.claude;
  if (!IS_STANDALONE && C && typeof C.use === 'function') {
    const names = ['mcp', 'db', 'user', 'sample', 'permissions', 'downloads'];
    const res = await Promise.all(names.map(n => C.use(n).catch(() => null)));
    app.caps = { mcp: res[0], db: res[1], user: res[2], sample: res[3], perms: res[4], downloads: res[5] };
  }
  app.capsReady = true;
  await store.init();
  await store.load();
  if (store.loaded || app.storeMode !== 'db') app.migrated = await store.migrate();
  // Abgleich-Schlüssel in Claude aus dem privaten Speicher holen
  if (!IS_STANDALONE && !Sync.ready() && store.db) { try { const sd = await store.col().doc('sync').get(); const c = sd.exists && sd.data() && sd.data().cfg; if (c && c.raw) Sync.save(clone(c)); } catch (e) { } }
  recompute(); render();
  if (Sync.ready()) Sync.run().then(ch => { if (ch) { recompute(); render(); } });
  if (app.caps.mcp) {
    let st = 'prompt';
    try { st = app.caps.perms ? await app.caps.perms.state('mcp:' + SERVER) : 'prompt'; } catch (e) { st = 'prompt'; }
    app.perm = st;
    const last = app.real.meta.lastSync || 0;
    // Bereits verbunden (oder Freigabe erteilt) → automatisch aktualisieren
    const known = last || app.migrated;
    if ((st === 'granted' || (known && st !== 'denied' && st !== 'unavailable')) && Date.now() - last > 15 * 60000) sync(app.real.meta.historyLoaded || !last ? 'quick' : 'history');
    else render();
  } else render();
})();
