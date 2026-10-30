/* =====================================================================
   VAGUS · Rechenlogik (Parser, Analysen, Bio-Alter, Demo-Daten)
   Reine Funktionen ohne DOM – in Node testbar.
   ===================================================================== */

/* ---------- Hilfsfunktionen ---------- */
const pad2 = n => String(n).padStart(2, '0');
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function dateOf(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d, 12); }
function addDays(s, n) { const d = dateOf(s); d.setDate(d.getDate() + n); return ymd(d); }
function todayStr() { return ymd(new Date()); }
function diffDays(a, b) { return Math.round((dateOf(a) - dateOf(b)) / 864e5); }
function compact(s) { return String(s).replace(/-/g, ''); }
function fromCompact(s) { s = String(s); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
function dateRange(a, b) { const out = []; if (!a || !b) return out; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const isNum = x => typeof x === 'number' && isFinite(x);
const nums = arr => arr.filter(isNum);
const mean = a => { a = nums(a); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
function sd(a) { a = nums(a); if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }
function median(a) { a = nums(a); if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; }
function sum(a) { return nums(a).reduce((s, x) => s + x, 0); }
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const ncdf = (x, m, s) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function lerpPts(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      // in log-Raum interpolieren (Hazard Ratios sind multiplikativ)
      const t = (x - x0) / (x1 - x0);
      return Math.exp(Math.log(y0) + t * (Math.log(y1) - Math.log(y0)));
    }
  }
  return pts[pts.length - 1][1];
}
function minuteOfDay(iso) { if (!iso) return null; const m = String(iso).match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
/** Minuten relativ zu 12:00 (0..1439) – vermeidet den Sprung um Mitternacht */
function fromNoon(min) { return min == null ? null : (min - 720 + 1440) % 1440; }

/* ---------- Parser für COROS-Antworten ---------- */
function normKey(k) { return String(k).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, ''); }
function parseNum(s) {
  if (isNum(s)) return s;
  if (s == null || typeof s === 'boolean') return null;
  const t = String(s).replace(/\u2212/g, '-');
  const m = t.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  // Tausendertrennzeichen: "10,234" · "10 234" · "1,234,567.5"
  const g = t.match(/-?\d{1,3}(?:(?:,|[ \u00a0\u202f])\d{3})+(?![\d,])/);
  if (g && g.index <= m.index) {
    const rest = t.slice(g.index + g[0].length).match(/^\.(\d+)/);
    return parseFloat(g[0].replace(/[, \u00a0\u202f]/g, '') + (rest ? '.' + rest[1] : ''));
  }
  const g2 = t.match(/-?\d{1,3}(?:\.\d{3}){2,}(?!\d)/);
  if (g2 && g2.index === m.index) return parseFloat(g2[0].replace(/\./g, ''));
  return parseFloat(m[0].replace(',', '.'));
}
/** Dauer in Minuten aus "7h 57min", "2:12:38", "45 min", "1 h", Zahl */
function parseDurMin(s, key) {
  if (s == null) return null;
  if (isNum(s)) {
    const k = key || '';
    if (/sec|second/.test(k)) return s / 60;
    if (/hour|hrs$/.test(k)) return s * 60;
    if (/millis|ms$/.test(k) && s > 1e5) return s / 60000;
    return s;
  }
  const t = String(s).toLowerCase(); const k = key || '';
  if (/\d{1,2}:\d{2}\s*(?:-|–|bis|to)\s*\d{1,2}:\d{2}/.test(t)) return null; // Zeitfenster, keine Dauer
  let m = t.match(/(\d+):(\d{2})(?::(\d{2}))?(?!\s*\/)/);
  if (m) {
    if (m[3] != null) return (+m[1]) * 60 + (+m[2]) + (+m[3]) / 60;
    const a = +m[1], b = +m[2];
    const hoursCtx = /sleep|nap|awake|deep|light|rem|asleep|bed/.test(k) || /\d\s*(?:h|std)\b/.test(t);
    return (!hoursCtx || a >= 24) ? a + b / 60 : a * 60 + b; // mm:ss bzw. h:mm
  }
  const h = t.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|std\.?|stunden?)(?![a-z])/);
  const mi = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minutes?|minuten?)(?![a-z])/);
  const se = t.match(/(\d+)\s*(?:s|sec|secs|seconds?|sek)(?![a-z])/);
  if (h || mi || se) return (h ? parseFloat(h[1].replace(',', '.')) * 60 : 0) + (mi ? parseFloat(mi[1].replace(',', '.')) : 0) + (se ? (+se[1]) / 60 : 0);
  return parseNum(t);
}
function pctOf(v, key) {
  if (v == null) return null;
  const m = String(v).match(/(-?\d+(?:[.,]\d+)?)\s*%/);
  if (m) return parseFloat(m[1].replace(',', '.'));
  if (isNum(v)) { if (v <= 1 && /ratio|pct|percent|rate/.test(key || '')) return v * 100; return v; }
  return null;
}
const RX_DATE = /(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})|\b((?:19|20)\d{2})(\d{2})(\d{2})\b|\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/;
const RX_DATE_G = new RegExp(RX_DATE.source, 'g');
function findDate(s) {
  if (s == null) return null;
  const m = String(s).match(RX_DATE);
  if (!m) return null;
  let y, mo, d;
  if (m[1]) { y = m[1]; mo = m[2]; d = m[3]; } else if (m[4]) { y = m[4]; mo = m[5]; d = m[6]; } else { y = m[9]; mo = m[8]; d = m[7]; }
  mo = +mo; d = +d;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || +y < 1900 || +y > 2100) return null;
  return y + '-' + pad2(mo) + '-' + pad2(d);
}
function countDates(s) { return (String(s).match(RX_DATE_G) || []).length; }
function tsOrDate(v) {
  if (isNum(v)) {
    if (v > 1e12) return ymd(new Date(v));
    if (v > 1e9) return ymd(new Date(v * 1000));
    if (v > 19000101 && v < 21001231) return fromCompact(v);
    return null;
  }
  return findDate(v);
}
function splitKv(t) {
  const s = t.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '');
  const parts = s.split(/\s+\|\s+|\s*;\s+/);
  const kv = [];
  for (const p of parts) {
    const m = p.match(/^([^:=]{1,60}?)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    // "… 18:00" ist eine Uhrzeit, kein Trennzeichen
    if (/\d$/.test(m[1]) && /^\d{2}(?!\d)/.test(m[2]) && !/[:=]\s/.test(p)) continue;
    if (!/^\d{1,2}$/.test(m[1].trim()) && /[a-zA-Z\u00c0-\u024f]/.test(m[1]) || findDate(m[1])) kv.push([m[1].trim(), m[2].trim()]);
  }
  return kv;
}
/** Text (Markdown/Klartext) → {meta, records:[{date,title,kv}]} */
function parseText(text) {
  const lines = String(text).split(/\r?\n/);
  const out = { meta: {}, records: [], notes: [] };
  let cur = null;
  const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^\|.*\|$/.test(t)) { // Markdown-Tabelle
      const rows = []; let j = i;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) { rows.push(lines[j]); j++; }
      i = j - 1;
      const header = cells(rows[0]).map(normKey);
      for (const r of rows.slice(1)) {
        if (/^[\s|:\-]+$/.test(r)) continue;
        const c = cells(r); const kv = {}; let date = null;
        c.forEach((v, idx) => { if (header[idx]) kv[header[idx]] = v; if (!date) date = findDate(v); });
        out.records.push({ date, title: c[0] || '', kv });
      }
      cur = null;
      continue;
    }
    const kvParts = splitKv(t);
    const nDates = countDates(t);
    if (nDates >= 2 && !kvParts.length) { out.meta.title = t; continue; } // "… 2026-09-19 to 2026-10-18"
    if (nDates >= 1 && !kvParts.length) { cur = { date: findDate(t), title: t, kv: {} }; out.records.push(cur); continue; }
    if (kvParts.length) {
      for (const [k, v] of kvParts) {
        const nk = normKey(k);
        const kd = findDate(k);
        if (kd && !/[a-z]{4,}/i.test(k.replace(RX_DATE, ''))) { out.records.push({ date: kd, title: k, kv: { value: v } }); cur = null; continue; }
        if (/^(date|day|datum|tag|measurementtime|measuredat)$/.test(nk) && findDate(v)) {
          if (cur && !cur.date) cur.date = findDate(v);
          else if (!cur || cur.date) { cur = { date: findDate(v), title: t, kv: {} }; out.records.push(cur); }
          (cur.kv)[nk] = v;
          continue;
        }
        (cur ? cur.kv : out.meta)[nk] = v;
      }
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(t)) { cur = { date: null, title: t, kv: {} }; out.records.push(cur); continue; }
    if (cur) { (cur.notes = cur.notes || []).push(t); } else out.notes.push(t);
  }
  return out;
}
function flatten(o, pre = '', acc = {}) {
  for (const [k, v] of Object.entries(o)) {
    const nk = pre + normKey(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, nk, acc);
    else if (Array.isArray(v)) { if (v.length <= 12 && v.every(x => isNum(x) || typeof x === 'string')) acc[nk] = v; }
    else acc[nk] = v;
  }
  return acc;
}
function dateFromKv(kv) {
  const keys = Object.keys(kv);
  const pri = keys.filter(k => /(happenday|^date$|^day$|wakedate|date$|day$)/.test(k));
  for (const k of [...pri, ...keys.filter(k => /(date|day|time|start)/.test(k))]) { const d = tsOrDate(kv[k]); if (d) return d; }
  return null;
}
/** JSON → {meta, records} – sucht Arrays von Objekten (Tageswerte, Aktivitäten) */
function jsonToRecords(obj) {
  const out = { meta: {}, records: [], notes: [] };
  const visit = (node, depth, pre) => {
    if (node == null || depth > 7) return;
    if (Array.isArray(node)) {
      if (node.length && node.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
        for (const o of node) { const kv = flatten(o); out.records.push({ date: dateFromKv(kv), title: String(kv.name || kv.sportname || kv.title || ''), kv }); }
      } else node.forEach(x => visit(x, depth + 1, pre));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === 'object') visit(v, depth + 1, pre + normKey(k));
        else out.meta[pre + normKey(k)] = v;
      }
    }
  };
  visit(obj, 0, '');
  return out;
}
/** COROS liefert Text als JSON-String ("…\\n…"): ggf. mehrfach auspacken */
function unwrapText(t) {
  t = String(t == null ? '' : t);
  for (let i = 0; i < 3 && /^\s*"/.test(t); i++) {
    try { const d = JSON.parse(t.trim()); if (typeof d !== 'string') break; t = d; } catch (e) {
      const m = t.trim().match(/^"([\s\S]*)"$/); if (!m) break;
      t = m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); break;
    }
  }
  return t;
}
/** Zeitreihe "timestamp=…, timezone=…, key=Wert" → [{ts, tz, v}] */
function parseSeries(text, key) {
  const out = []; const rx = new RegExp('timestamp=(\\d+)\\s*,\\s*timezone=(-?\\d+)[^\\n]*?\\b' + key + '=(-?\\d+(?:\\.\\d+)?)', 'g');
  let m; while ((m = rx.exec(String(text)))) out.push({ ts: +m[1], tz: +m[2], v: +m[3] });
  return out;
}
/** Ortszeit (Minuten ab Mitternacht) und Datum aus COROS-Zeitstempel; timezone in Viertelstunden */
function localOf(ts, tz) { const t = (ts + (isNum(tz) ? tz * 900 : -new Date(ts * 1000).getTimezoneOffset() * 60)) * 1000; const d = new Date(t); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
/** Ein MCP-Ergebnis in {meta, records, text} zerlegen */
function parseResult(result) {
  let text = '';
  let json = null;
  if (result && result.structuredContent && typeof result.structuredContent === 'object') json = result.structuredContent;
  if (result && Array.isArray(result.content)) text = result.content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  if (!json && result && result.payload && typeof result.payload === 'object') json = result.payload;
  if (result && typeof result.payload === 'string' && result.payload.trim()) text = result.payload;
  if (typeof result === 'string') text = result;
  text = unwrapText(text);
  if (!json && text && /^\s*[\[{]/.test(text)) { try { json = JSON.parse(text); } catch (e) { /* Klartext */ } }
  const parsed = json ? jsonToRecords(json) : parseText(text);
  // Ein JSON mit nur Metadaten und Datum → als ein Datensatz behandeln
  if (!parsed.records.length && Object.keys(parsed.meta).length) {
    const d = dateFromKv(parsed.meta);
    if (d) parsed.records.push({ date: d, title: '', kv: { ...parsed.meta } });
  }
  parsed.raw = text || (json ? JSON.stringify(json).slice(0, 20000) : '');
  return parsed;
}
/** Wert anhand Schlüssel-Mustern finden; exclude = Ausschluss-Muster */
function getv(kv, rxs, exclude) {
  if (!kv) return undefined;
  for (const rx of rxs) for (const k in kv) {
    if (rx.test(k) && !(exclude && exclude.test(k)) && kv[k] !== '' && kv[k] != null) return kv[k];
  }
  return undefined;
}
function getk(kv, rxs, exclude) {
  for (const rx of rxs) for (const k in kv) if (rx.test(k) && !(exclude && exclude.test(k)) && kv[k] !== '' && kv[k] != null) return k;
  return null;
}

/* ---- Normalisierer je COROS-Werkzeug ---- */
function pickDur(kv, rxs, exclude) { const k = getk(kv, rxs, exclude); return k ? parseDurMin(kv[k], k) : null; }
function sleepMinutesFromNum(v) { if (!isNum(v)) return v; if (v > 1440) return v / 60; if (v <= 16) return v * 60; return v; }
function parseWindow(v, recDate) {
  if (!v) return {};
  const s = String(v);
  const dt = [...s.matchAll(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/g)];
  if (dt.length >= 2) return { start: dt[0][1] + 'T' + pad2(dt[0][2]) + ':' + dt[0][3], end: dt[1][1] + 'T' + pad2(dt[1][2]) + ':' + dt[1][3] };
  const tm = [...s.matchAll(/(\d{1,2}):(\d{2})/g)];
  if (tm.length >= 2 && recDate) {
    const sMin = (+tm[0][1]) * 60 + (+tm[0][2]), eMin = (+tm[1][1]) * 60 + (+tm[1][2]);
    const sDate = sMin > eMin ? addDays(recDate, -1) : recDate;
    return { start: sDate + 'T' + pad2(tm[0][1]) + ':' + tm[0][2], end: recDate + 'T' + pad2(tm[1][1]) + ':' + tm[1][2] };
  }
  return {};
}
function normSleep(rec) {
  const kv = rec.kv; const out = {};
  out.score = parseNum(getv(kv, [/^sleepscore$/, /sleepscore/, /^score$/, /score/]));
  let main = null;
  const mk = getk(kv, [/mainsleepasleep/, /^mainsleep$/, /mainsleep(duration|time|min)?$/, /totalsleep(duration|time)?(min|minutes|sec|seconds)?$/, /asleep/, /sleepduration/, /sleeptime$/, /^duration$/, /^totaltime$/], /nap|window|start|end|score|ratio|pct|percent/);
  if (mk) main = isNum(kv[mk]) ? sleepMinutesFromNum(parseDurMin(kv[mk], mk)) : parseDurMin(kv[mk], mk);
  const dk = getk(kv, [/dailysleep/, /inclnaps/, /^sleep$/]);
  const daily = dk ? (isNum(kv[dk]) ? sleepMinutesFromNum(kv[dk]) : parseDurMin(kv[dk], dk)) : null;
  out.mainMin = main ?? daily;
  out.napMin = pickDur(kv, [/napstotal/, /naps?(total)?(duration|time)?$/, /nap/]) || 0;
  out.totalMin = daily ?? (out.mainMin != null ? out.mainMin + (out.napMin || 0) : null);
  // Hauptschlaf inkl. Wachzeit (COROS-Anteile beziehen sich auf diese Gesamtzeit)
  out.periodMin = pickDur(kv, [/mainsleepperiod/, /sleepperiod/, /inclawake/, /timeinbed/]);
  out.awakeMin = pickDur(kv, [/^awake(time|duration)?$/, /awake/, /wakeduration|wakefulness/], /count|times|number|ratio|pct|percent/);
  if (!isNum(out.periodMin) && isNum(out.mainMin) && isNum(out.awakeMin)) out.periodMin = out.mainMin + out.awakeMin;
  const pcts = {};
  const stage = (name) => {
    const k = getk(kv, [new RegExp('^' + name + '(sleep)?(ratio|pct|percent|percentage|proportion)$'), new RegExp(name + '.*(ratio|pct|percent)')]);
    const pk = k ? pctOf(kv[k], k) : null;
    const dkey = getk(kv, [new RegExp('^' + name + '(sleep)?(duration|time|min|minutes|sec|seconds)?$')], /ratio|pct|percent/);
    const dval = dkey ? kv[dkey] : null;
    const dIsPct = dval != null && /%/.test(String(dval)) && !/\d\s*(h|min)/i.test(String(dval));
    let mins = dkey && !dIsPct ? parseDurMin(dval, dkey) : null;
    let pct = pk;
    if (pct == null && dval != null && /%/.test(String(dval))) pct = pctOf(dval);
    if (pct != null) pcts[name] = pct;
    if (mins == null && pct != null && (out.periodMin || out.mainMin)) mins = pct / 100 * (out.periodMin || out.mainMin);
    if (dkey && isNum(kv[dkey]) && kv[dkey] > 1440) mins = kv[dkey] / 60;
    return mins;
  };
  out.deepMin = stage('deep'); out.lightMin = stage('light'); out.remMin = stage('rem');
  const ak = getk(kv, [/^awake(ratio|pct|percent)$/]); if (ak) pcts.awake = pctOf(kv[ak], ak);
  for (const [k, v] of Object.entries(pcts)) if (isNum(v)) out[k + 'Pct'] = v;
  out.awakeCount = parseNum(getv(kv, [/awakecount/, /wakecount/, /awakenings/]));
  // Phasen-Minuten so verteilen, dass sie zusammen die Schlafzeit ergeben (COROS rundet die Prozente)
  if (isNum(out.mainMin) && ['deep', 'light', 'rem'].every(k => isNum(pcts[k]))) {
    const ps = pcts.deep + pcts.light + pcts.rem;
    if (ps > 0) for (const k of ['deep', 'light', 'rem']) out[k + 'Min'] = pcts[k] / ps * out.mainMin;
  }
  const w = getv(kv, [/mainsleepwindow/, /sleepwindow/, /window/]);
  Object.assign(out, parseWindow(w, rec.date));
  if (!out.start) {
    const sk = getk(kv, [/sleepstart|bedtime|starttime|fallasleep|^start$/]); const ek = getk(kv, [/sleepend|waketime|wakeup|endtime|^end$/]);
    if (sk && ek) {
      const sv = kv[sk], ev = kv[ek];
      if (isNum(sv) && sv > 1e9) out.start = isoLocal(new Date(sv > 1e12 ? sv : sv * 1000));
      if (isNum(ev) && ev > 1e9) out.end = isoLocal(new Date(ev > 1e12 ? ev : ev * 1000));
      if (!out.start && typeof sv === 'string') Object.assign(out, parseWindow(sv + ' - ' + ev, rec.date));
    }
  }
  return clean(out);
}
function isoLocal(d) { return ymd(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function clean(o) { for (const k in o) if (o[k] == null || (typeof o[k] === 'number' && !isFinite(o[k]))) delete o[k]; return o; }
const EXCL_STAT = /base|range|normal|sd$|std|min$|max$|low|high|lower|upper|deviation|count|curve|series/;
function normHrv(rec) {
  const kv = rec.kv; const out = {};
  out.hrv = parseNum(getv(kv, [/^(daily)?(avg|average)?(sleep|overnight|night)?hrv(avg|average|value|ms)?$/, /(avg|average)(sleep|overnight)?hrv/, /hrv(avg|average)/, /^value$/, /hrv/], EXCL_STAT));
  const r = getv(kv, [/normalrange/, /range/, /baseline/]);
  if (r != null) { const n = String(r).match(/(\d+(?:[.,]\d+)?)\s*(?:-|–|~|to|bis)\s*(\d+(?:[.,]\d+)?)/); if (n) { out.lo = parseFloat(n[1]); out.hi = parseFloat(n[2]); } else if (isNum(parseNum(r))) out.base = parseNum(r); }
  const lo = getv(kv, [/(lower|low|min)(normal|range)?/, /range(lower|low|min)/]); const hi = getv(kv, [/(upper|high|max)(normal|range)?/, /range(upper|high|max)/]);
  if (out.lo == null && lo != null && hi != null) { out.lo = parseNum(lo); out.hi = parseNum(hi); }
  const ev = getv(kv, [/evaluation/, /assessment/, /level/]);
  if (ev != null && !isNum(ev)) out.eval = String(ev);
  if (!out.eval) { const hv = String(getv(kv, [/hrvavg|avghrv|averagehrv/]) || ''); const m = hv.match(/[—–-]\s*([A-Za-z][A-Za-z ]{2,20})$/); if (m) out.eval = m[1].trim(); }
  return clean(out);
}
function normSingle(rec, rxs) { const kv = rec.kv; return parseNum(getv(kv, [...rxs, /^value$/], EXCL_STAT)); }
function normDaily(rec) {
  const kv = rec.kv; const out = {};
  const sv = getv(kv, [/^steps?$/, /stepcount|totalsteps|dailysteps/, /steps?/], /goal|target/);
  out.steps = parseNum(sv);
  if (isNum(out.steps) && out.steps < 100 && /\d\.\d{3}(?!\d)/.test(String(sv))) out.steps = Math.round(out.steps * 1000);
  out.kcal = parseNum(getv(kv, [/^(total)?calories$/, /totalcal|activecal|kcal|calor/], /goal|target/));
  out.stress = parseNum(getv(kv, [/^(avg|average)?stress(level|avg|average)?$/, /stress/], EXCL_STAT));
  out.rhr = parseNum(getv(kv, [/resting(heartrate|hr)?/, /^rhr$/, /rhr/], EXCL_STAT));
  out.avgHr = parseNum(getv(kv, [/^(avg|average)(heartrate|hr)$/, /(avg|average)(heartrate|hr)/], EXCL_STAT));
  out.hrv = parseNum(getv(kv, [/^(avg|average)?hrv$/, /hrv/], EXCL_STAT));
  out.exerciseMin = pickDur(kv, [/workout(duration|time)|exercise(duration|time|min)?$|training(duration|time)/]);
  const sk = getk(kv, [/^sleep(duration|time)?$/, /totalsleep/]);
  if (sk) out.sleepMin = isNum(kv[sk]) ? sleepMinutesFromNum(kv[sk]) : parseDurMin(kv[sk], sk);
  return clean(out);
}
function listVal(v) {
  const m = [...String(v == null ? '' : v).matchAll(/\d{9,}\s*=\s*(-?\d+(?:\.\d+)?)/g)];
  return m.length ? mean(m.map(x => +x[1])) : parseNum(v);
}
function normCheck(parsed) {
  const kv0 = Object.assign({}, parsed.meta, ...(parsed.records.map(r => r.kv)));
  const kv = {}; for (const k in kv0) kv[k] = /list$/.test(k) ? listVal(kv0[k]) : kv0[k];
  const out = {};
  out.rhr = parseNum(getv(kv, [/resting(heartrate|hr)/]));
  out.date = tsOrDate(getv(kv, [/measurementtime|measuredat|checktime|time|date/])) || (parsed.records.find(r => r.date) || {}).date || null;
  out.resp = parseNum(getv(kv, [/respiration(rate)?/, /respiratory/, /breath/, /resp/, /brpm/], EXCL_STAT));
  out.spo2 = parseNum(getv(kv, [/spo2/, /oxygen/, /bloodoxygen/], EXCL_STAT));
  out.hr = parseNum(getv(kv, [/^(avg|average)?(heartrate|hr)(list)?$/, /heartrate/], /resting|base|range|sd$|std|deviation/));
  out.hrv = parseNum(getv(kv, [/hrv/], EXCL_STAT));
  out.stress = parseNum(getv(kv, [/stresslist/, /stress/], /level|base|range/));
  for (const k of ['resp', 'spo2', 'hr', 'hrv', 'stress']) if (isNum(out[k]) && out[k] > 1e6) delete out[k];
  return clean(out);
}
function normRecovery(parsed) {
  const kv = Object.assign({}, parsed.meta, ...(parsed.records.map(r => r.kv)));
  const out = {};
  const pk = getk(kv, [/recovery(pct|percent|percentage|rate|value)?$/, /percent/, /recovery/], /time|full|hour|level|status/);
  out.pct = pk ? pctOf(kv[pk], pk) : null;
  if (out.pct != null && out.pct <= 1 && out.pct > 0) out.pct *= 100;
  const lv = getv(kv, [/level/, /status/]); if (lv != null) out.level = String(lv);
  const ft = getv(kv, [/full/, /timeto/, /hours?/]); if (ft != null) out.full = String(ft);
  return clean(out);
}
function normFitness(parsed) {
  const kv = Object.assign({}, parsed.meta, ...(parsed.records.map(r => r.kv)));
  const out = {};
  out.vo2max = parseNum(getv(kv, [/vo2max/, /vo2/]));
  out.runLevel = parseNum(getv(kv, [/runningfitness/, /runninglevel/, /runningperformance/, /runlevel/, /^level$/]));
  const thp = getv(kv, [/threshold.*pace/, /ltpace/]); if (thp != null) out.thresholdPace = String(thp);
  out.thresholdHr = parseNum(getv(kv, [/threshold.*(hr|heart)/, /lthr/]));
  const pred = {};
  for (const k in kv) {
    let lbl = null;
    if (/halfmarathon|half|hm$|21k/.test(k)) lbl = 'Halbmarathon';
    else if (/marathon|42k/.test(k)) lbl = 'Marathon';
    else if (/(^|[^0-9])10k|10km|10000/.test(k)) lbl = '10 km';
    else if (/(^|[^0-9])5k|5km|5000/.test(k)) lbl = '5 km';
    if (lbl && /\d:\d{2}/.test(String(kv[k]))) pred[lbl] = String(kv[k]).match(/\d{1,2}:\d{2}(?::\d{2})?/)[0];
  }
  if (Object.keys(pred).length) out.predictions = pred;
  return clean(out);
}
function normLoad(parsed) {
  const kv = Object.assign({}, parsed.meta);
  const out = { daily: {} };
  out.acute = parseNum(getv(kv, [/shortterm/, /acute/, /7day/, /fatigue/], /ratio/));
  out.chronic = parseNum(getv(kv, [/longterm/, /chronic/, /28day|42day/, /fitness/], /ratio/));
  out.ratio = parseNum(getv(kv, [/loadratio/, /ratio/]));
  const st = getv(kv, [/assessment/, /status/, /comment/, /evaluation/]); if (st != null) out.status = String(st);
  const recs = parsed.records.filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
  out.history = recs.slice(0, 60).map(r => clean({ date: r.date, acute: parseNum(getv(r.kv, [/shortterm/, /acute/])), chronic: parseNum(getv(r.kv, [/longterm/, /chronic/])), ratio: parseNum(getv(r.kv, [/loadratio/, /ratio/])), comment: getv(r.kv, [/comment/, /status/, /assessment/]) }));
  if (recs[0]) { const h = out.history[0]; if (out.ratio == null && isNum(h.ratio)) out.ratio = h.ratio; if (out.status == null && h.comment != null) out.status = String(h.comment); if (h.date) out.asOf = h.date; }
  for (const r of recs) {
    const l = parseNum(getv(r.kv, [/trainingload/, /^load$/, /load/, /^value$/], /ratio|acute|chronic|short|long/));
    if (isNum(l)) out.daily[r.date] = l;
    if (out.acute == null) { const a = parseNum(getv(r.kv, [/shortterm/, /acute/])); if (isNum(a)) out.acute = a; }
    if (out.chronic == null) { const c = parseNum(getv(r.kv, [/longterm/, /chronic/])); if (isNum(c)) out.chronic = c; }
  }
  return clean(out);
}
function normUser(parsed) {
  const kv = Object.assign({}, parsed.meta, ...(parsed.records.map(r => r.kv)));
  const out = {};
  let h = parseNum(getv(kv, [/height/])); if (isNum(h)) { if (h < 3) h *= 100; if (h > 1000) h /= 10; out.heightCm = Math.round(h); }
  let w = parseNum(getv(kv, [/weight/])); if (isNum(w)) { if (w > 400) w /= 1000; out.weightKg = Math.round(w * 10) / 10; }
  const b = getv(kv, [/birthday/, /birth/, /dob/]);
  if (b != null) {
    let d = null;
    if (isNum(b)) { if (b > 19000101 && b < 21001231) d = fromCompact(b); else if (Math.abs(b) > 1e11) d = ymd(new Date(b)); else d = ymd(new Date(b * 1000)); }
    else d = findDate(String(b));
    if (d && d < todayStr()) out.birthday = d;
  }
  const g = getv(kv, [/gender/, /^sex$/]);
  if (g != null && !isNum(g)) { const s = String(g).toLowerCase(); if (/^(m|male|man|mann|männlich|herr)/.test(s)) out.sex = 'm'; else if (/^(f|w|female|woman|frau|weiblich)/.test(s)) out.sex = 'f'; }
  const mh = parseNum(getv(kv, [/max(imum)?(heartrate|hr)/])); if (isNum(mh) && mh > 120) out.hrMax = mh;
  const lt = parseNum(getv(kv, [/lthr|threshold(heartrate|hr)/])); if (isNum(lt) && lt > 100) out.lthr = lt;
  return clean(out);
}

/* ---- Sportarten ---- */
const SPORTS = {
  100: 'Laufen', 101: 'Laufband', 102: 'Trailrun', 103: 'Bahnlauf', 104: 'Wandern', 105: 'Bergtour',
  200: 'Radfahren', 201: 'Indoor-Rad', 202: 'E-Bike', 203: 'Gravel', 204: 'Mountainbike',
  300: 'Schwimmen', 301: 'Freiwasser', 400: 'Cardio (Gym)', 401: 'Cardio (GPS)', 402: 'Krafttraining',
  500: 'Ski', 501: 'Snowboard', 502: 'Langlauf', 503: 'Skitour', 700: 'Rudern', 701: 'Indoor-Rudern',
  702: 'Wildwasser', 704: 'Paddeln', 705: 'Windsurfen', 800: 'Indoor-Klettern', 801: 'Bouldern',
  900: 'Gehen', 901: 'Seilspringen', 10000: 'Triathlon', 10001: 'Multisport',
  106: 'Mehrseillänge', 205: 'E-MTB', 299: 'Radfahren', 600: 'Fliegen', 706: 'Speedsurfen', 802: 'Klettern (outdoor)',
  902: 'Treppensteigen', 903: 'Crosstrainer', 904: 'Yoga', 905: 'Pilates', 906: 'Boxen',
  1000: 'Badminton', 1001: 'Tischtennis', 1002: 'Basketball', 1003: 'Fußball', 1004: 'Pickleball', 1005: 'Tennis', 1006: 'Padel',
  1100: 'Frisbee', 1101: 'Skateboard', 1200: 'Hybrid-Fitness', 9901: 'Kraft (eigene)', 9999: 'Eigene Sportart', 10002: 'Klettern & Ski', 10003: 'Mehrseillänge', 25301: 'Strecke'
};
function sportName(code, fallback) {
  if (SPORTS[code]) return SPORTS[code];
  if (fallback) {
    const s = String(fallback).replace(/^\s*\d+[.)]\s*/, '').replace(/\s*[—–-]\s*\d{4}-\d{2}-\d{2}.*$/, '').trim();
    if (s && !/^sport\s*\(\d+\)$/i.test(s)) return s.slice(0, 40);
  }
  return code ? 'Sport ' + code : 'Aktivität';
}
function isStrength(act, strengthCodes) {
  const codes = strengthCodes || [402];
  if (isNum(act.sport)) return codes.includes(act.sport);
  return /kraft|strength|weight/i.test(act.name || '');
}
function isFootSport(act) { return [100, 101, 102, 103, 104, 105, 900].includes(act.sport) || /lauf|run|walk|geh|wander|hike|trail/i.test(act.name || ''); }
function normActivity(rec) {
  const kv = rec.kv; const out = {};
  out.id = getv(kv, [/labelid/, /activityid/, /^id$/, /label/, /recordid/]);
  if (out.id != null) out.id = String(out.id);
  let code = parseNum(getv(kv, [/^sporttype$/, /sporttypecode/, /sportcode/, /sporttype/, /^mode$/]));
  if (!isNum(code)) { const m = String(rec.title || '').match(/sport\s*\((\d+)\)|\((\d{3,5})\)/i); if (m) code = +(m[1] || m[2]); }
  out.sport = isNum(code) ? code : null;
  out.name = sportName(out.sport, getv(kv, [/sportname/, /^name$/, /^title$/]) || rec.title);
  let startV = getv(kv, [/starttime/, /^start$/, /begintime/, /^time$/]);
  if (startV == null) { for (const k in kv) { const m = String(k + '=' + kv[k]).match(/starttimestamp\s*=\s*(\d{9,})/i); if (m) { startV = +m[1]; break; } } }
  if (typeof startV === 'string' && /^\d{9,13}$/.test(startV)) startV = +startV;
  out.date = rec.date || tsOrDate(startV) || dateFromKv(kv);
  if (isNum(startV) && startV > 1e9) out.start = isoLocal(new Date(startV > 1e12 ? startV : startV * 1000));
  else { const tm = String(rec.title || '').match(/\b(\d{1,2}):(\d{2})\b/); if (tm && out.date) out.start = out.date + 'T' + pad2(tm[1]) + ':' + tm[2]; }
  out.durMin = pickDur(kv, [/workouttime/, /totaltime/, /^duration$/, /movingtime/, /duration/, /elapsed/], /pace|avg|per|zone/);
  if (isNum(out.durMin) && (out.durMin > 1440 || out.durMin <= 0)) out.durMin = null;
  const dk = getk(kv, [/^distance$/, /totaldistance/, /distance/]);
  if (dk) {
    const v = kv[dk]; const n = parseNum(v);
    if (isNum(n)) { const s = String(v).toLowerCase(); out.distKm = /km/.test(s) ? n : /\bm\b|meter/.test(s) ? n / 1000 : (isNum(v) ? (n > 200000 ? n / 100000 : n > 500 ? n / 1000 : n) : n); }
  }
  out.avgHr = parseNum(getv(kv, [/^(avg|average)(heartrate|hr)$/, /(avg|average)(heartrate|hr)/, /^hr$/], /max|zone/));
  out.maxHr = parseNum(getv(kv, [/^max(heartrate|hr)$/, /max(heartrate|hr)/], /zone/));
  out.kcal = parseNum(getv(kv, [/calor/, /kcal/]));
  out.load = parseNum(getv(kv, [/trainingload/, /^load$/, /load/], /ratio/));
  const lbl = getv(kv, [/^location$/, /^activityname$/, /^workoutname$/]); if (lbl != null && !/^\s*-?\d{1,3}\.\d{3,},\s*-?\d{1,3}\.\d{3,}\s*$/.test(String(lbl))) out.label = String(lbl).slice(0, 60);
  out.te = parseNum(getv(kv, [/^aerobicte$/, /aerobictrainingeffect/], /anaerobic/));
  out.ate = parseNum(getv(kv, [/^anaerobicte$/, /anaerobictrainingeffect/]));
  const foc = getv(kv, [/trainingfocus/]); if (foc != null) out.focus = String(foc).slice(0, 30);
  const eff = getv(kv, [/perceivedeffort/]); if (eff != null) out.effort = String(eff).slice(0, 30);
  if (out.pace == null) { const sp = getv(kv, [/^averagespeed$/, /avgspeed/]); if (sp != null) out.speed = String(sp).slice(0, 16); }
  const pace = getv(kv, [/averagepace|avgpace|pace/], /zone/); if (pace != null) out.pace = String(pace).slice(0, 16);
  const zones = [0, 0, 0, 0, 0]; let hasZ = false;
  for (const k in kv) {
    if (/pace|power|speed|cadence|watt/.test(k)) continue;
    const m = k.match(/zone([1-5])(?:$|[a-z]|\d{2,6}bpm$)/) || k.match(/^z([1-5])$/);
    if (!m) continue;
    const v = kv[k]; const idx = +m[1] - 1;
    if (/bpm/i.test(String(v)) || /^\s*\d+\s*[-–]\s*\d+\s*$/.test(String(v))) continue;
    const p = /pct|percent|ratio/.test(k) || /%/.test(String(v)) ? pctOf(v, k) : null;
    let mins = p != null && out.durMin ? p / 100 * out.durMin : parseDurMin(v, k);
    if (isNum(v) && /sec|time$/.test(k) && v > 300) mins = v / 60;
    if (isNum(mins) && mins >= 0) { zones[idx] += mins; hasZ = true; }
  }
  if (hasZ) out.zones = zones.map(z => Math.round(z * 10) / 10);
  return clean(out);
}

/* ---------- Profil & Ableitungen ---------- */
function ageOn(birthday, date) {
  if (!birthday) return null;
  const b = dateOf(birthday), d = dateOf(date || todayStr());
  return (d - b) / 864e5 / 365.2425;
}
function profileDerived(p, date) {
  const age = p.birthday ? ageOn(p.birthday, date) : (isNum(p.age) ? p.age : null);
  const ageI = age != null ? age : 30;
  return {
    age, ageKnown: age != null,
    sex: p.sex || null,
    hrMax: p.hrMax || Math.round(208 - 0.7 * ageI),
    sleepBase: p.sleepBaseMin || 465,
    strengthCodes: p.strengthCodes || [402]
  };
}

/* ---------- Belastung (Strain) ---------- */
const STRAIN_K = 110;
function trimp(durMin, avgHr, hrRest, hrMax, sex) {
  if (!isNum(durMin) || !isNum(avgHr) || durMin <= 0) return null;
  const hrr = clamp((avgHr - hrRest) / (hrMax - hrRest), 0, 1);
  const [a, b] = sex === 'f' ? [0.86, 1.67] : [0.64, 1.92];
  return durMin * hrr * a * Math.exp(b * hrr);
}
const strainOf = t => isNum(t) ? 21 * (1 - Math.exp(-t / STRAIN_K)) : null;
/** Zonenminuten aus Ø-Puls schätzen (Normalverteilung, SD ≈ 6 % HFmax) */
function zonesFromAvg(durMin, avgHr, hrMax) {
  if (!isNum(durMin) || !isNum(avgHr)) return null;
  const s = 0.06 * hrMax; const b = [0.5, 0.6, 0.7, 0.8, 0.9, 1.2].map(f => f * hrMax);
  const z = [];
  for (let i = 0; i < 5; i++) z.push(durMin * (ncdf(b[i + 1], avgHr, s) - ncdf(b[i], avgHr, s)));
  return z.map(v => Math.round(v * 10) / 10);
}
function actTrimp(act, hrRest, P) {
  let t = trimp(act.durMin, act.avgHr, hrRest, P.hrMax, P.sex);
  if (t == null && isNum(act.load)) t = act.load;
  if (t == null && isNum(act.durMin)) t = act.durMin * 0.9; // ohne Puls: moderate Annahme
  // Krafttraining: Puls unterschätzt die muskuläre Last → Aufschlag
  if (t != null && isStrength(act, P.strengthCodes)) t *= 1.6;
  return t;
}

/* ---------- Gesamtanalyse ---------- */
function analyze(S, opts = {}) {
  const today = opts.today || todayStr();
  const P = profileDerived(S.profile || {}, today);
  const days = S.days || {};
  const acts = Object.values(S.acts || {}).filter(a => a.date);
  const actsBy = {};
  for (const a of acts) (actsBy[a.date] = actsBy[a.date] || []).push(a);
  for (const d in actsBy) actsBy[d].sort((x, y) => String(x.start || '').localeCompare(String(y.start || '')));
  const allDates = Object.keys(days).concat(Object.keys(actsBy)).filter(Boolean).sort();
  const first = allDates[0] || today;
  const dates = dateRange(first < today ? first : today, today);
  const D = {};
  const lnHrv = {}, rhrV = {}, respV = {};
  for (const d of dates) {
    const x = days[d] || {};
    if (isNum(x.hrv) && x.hrv > 5) lnHrv[d] = Math.log(x.hrv);
    if (isNum(x.rhr) && x.rhr > 25) rhrV[d] = x.rhr;
    if (isNum(x.resp) && x.resp > 5) respV[d] = x.resp;
  }
  const windowVals = (map, d, n) => { const out = []; for (let i = 1; i <= n; i++) { const k = addDays(d, -i); if (map[k] != null) out.push(map[k]); } return out; };
  for (const d of dates) {
    const x = days[d] || {};
    const r = {};
    // Baselines (vorherige 30 Tage)
    const lh = windowVals(lnHrv, d, 30), rh = windowVals(rhrV, d, 30), rs = windowVals(respV, d, 30);
    r.hrvN = lh.length;
    r.hrvBase = lh.length ? Math.exp(mean(lh)) : null;
    const lhSd = lh.length >= 8 ? Math.max(sd(lh), 0.07) : 0.12;
    r.rhrBase = rh.length ? mean(rh) : null;
    const rhSd = rh.length >= 8 ? Math.max(sd(rh), 1.8) : 3;
    r.respBase = rs.length >= 3 ? mean(rs) : null;
    const hrRest = r.rhrBase || x.rhr || 60;
    // Belastung
    const list = actsBy[d] || [];
    let tAct = 0, exSteps = 0;
    r.acts = list.map(a => {
      const t = actTrimp(a, hrRest, P);
      const lz = lapZones(a.laps, P.hrMax);
      const zones = lz || a.zones || zonesFromAvg(a.durMin, a.avgHr, P.hrMax);
      tAct += t || 0;
      if (isFootSport(a) && isNum(a.durMin)) exSteps += a.durMin * (a.sport === 104 || a.sport === 105 || a.sport === 900 || /geh|walk|wander|hike/i.test(a.name || '') ? 105 : 150);
      return { ...a, trimp: t, strain: strainOf(t), zonesUsed: zones, zonesEstimated: !lz && !a.zones, lapZonesUsed: lz, strength: isStrength(a, P.strengthCodes) };
    });
    const steps = wornSteps(x);
    const hasDayData = steps != null || list.length || x.sleep || isNum(x.rhr);
    const tBg = hasDayData ? 8 + 2.2 * Math.max(0, (steps || 0) - exSteps) / 1000 : 0;
    r.trimpAct = tAct; r.trimpBg = tBg;
    r.strain = hasDayData ? strainOf(tAct + tBg) : null;
    // Schlaf
    const sl = x.sleep || {};
    r.sleepMin = isNum(sl.totalMin) ? sl.totalMin : (isNum(sl.mainMin) ? sl.mainMin : (isNum(x.sleepMin) ? x.sleepMin : null));
    r.mainMin = isNum(sl.mainMin) ? sl.mainMin : r.sleepMin;
    r.bed = fromNoon(minuteOfDay(sl.start));
    r.wake = fromNoon(minuteOfDay(sl.end));
    if (r.sleepMin != null) {
      const inBed = (r.bed != null && r.wake != null) ? (r.wake - r.bed + 1440) % 1440 : (r.mainMin + (sl.awakeMin || 0));
      r.efficiency = inBed > 0 ? clamp(r.mainMin / inBed * 100, 0, 100) : null;
      const st = sum([sl.deepMin, sl.remMin]);
      r.restorative = (isNum(sl.deepMin) || isNum(sl.remMin)) && r.mainMin ? clamp(st / r.mainMin * 100, 0, 100) : null;
    }
    D[d] = r;
  }
  // Schlafbedarf, Schlafleistung, Konsistenz, Erholung (sequenziell)
  for (const d of dates) {
    const r = D[d]; const x = days[d] || {};
    const prev = D[addDays(d, -1)];
    const strainPrev = prev ? prev.strain : null;
    r.needStrain = isNum(strainPrev) ? clamp((strainPrev - 8) * 3.5, 0, 50) : 0;
    let debt = 0; const w = [0.5, 0.3, 0.2];
    for (let i = 1; i <= 3; i++) { const q = D[addDays(d, -i)]; if (q && isNum(q.sleepMin) && isNum(q.need)) debt += w[i - 1] * Math.max(0, q.need - q.sleepMin); }
    r.needDebt = clamp(debt * 0.6, 0, 90);
    r.needBase = P.sleepBase;
    r.need = r.needBase + r.needStrain + r.needDebt;
    r.sleepPerf = isNum(r.sleepMin) ? clamp(r.sleepMin / r.need * 100, 0, 100) : null;
    // Konsistenz über 4 Nächte
    const beds = [], wakes = [];
    for (let i = 0; i < 4; i++) { const q = D[addDays(d, -i)]; if (q && q.bed != null && q.wake != null) { beds.push(q.bed); wakes.push(q.wake); } }
    if (beds.length >= 3) { const s1 = sd(beds), s2 = sd(wakes); r.consistency = clamp(100 - 0.7 * ((s1 + s2) / 2), 0, 100); }
    // Erholung
    const hasHrv = isNum(x.hrv) && r.hrvN >= 4;
    if (hasHrv || (isNum(x.rhr) && r.rhrBase != null && r.hrvN >= 4)) {
      const lh = []; for (let i = 1; i <= 30; i++) { const k = addDays(d, -i); if (lnHrv[k] != null) lh.push(lnHrv[k]); }
      const lhSd = lh.length >= 8 ? Math.max(sd(lh), 0.07) : 0.12;
      const rh = []; for (let i = 1; i <= 30; i++) { const k = addDays(d, -i); if (rhrV[k] != null) rh.push(rhrV[k]); }
      const rhSd = rh.length >= 8 ? Math.max(sd(rh), 1.8) : 3;
      const zH = hasHrv ? clamp((Math.log(x.hrv) - mean(lh)) / lhSd, -3, 3) : null;
      const zR = isNum(x.rhr) && rh.length ? clamp(-(x.rhr - mean(rh)) / rhSd, -3, 3) : null;
      const zS = isNum(r.sleepPerf) ? clamp((r.sleepPerf - 85) / 12, -3, 2) : null;
      const zP = isNum(x.resp) && r.respBase != null ? -clamp(Math.max(0, x.resp - r.respBase) / 0.6, 0, 3) : null;
      const parts = [[zH, 0.55], [zR, 0.25], [zS, 0.15], [zP, 0.05]].filter(p => isNum(p[0]));
      const wsum = parts.reduce((s, p) => s + p[1], 0);
      const comp = parts.reduce((s, p) => s + p[0] * p[1], 0) / wsum;
      r.recoveryParts = { hrv: zH, rhr: zR, sleep: zS, resp: zP };
      r.recovery = Math.round(100 / (1 + Math.exp(-(1.6 * comp + 0.35))));
      r.recoveryPartial = !hasHrv;
    } else if (isNum(x.hrv) || isNum(x.rhr)) {
      r.calibrating = true;
    }
    r.zone = r.recovery == null ? null : r.recovery >= 67 ? 'green' : r.recovery >= 34 ? 'yellow' : 'red';
  }
  // Akute/chronische Last
  for (const d of dates) {
    const r = D[d];
    const t7 = [], t28 = [];
    for (let i = 0; i < 28; i++) { const q = D[addDays(d, -i)]; const v = q ? (q.trimpAct || 0) + (q.trimpBg || 0) : null; if (q && (q.strain != null)) { t28.push(v); if (i < 7) t28 && t7.push(v); } }
    r.acute = t7.length >= 4 ? mean(t7) : null;
    r.chronic = t28.length >= 14 ? mean(t28) : null;
    r.acwr = r.acute != null && r.chronic ? r.acute / r.chronic : null;
    if (r.recovery != null) {
      let lo = r.zone === 'green' ? 14 : r.zone === 'yellow' ? 10 : 4;
      let hi = r.zone === 'green' ? 18 : r.zone === 'yellow' ? 14 : 10;
      if (r.acwr != null && r.acwr > 1.4) { lo = Math.max(2, lo - 2); hi = Math.max(lo + 2, hi - 2); r.targetNote = 'acwr'; }
      r.target = [lo, hi];
    }
  }
  return { P, D, dates, actsBy, today };
}

/* ---------- Bio-Alter (Healthspan) ---------- */
const GOMPERTZ = 0.085;   // Sterblichkeit verdoppelt sich etwa alle 8 Jahre
const SHRINK = 0.6;       // Überlappung der Faktoren (nicht unabhängig)
const VO2_MED = { m: [[25, 48.0], [35, 42.4], [45, 37.8], [55, 32.6], [65, 28.2], [75, 24.4]], f: [[25, 37.6], [35, 30.2], [45, 26.7], [55, 23.4], [65, 20.0], [75, 18.3]] };
function linPts(pts, x) { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (x - x0) / (x1 - x0) * (y1 - y0); } return pts[pts.length - 1][1]; }
function vo2Median(age, sex) { const a = age || 30; if (sex === 'm' || sex === 'f') return linPts(VO2_MED[sex], a); return (linPts(VO2_MED.m, a) + linPts(VO2_MED.f, a)) / 2; }
/* Bio-Alter: 12 Faktoren. src 'coros' = von der Uhr gemessen, 'manual' = vom Nutzer eingetragen */
const HRV_MED = [[20, 72], [30, 62], [40, 50], [50, 41], [60, 34], [70, 29], [80, 26]]; // typische nächtliche HRV (ms) nach Alter
const SMOKING = {
  never: { label: 'Nie geraucht', hr: 1.0 }, former10: { label: 'Früher, aufgehört vor 10+ Jahren', hr: 1.08 },
  former5: { label: 'Früher, aufgehört vor 5–10 Jahren', hr: 1.25 }, former0: { label: 'Früher, aufgehört vor < 5 Jahren', hr: 1.45 },
  nicotine: { label: 'Nur E-Zigarette, Snus oder Pouches', hr: 1.15 }, occasional: { label: 'Gelegentlich', hr: 1.6 }, daily: { label: 'Täglich', hr: 2.8 }
};
const HS_METRICS = [
  { key: 'sleepH', group: 'Schlaf & Erholung', input: 'coros', label: 'Schlafdauer', unit: 'h', dec: 1, pts: [[4.5, 1.25], [5.5, 1.14], [6.5, 1.05], [7, 1.0], [8, 1.0], [8.5, 1.04], [9.5, 1.18], [10.5, 1.32]], target: '7–8 h', src: 'Cappuccio et al., Sleep 2010 (Meta-Analyse)' },
  { key: 'consistency', group: 'Schlaf & Erholung', input: 'coros', label: 'Schlafkonsistenz', unit: '%', dec: 0, pts: [[30, 1.45], [45, 1.25], [60, 1.08], [70, 1.0], [80, 0.95], [90, 0.91], [100, 0.90]], target: '≥ 80 %', src: 'Windred et al., Sleep 2024 (UK Biobank)' },
  { key: 'hrv', group: 'Schlaf & Erholung', input: 'coros', label: 'HRV in der Nacht', unit: 'ms', dec: 0, target: 'über Altersmedian', src: 'Hillebrand et al., Europace 2013 (Meta-Analyse); Altersnormen aus Wearable-Daten – vorsichtig gewichtet' },
  { key: 'rhr', group: 'Schlaf & Erholung', input: 'coros', label: 'Ruhepuls', unit: 'bpm', dec: 0, target: '≤ 55 bpm', src: 'Zhang et al., CMAJ 2016' },
  { key: 'steps', group: 'Bewegung', input: 'coros', label: 'Schritte', unit: 'pro Tag', dec: 0, pts: [[2000, 1.55], [4000, 1.30], [7000, 1.0], [10000, 0.85], [12500, 0.79], [16000, 0.77]], target: '≥ 8 000 pro Tag', src: 'Paluch et al., Lancet Public Health 2022' },
  { key: 'active', group: 'Bewegung', input: 'coros', label: 'Aktive Minuten', unit: 'min/Woche', dec: 0, pts: [[0, 1.30], [60, 1.12], [150, 1.0], [300, 0.88], [450, 0.84], [700, 0.83]], target: '150–300 min/Woche', src: 'Lee et al., Circulation 2022' },
  { key: 'intense', group: 'Bewegung', input: 'coros', label: 'Intensive Minuten (Zone 4–5)', unit: 'min/Woche', dec: 0, pts: [[0, 1.10], [30, 1.0], [75, 0.92], [150, 0.86], [300, 0.84]], target: '≥ 75 min/Woche', src: 'Lee et al., Circulation 2022' },
  { key: 'strength', group: 'Bewegung', input: 'coros', label: 'Krafttraining', unit: 'min/Woche', dec: 0, pts: [[0, 1.06], [30, 0.93], [60, 0.89], [120, 0.90], [180, 0.94], [300, 0.98]], target: '60–120 min/Woche', src: 'Momma et al., Br J Sports Med 2022' },
  { key: 'vo2', group: 'Fitness & Körper', input: 'coros', label: 'VO₂max', unit: 'ml/kg/min', dec: 1, target: 'über Altersmedian', src: 'Kodama et al., JAMA 2009' },
  { key: 'bmi', group: 'Fitness & Körper', input: 'coros', label: 'BMI', unit: 'kg/m²', dec: 1, pts: [[17, 1.7], [18.5, 1.5], [20, 1.06], [22.5, 1.0], [25, 1.0], [26.2, 1.07], [28.7, 1.2], [32.5, 1.45], [37.5, 1.94], [42, 2.6]], target: '20–25', src: 'Global BMI Mortality Collaboration, Lancet 2016 – unterscheidet nicht zwischen Muskeln und Fett' },
  { key: 'alcohol', group: 'Lebensstil', input: 'manual', label: 'Alkohol', unit: 'Getränke/Woche', dec: 1, pts: [[0, 1.0], [10, 1.0], [15, 1.07], [27.5, 1.24], [45, 1.89], [70, 2.4]], target: '≤ 10 Getränke/Woche (1 Getränk = 10 g Alkohol)', src: 'Wood et al., Lancet 2018 (599 912 Personen)' },
  { key: 'smoking', group: 'Lebensstil', input: 'manual', label: 'Rauchen / Nikotin', unit: '', dec: 0, target: 'rauchfrei', src: 'Jha et al., NEJM 2013; Inoue-Choi et al., JAMA Intern Med 2017' }
];
const HS_GROUPS = ['Schlaf & Erholung', 'Bewegung', 'Fitness & Körper', 'Lebensstil'];
function hrvMedian(age) { return linPts(HRV_MED, age || 30); }
function metricHR(m, v, ctx) {
  if (m.key === 'smoking') return v && SMOKING[v] ? SMOKING[v].hr : null;
  if (!isNum(v)) return null;
  if (m.pts) return lerpPts(m.pts, v);
  if (m.key === 'vo2') return clamp(Math.pow(0.87, (v - vo2Median(ctx.age, ctx.sex)) / 3.5), 0.35, 2.2);
  if (m.key === 'rhr') return clamp(Math.pow(1.10, (v - 60) / 10), 0.7, 1.8);
  if (m.key === 'hrv') return clamp(Math.pow(1.30, -Math.log2(v / hrvMedian(ctx.age))), 0.85, 1.5);
  return null;
}
/** Minuten je Pulszone aus den Runden einer Aktivität ([[Sekunden, Ø-Puls], …]) */
function lapZones(laps, hrMax) {
  if (!Array.isArray(laps) || !laps.length || !isNum(hrMax)) return null;
  const z = [0, 0, 0, 0, 0, 0]; let n = 0; // Index 5 = unter Zone 1
  for (const l of laps) {
    const sec = l[0], hr = l[1]; if (!isNum(sec) || !isNum(hr) || hr <= 0 || sec <= 0) continue;
    const f = hr / hrMax; const i = f >= 0.9 ? 4 : f >= 0.8 ? 3 : f >= 0.7 ? 2 : f >= 0.6 ? 1 : f >= 0.5 ? 0 : 5;
    z[i] += sec / 60; n++;
  }
  return n ? z.slice(0, 5).map(v => Math.round(v * 10) / 10) : null;
}
/** Runden aus queryActivityLapData → [[Sekunden, Ø-Puls]] (erste Gruppe mit Pulswerten) */
function parseLaps(raw) {
  let j = raw; if (typeof j === 'string') { try { j = JSON.parse(unwrapText(j)); } catch (e) { return null; } }
  const groups = j && Array.isArray(j.lapGroups) ? j.lapGroups : null; if (!groups) return null;
  for (const g of groups) {
    const laps = (g && Array.isArray(g.laps) ? g.laps : []).map(l => [parseNum(l.time), parseNum(l.avgHr)]).filter(l => isNum(l[0]) && l[0] > 0 && isNum(l[1]) && l[1] > 0);
    if (laps.length) return laps.map(l => [Math.round(l[0] * 10) / 10, Math.round(l[1])]);
  }
  return [];
}
/** Schritte nur von Tagen, an denen die Uhr getragen wurde (COROS meldet sonst 0 bzw. Reste wie 171) */
const MIN_WORN_STEPS = 500;
function wornSteps(x) { if (!x || !isNum(x.steps)) return null; return x.steps >= MIN_WORN_STEPS || (isNum(x.exerciseMin) && x.exerciseMin > 0) ? x.steps : null; }
function drinksOf(e) { if (!e) return 0; if (isNum(e.drinks)) return e.drinks; return 0; }
function healthspanWindow(S, A, endDate, windowDays) {
  const start = addDays(endDate, -(windowDays - 1));
  const ds = A.dates.filter(d => d >= start && d <= endDate);
  const days = S.days || {};
  const withData = ds.filter(d => { const x = days[d] || {}; return isNum(wornSteps(x)) || x.sleep || isNum(x.rhr) || (A.actsBy[d] || []).length; });
  if (!withData.length) return null;
  const spanDays = Math.max(7, diffDays(endDate, withData[0]) + 1);
  const weeks = Math.min(windowDays, spanDays) / 7;
  // Intensive Minuten nur aus echten Rundendaten; Abdeckung über Ausdauer-Aktivitäten
  let intense = 0, strength = 0, cardioMin = 0, lapMin = 0, cardioN = 0, cardioNoDur = 0;
  for (const d of ds) for (const a of (A.D[d] ? A.D[d].acts : [])) {
    if (a.strength) { if (isNum(a.durMin)) strength += a.durMin; continue; }
    cardioN++; if (!isNum(a.durMin)) cardioNoDur++;
    const dm = isNum(a.durMin) ? a.durMin : 0; cardioMin += dm;
    if (a.lapZonesUsed) { intense += a.lapZonesUsed[3] + a.lapZonesUsed[4]; lapMin += dm; }
  }
  const cov = cardioMin ? lapMin / cardioMin : (cardioN === 0 ? 1 : 0);
  // heutiger Tag ist noch nicht vorbei → nicht in den Wochenschnitt der aktiven Minuten
  // nur abgeschlossene Tage, an denen die Uhr getragen wurde
  const fullDays = ds.filter(d => d !== todayStr() && isNum(wornSteps(days[d])));
  const exDays = fullDays.filter(d => isNum((days[d] || {}).exerciseMin));
  const fh = (S.fitnessHist || []).filter(f => isNum(f.vo2max)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const before = fh.filter(f => f.date <= endDate);
  const vo2 = before.length ? before[before.length - 1].vo2max : fh.length ? fh[0].vo2max : (S.fitness && isNum(S.fitness.vo2max) ? S.fitness.vo2max : null);
  const P = S.profile || {};
  const bmi = isNum(P.heightCm) && isNum(P.weightKg) && P.heightCm > 100 ? P.weightKg / Math.pow(P.heightCm / 100, 2) : null;
  // Alkohol: nur echte Einträge; Tage ohne Eintrag zählen als 0
  let drinks = 0; for (const d of ds) if (d >= withData[0]) drinks += drinksOf((S.journal || {})[d]);
  const hasActs = ds.some(d => (A.actsBy[d] || []).length);
  const values = {
    sleepH: (() => { const m = mean(ds.map(d => A.D[d].sleepMin)); return m != null ? m / 60 : null; })(),
    consistency: mean(ds.map(d => A.D[d].consistency)),
    hrv: mean(ds.map(d => (days[d] || {}).hrv)),
    rhr: mean(ds.map(d => (days[d] || {}).rhr)),
    steps: mean(fullDays.map(d => wornSteps(days[d]))),
    active: exDays.length >= 5 ? mean(exDays.map(d => days[d].exerciseMin)) * 7 : null,
    intense: hasActs ? (cardioN === 0 ? 0 : cardioNoDur === cardioN && !lapMin ? null : cov >= 0.8 ? intense / weeks : null) : null,
    strength: hasActs ? strength / weeks : null,
    vo2, bmi,
    alcohol: weeks ? drinks / weeks : null,
    smoking: P.smoking || null
  };
  const ctx = { age: A.P.age, sex: A.P.sex };
  const metrics = HS_METRICS.map(m => {
    const v = values[m.key]; const hr = metricHR(m, v, ctx);
    const years = hr != null ? Math.log(hr) / GOMPERTZ * SHRINK : null;
    return { ...m, value: v, hr, years };
  });
  const total = clamp(sum(metrics.map(m => m.years)), -18, 18);
  return { metrics, delta: total, nDays: withData.length, start, end: endDate, lapCoverage: cov };
}
function healthspan(S, A) {
  const end = A.today;
  const last31 = A.dates.filter(d => d > addDays(end, -31));
  const daysWith = last31.filter(d => { const x = (S.days || {})[d] || {}; return x.sleep || isNum(x.hrv) || isNum(x.rhr); }).length;
  const unlocked = daysWith >= 21;
  const long = healthspanWindow(S, A, end, 180);
  const short = healthspanWindow(S, A, end, 30);
  const age = A.P.age;
  let pace = null;
  // Tempo nur, wenn der Langzeitwert deutlich mehr Daten hat als die letzten 30 Tage
  if (long && short && long.nDays - short.nDays >= 14) pace = clamp(1 + 2 * (short.delta - long.delta), -1, 3);
  // wöchentlicher Verlauf
  const hist = [];
  const keySet = long ? long.metrics.filter(m => isNum(m.years)).map(m => m.key).join(',') : '';
  if (unlocked) {
    for (let w = 25; w >= 0; w--) {
      const e = addDays(end, -7 * w);
      if (e < A.dates[0]) continue;
      const h = healthspanWindow(S, A, e, 180);
      if (!h || h.metrics.filter(m => isNum(m.years)).map(m => m.key).join(',') !== keySet) continue; // nur vergleichbare Punkte
      const nd = A.dates.filter(d => d <= e && d > addDays(e, -31)).filter(d => { const x = (S.days || {})[d] || {}; return x.sleep || isNum(x.hrv) || isNum(x.rhr); }).length;
      if (h && nd >= 21 && age != null) hist.push({ date: e, bioAge: ageOn(S.profile.birthday, e) != null ? ageOn(S.profile.birthday, e) + h.delta : age + h.delta });
    }
  }
  return { unlocked, daysWith, long, short, pace, age, bioAge: age != null && long ? age + long.delta : null, hist };
}

/* ---------- Tagebuch-Einblicke ---------- */
const JOURNAL = [
  { id: 'alcohol', label: 'Alkohol' },
  { id: 'lateCaffeine', label: 'Koffein nach 14 Uhr' },
  { id: 'lateMeal', label: 'Spät gegessen' },
  { id: 'screens', label: 'Bildschirm im Bett' },
  { id: 'highStress', label: 'Hoher Stress' },
  { id: 'lateWork', label: 'Bis spät gelernt/gearbeitet' },
  { id: 'travel', label: 'Reise / fremdes Bett' },
  { id: 'sick', label: 'Krank / angeschlagen' },
  { id: 'meditation', label: 'Meditation / Atemübung' },
  { id: 'sauna', label: 'Sauna' },
  { id: 'cold', label: 'Kälteanwendung' },
  { id: 'reading', label: 'Gelesen vor dem Schlaf' },
  { id: 'magnesium', label: 'Magnesium' },
  { id: 'hydrated', label: 'Genug Wasser getrunken' },
  { id: 'daylight', label: 'Tageslicht am Morgen' }
];
function journalInsights(S, A) {
  const J = S.journal || {};
  const out = [];
  for (const b of JOURNAL) {
    const yes = [], no = [], hy = [], hn = [], sy = [], sn = [];
    for (const d in J) {
      const e = J[d]; if (!e || !e.items) continue;
      const nxt = A.D[addDays(d, 1)]; if (!nxt || nxt.recovery == null) continue;
      const x = (S.days || {})[addDays(d, 1)] || {};
      const hrvRel = isNum(x.hrv) && nxt.hrvBase ? (x.hrv / nxt.hrvBase - 1) * 100 : null;
      const sp = nxt.sleepPerf;
      const on = b.id === 'alcohol' ? (e.items.alcohol === true || drinksOf(e) > 0) : e.items[b.id] === true;
      if (on) { yes.push(nxt.recovery); hy.push(hrvRel); sy.push(sp); } else { no.push(nxt.recovery); hn.push(hrvRel); sn.push(sp); }
    }
    if (yes.length >= 3 && no.length >= 3) {
      out.push({ ...b, nYes: yes.length, nNo: no.length, effect: mean(yes) - mean(no), hrvEffect: (mean(hy) != null && mean(hn) != null) ? mean(hy) - mean(hn) : null, sleepEffect: (mean(sy) != null && mean(sn) != null) ? mean(sy) - mean(sn) : null, yesMean: mean(yes), noMean: mean(no) });
    } else out.push({ ...b, nYes: yes.length, nNo: no.length, effect: null });
  }
  return out.sort((a, b) => Math.abs(b.effect ?? -1) - Math.abs(a.effect ?? -1));
}

/* ---------- Zeitraumvergleich ---------- */
function periodStats(S, A, end, n) {
  const ds = A.dates.filter(d => d <= end && d > addDays(end, -n));
  const g = f => mean(ds.map(f));
  return {
    recovery: g(d => A.D[d].recovery), strain: g(d => A.D[d].strain), sleepH: (g(d => A.D[d].sleepMin) ?? NaN) / 60,
    sleepPerf: g(d => A.D[d].sleepPerf), consistency: g(d => A.D[d].consistency),
    hrv: g(d => (S.days[d] || {}).hrv), rhr: g(d => (S.days[d] || {}).rhr), steps: mean(ds.filter(d => d !== todayStr()).map(d => wornSteps(S.days[d]))),
    stress: g(d => (S.days[d] || {}).stress),
    green: ds.filter(d => A.D[d].zone === 'green').length, yellow: ds.filter(d => A.D[d].zone === 'yellow').length, red: ds.filter(d => A.D[d].zone === 'red').length,
    actCount: ds.reduce((s, d) => s + ((A.actsBy[d] || []).length), 0),
    actMin: ds.reduce((s, d) => s + sum((A.actsBy[d] || []).map(a => a.durMin)), 0),
    days: ds.length
  };
}

/* ---------- Beispieldaten ---------- */
function makeDemo(endDate) {
  const r = rng(20261020);
  const S = { profile: { birthday: '1999-03-14', sex: 'm', heightCm: 181, weightKg: 76, smoking: 'never', sleepBaseMin: 470, wakeTime: '07:00', strengthCodes: [402] }, days: {}, acts: {}, journal: {}, fitness: null, fitnessHist: [], demo: true };
  const N = 180;
  let prevStrainHigh = 0, prevAlcohol = false;
  for (let i = N - 1; i >= 0; i--) {
    const d = addDays(endDate, -i);
    const dow = dateOf(d).getDay(); // 0=So
    const prog = (N - 1 - i) / N; // 0..1 Trainingsfortschritt
    const sick = i <= 62 && i >= 58;
    const weekend = dow === 0 || dow === 6;
    // Schlaf (Nacht vor d)
    const bedBase = (dow === 0 || dow === 6) ? 24 * 60 + 25 : 23 * 60 + 5; // Minuten ab Mitternacht des Vortags
    const bed = bedBase + gauss(r) * (weekend ? 40 : 25) + (prevAlcohol ? 35 : 0);
    const wakeBase = weekend ? 8 * 60 + 40 : 7 * 60 + 5;
    const wake = wakeBase + gauss(r) * (weekend ? 35 : 12);
    const inBed = (wake + 1440) - bed;
    const awake = clamp(18 + gauss(r) * 8 + (prevAlcohol ? 12 : 0) + (sick ? 15 : 0), 3, 70);
    const asleep = Math.max(240, inBed - awake);
    const deepP = clamp(0.19 + gauss(r) * 0.03 - (prevAlcohol ? 0.04 : 0), 0.08, 0.3);
    const remP = clamp(0.22 + gauss(r) * 0.03 - (prevAlcohol ? 0.05 : 0), 0.1, 0.32);
    const bedD = bed >= 1440 ? d : addDays(d, -1); const bedM = ((bed % 1440) + 1440) % 1440;
    const score = Math.round(clamp(78 + (asleep - 450) / 6 + gauss(r) * 5 - (prevAlcohol ? 9 : 0), 40, 99));
    const sleep = {
      score, mainMin: Math.round(asleep), napMin: 0, totalMin: Math.round(asleep), awakeMin: Math.round(awake),
      deepMin: Math.round(asleep * deepP), remMin: Math.round(asleep * remP), lightMin: Math.round(asleep * (1 - deepP - remP)),
      start: bedD + 'T' + pad2(Math.floor(bedM / 60)) + ':' + pad2(Math.round(bedM % 60) % 60), end: d + 'T' + pad2(Math.floor(wake / 60)) + ':' + pad2(Math.round(wake % 60) % 60)
    };
    const lnBase = Math.log(58 + 10 * prog);
    let lnH = lnBase + gauss(r) * 0.09 - (prevAlcohol ? 0.17 : 0) - prevStrainHigh * 0.07 - (sick ? 0.3 : 0) + (asleep - 450) / 2000;
    const hrv = Math.round(Math.exp(lnH));
    const rhr = Math.round(53 - 3 * prog + gauss(r) * 1.4 + (prevAlcohol ? 3 : 0) + (sick ? 7 : 0) + prevStrainHigh * 1.5);
    const resp = Math.round((14.6 + gauss(r) * 0.3 + (sick ? 1.3 : 0)) * 10) / 10;
    // Aktivitäten
    const acts = [];
    const add = (sport, name, dur, hr, dist, hh) => {
      const id = 'demo-' + compact(d) + '-' + acts.length;
      const laps = []; if (sport !== 402) { let left = dur * 60; while (left > 30) { const t = Math.min(left, 330 + r() * 60); laps.push([Math.round(t), Math.round(hr + gauss(r) * 7)]); left -= t; } }
      acts.push({ id, sport, name, date: d, start: d + 'T' + hh, laps: laps.length ? laps : undefined, durMin: Math.round(dur), avgHr: Math.round(hr), maxHr: Math.round(hr + 18 + r() * 8), distKm: dist ? Math.round(dist * 100) / 100 : undefined, kcal: Math.round(dur * (hr - 50) * 0.11), src: 'demo' });
    };
    if (!sick && r() > 0.12) {
      if (dow === 1 || dow === 4) add(402, 'Krafttraining', 45 + r() * 20, 108 + gauss(r) * 6, null, '18:10');
      if (dow === 2) add(100, 'Laufen', 48 + r() * 10, 158 + gauss(r) * 4, 8.5 + r() * 1.5, '07:30');
      if (dow === 3) add(100, 'Laufen', 38 + r() * 14, 143 + gauss(r) * 4, 6.5 + r() * 2, '17:45');
      if (dow === 6) add(100, 'Laufen', 75 + r() * 35 + prog * 15, 147 + gauss(r) * 4, 13 + r() * 6, '09:30');
      if (dow === 0 && r() > 0.4) add(104, 'Wandern', 100 + r() * 80, 112 + gauss(r) * 6, 9 + r() * 5, '11:00');
      if (dow === 5 && r() > 0.6) add(200, 'Radfahren', 60 + r() * 40, 132 + gauss(r) * 6, 28 + r() * 12, '16:00');
    }
    for (const a of acts) S.acts[a.id] = clean(a);
    const steps = Math.round(clamp(7200 + gauss(r) * 2200 + acts.reduce((s, a) => s + ((a.sport === 100 ? 160 : a.sport === 104 ? 110 : 0) * a.durMin), 0) - (sick ? 4000 : 0), 1500, 32000));
    const stress = Math.round(clamp(31 + gauss(r) * 7 + (dow >= 1 && dow <= 4 ? 4 : -4) + (sick ? 10 : 0), 8, 80));
    S.days[d] = { date: d, sleep, hrv, rhr, resp, spo2: Math.round(96 + r() * 3), steps, stress, exerciseMin: acts.reduce((s2, a) => s2 + a.durMin, 0), kcal: Math.round(2100 + steps * 0.04), src: 'demo' };
    // Tagebuch (Abend von d)
    const alc = (dow === 5 || dow === 6) ? r() < 0.4 : r() < 0.06;
    if (r() < 0.72) {
      S.journal[d] = { drinks: alc ? 1 + Math.floor(r() * 4) : 0, items: { alcohol: alc, lateCaffeine: r() < 0.2, screens: r() < 0.45, highStress: r() < 0.25, meditation: r() < 0.3, sauna: r() < 0.08, reading: r() < 0.35, hydrated: r() < 0.7, daylight: r() < 0.5, sick }, note: '' };
    }
    prevAlcohol = alc;
    const tr = acts.reduce((s, a) => s + a.durMin * clamp((a.avgHr - 52) / (192 - 52), 0, 1), 0);
    prevStrainHigh = tr > 45 ? 1 : 0;
    if (i % 7 === 0) S.fitnessHist.push({ date: d, vo2max: Math.round((50.5 + 2.5 * prog + gauss(r) * 0.3) * 10) / 10 });
  }
  // Demo-Tag "heute" bewusst gut erholt darstellen
  const lastD = S.days[endDate]; if (lastD) { lastD.hrv = 74; lastD.rhr = 49; lastD.resp = 14.5; if (S.journal[addDays(endDate, -1)]) { S.journal[addDays(endDate, -1)].items.alcohol = false; S.journal[addDays(endDate, -1)].drinks = 0; } }
  S.fitness = { date: endDate, vo2max: S.fitnessHist[S.fitnessHist.length - 1].vo2max, runLevel: 74.2, thresholdHr: 171, thresholdPace: '4:28 /km', predictions: { '5 km': '21:05', '10 km': '43:58', 'Halbmarathon': '1:37:40', 'Marathon': '3:26:15' } };
  S.load = { acute: null, chronic: null };
  S.corosRecovery = { pct: 82, level: 'Gut erholt', full: '6 h' };
  return S;
}

/* ---------- Export für Tests ---------- */
if (typeof module !== 'undefined') module.exports = {
  unwrapText, parseSeries, localOf, listVal,
  ymd, dateOf, addDays, diffDays, dateRange, parseDurMin, parseNum, pctOf, findDate, parseText, jsonToRecords, parseResult,
  normSleep, normHrv, normDaily, normCheck, normRecovery, normFitness, normLoad, normUser, normActivity, normSingle,
  analyze, healthspan, lapZones, parseLaps, wornSteps, HS_GROUPS, drinksOf, SMOKING, hrvMedian, journalInsights, periodStats, makeDemo, zonesFromAvg, trimp, strainOf, vo2Median, HS_METRICS, ageOn
};
