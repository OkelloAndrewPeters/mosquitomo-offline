import { reading } from './risk.js';
import { getData, placeName, search, locate, todayUG, lastPlace, nearestSaved, savedName, syncPack, packInfo, savedData } from './weather.js';
import { searchLocal, PLACES } from './places-ug.js';
import { nearbyFacilities } from './care.js';
import { t, label, getLang, setLang, LANGS, SPEECH_LANG } from './i18n.js';
import { addReport, allReports, deleteReport, shrink } from './store.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { standard: '#2E8B57', elevated: '#E0A100', high: '#C8322B' };
const ICON = {
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
};
let sitenet = null; // lazy-loaded module (keeps first paint light)

function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); }

// ---------- speech (on-device voices only; button hidden when the phone has no voice for the language) ----------
function voiceFor(lang) {
  const want = SPEECH_LANG[lang].slice(0, 2);
  return speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(want));
}
function speakBtn(text) {
  if (!('speechSynthesis' in window) || !voiceFor(getLang())) return '';
  return `<button class="ghost listen" data-say="${esc(text)}">${ICON.mic}${t('listen')}</button>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-say]'); if (!b) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(b.dataset.say); u.voice = voiceFor(getLang()); u.lang = SPEECH_LANG[getLang()]; u.rate = 0.95;
  speechSynthesis.speak(u);
});
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => route();

// ---------- router ----------
const routes = { risk: viewRisk, map: viewMap, check: viewCheck, reports: viewReports, about: viewAbout };
function route() {
  const name = (location.hash.slice(1) || 'risk').split('?')[0];
  const r = routes[name] ? name : 'risk';
  document.querySelectorAll('.tabs a').forEach((a) => { if (a.dataset.tab === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  routes[r]();
}
window.addEventListener('hashchange', route);

// ---------- RISK ----------
let current = null;
async function viewRisk() {
  view.innerHTML = `
    <div class="where-bar">
      <button class="primary" id="gps">${t('use_location')}</button>
      <form id="sf" role="search"><input id="q" type="search" placeholder="${t('search_place')}" aria-label="${t('search_place')}"></form>
    </div>
    <ul class="results" id="results" hidden></ul>
    <p class="pack" id="pack"></p>
    <div id="reading">${current ? '' : `<p class="muted center">${t('risk_title')}</p>`}</div>`;
  $('#gps').onclick = async () => {
    $('#reading').innerHTML = `<p class="muted center">${t('loading')}</p>`;
    try { const p = await locate(); show(p.lat, p.lon); }
    catch {
      // No GPS fix (common indoors or offline): fall back to the last place used on this phone
      const l = lastPlace();
      if (l) { show(l.lat, l.lon); toast(t('gps_fallback')); }
      else $('#reading').innerHTML = `<p class="muted center">${t('gps_failed')}</p>`;
    }
  };
  const ul = $('#results');
  const renderList = (list, q) => {
    ul.hidden = false;
    const hint = navigator.onLine ? '' : `<li class="muted small">${t('offline_search')}</li>`;
    ul.innerHTML = list.length
      ? hint + list.map((p, i) => `<li><button data-i="${i}"><b>${esc(p.name)}</b> <span class="muted">${esc(p.area)}</span></button></li>`).join('')
      : `<li class="muted">${t('no_results', { q: esc(q) })}</li>`;
    ul.querySelectorAll('button').forEach((b) => (b.onclick = () => { ul.hidden = true; $('#q').value = ''; const p = list[+b.dataset.i]; show(p.lat, p.lon, { name: p.name, area: p.area }); }));
  };
  $('#q').addEventListener('input', () => {           // instant suggestions from the built-in town list (no internet needed)
    const q = $('#q').value.trim();
    if (q.length < 2) { ul.hidden = true; return; }
    renderList(searchLocal(q), q);
  });
  $('#sf').onsubmit = async (e) => {
    e.preventDefault(); const q = $('#q').value.trim(); if (q.length < 2) return;
    try { renderList(await search(q), q); } catch { renderList(searchLocal(q), q); }
  };
  renderPack();
  if (current) render();
  else { const l = lastPlace(); if (l) show(l.lat, l.lon); }
}

async function show(lat, lon, place) {
  $('#reading') && ($('#reading').innerHTML = `<p class="muted center">${t('loading')}</p>`);
  try {
    const d = await getData(lat, lon);
    let nm = place;
    if (!nm && d.near) nm = savedName(d.near.lat, d.near.lon) || { name: `${d.near.lat.toFixed(2)}, ${d.near.lon.toFixed(2)}`, area: '' };
    if (!nm) nm = (!navigator.onLine && savedName(lat, lon)) || (await placeName(lat, lon));
    const r = reading(d.series, todayUG(), d.tpi);
    current = { d, r, nm, lat, lon };
    if ((location.hash.slice(1) || 'risk') === 'risk') render();
  } catch {
    $('#reading').innerHTML = `<p class="muted center">${t('no_saved')}</p>`;
  }
}

function renderPack(progress) {
  const el = $('#pack'); if (!el) return;
  const info = packInfo();
  if (progress) { el.innerHTML = t('pack_saving', progress); return; }
  el.innerHTML = info
    ? `${t('pack_status', { n: info.towns, date: new Date(info.at).toLocaleDateString() })} ${navigator.onLine ? `<button class="linkish" id="packBtn">${t('pack_update')}</button>` : ''}`
    : (navigator.onLine ? `<button class="linkish" id="packBtn">${t('pack_save')}</button>` : t('pack_none_offline'));
  const b = $('#packBtn'); if (b) b.onclick = () => runPack(true);
}
function runPack(force = false) {
  return syncPack({ force, onProgress: (done, total) => renderPack({ done, total }) })
    .then(() => renderPack()).catch(() => renderPack());
}
// Save all towns for offline use the first time the app is online (and refresh twice a day).
if (navigator.onLine) setTimeout(() => runPack(false), 1500);
window.addEventListener('online', () => runPack(false));

// When the connection comes back, refresh the reading on screen automatically.
window.addEventListener('online', () => { if (current) show(current.lat, current.lon, current.d.near ? null : current.nm); });

function strip(r) {
  const W = 340, base = 74, bw = 16, gap = 4.2;
  const max = Math.max(60, ...r.weeklyRain.map((w) => w.mm));
  const past = r.weeklyRain.map((w, i) => { const h = Math.max(2, (w.mm / max) * 56); return `<rect x="${i * (bw + gap)}" y="${base - h}" width="${bw}" height="${h}" rx="3" fill="#8E9BD0"/>`; }).join('');
  const op = { good: 1, fair: 0.75, rough: 0.5 };
  const fut = r.outlook.map((o, i) => { const h = Math.max(4, (o.score / 100) * 68); return `<rect x="${W - 160 + i * (bw + gap)}" y="${base - h}" width="${bw}" height="${h}" rx="3" fill="${COLORS[o.level]}" opacity="${op[o.certainty]}"/>`; }).join('');
  return `<svg viewBox="0 0 ${W} 92" role="img" aria-label="${t('rain_past')} / ${t('risk_next')}">${past}<line x1="170" x2="170" y1="4" y2="${base}" stroke="#fff" stroke-dasharray="3 3" opacity=".7"/>${fut}
    <text x="170" y="90" fill="#fff" font-size="12" text-anchor="middle" font-weight="700">${t('today')}</text></svg>
    <div class="legend"><span>${t('rain_past')}</span><span>${t('risk_next')}</span></div>`;
}

function render() {
  const { d, r, nm } = current;
  const el = $('#reading'); if (!el) return;
  if (!r) { el.innerHTML = `<p class="muted center">Saved data is too old. Connect once to refresh.</p>`; return; }
  const lvl = r.level;
  const advice = t('adv_' + lvl);
  const note = d.offline
    ? t('offline_note', { date: new Date(d.fetchedAt).toLocaleDateString(), days: r.daysLeftOffline })
    : t('online_note', { time: new Date(d.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), days: r.daysLeftOffline });
  const nearNote = d.near ? `<p class="note off">${t('near_note', { km: Math.max(1, Math.round(d.near.km)) })}</p>`
    : (d.pack ? `<p class="note off">${t('town_level')}</p>` : '');
  el.innerHTML = `
    <section class="card dusk" data-level="${lvl}">
      <div class="place">${esc(nm.name)}</div><div class="area">${esc(nm.area)}</div>
      <div class="score-row"><span class="score">${r.score}</span><span><span class="pill">${t('lvl_' + lvl)}</span><span class="of">${t('out_of')}</span></span></div>
      <div class="strip">${strip(r)}</div>
      ${nearNote}<p class="note ${d.offline ? 'off' : ''}">${note}</p>
    </section>
    <section class="card" data-level="${lvl}">
      <div class="row"><h2>${t('what_to_do')}</h2>${speakBtn(advice.join(' '))}</div>
      <ul class="todo">${advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
    </section>
    <section class="card">
      <h2>${t('why')}</h2>
      <ul class="why">${r.drivers.map((x) => `<li class="${x.up ? 'up' : 'down'}"><span>${x.up ? '↑' : '↓'}</span>${esc(t(x.key, x.vars))}</li>`).join('')}</ul>
    </section>
    <section class="card fever">
      <h2>${t('fever_title')}</h2>
      <p class="muted">${t('fever_body')}</p>
      <button class="ghost" id="facBtn">${t('find_facilities')}</button>
      <div id="fac"></div>
    </section>`;
  $('#facBtn').onclick = () => showFacilities(current.lat, current.lon);
}

async function showFacilities(lat, lon) {
  const el = $('#fac'); el.innerHTML = `<p class="muted">${t('loading')}</p>`;
  const res = await nearbyFacilities(lat, lon);
  if (!res) { el.innerHTML = `<p class="muted">${t('fac_offline_none')}</p>`; return; }
  el.innerHTML = (res.offline ? `<p class="note-inline">${t('fac_offline', { date: new Date(res.at).toLocaleDateString() })}</p>` : '')
    + (res.list.length ? `<ul class="fac">${res.list.map((f) => `<li><div><b>${esc(f.name)}</b><br><span class="muted small">${esc(f.kind)} · ${f.km.toFixed(1)} km</span></div>
      <div class="fac-a">${f.phone ? `<a class="ghost" href="tel:${esc(f.phone.replace(/\s/g, ''))}">${t('call')}</a>` : ''}<a class="ghost" href="https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}" target="_blank" rel="noopener">${t('directions')}</a></div></li>`).join('')}</ul>
      <p class="tiny">${t('fac_source')}</p>` : `<p class="muted">${t('fac_none')}</p>`);
}

// ---------- MAP: risk across Uganda (street map online; offline: saved towns drawn without a background) ----------
function townReadings() {
  const today = todayUG(), out = [];
  for (const p of PLACES) {
    const d = savedData(p.lat, p.lon); if (!d) continue;
    const r = reading(d.series, today, d.tpi); if (r) out.push({ ...p, score: r.score, level: r.level });
  }
  return out;
}
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'vendor/leaflet/leaflet.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
let mapObj = null;
async function viewMap() {
  const towns = townReadings();
  view.innerHTML = `
    <h2 class="pad">${t('map_title')}</h2>
    <p class="muted small pad">${towns.length ? t('map_help', { n: towns.length }) : t('map_empty')}</p>
    <div id="map" class="map"></div>
    <div class="legend-row"><span><i class="dot" style="background:${COLORS.standard}"></i>${t('lvl_standard')}</span><span><i class="dot" style="background:${COLORS.elevated}"></i>${t('lvl_elevated')}</span><span><i class="dot" style="background:${COLORS.high}"></i>${t('lvl_high')}</span></div>`;
  if (!towns.length) return;
  const open = (p) => { location.hash = '#risk'; setTimeout(() => show(p.lat, p.lon, { name: p.name, area: p.area }), 50); };
  if (navigator.onLine) {
    try {
      await loadLeaflet();
      if (mapObj) { mapObj.remove(); mapObj = null; }
      mapObj = L.map('map', { zoomControl: true, preferCanvas: false }).setView([1.37, 32.29], 6);
      setTimeout(() => mapObj && mapObj.invalidateSize(), 200);
      mapObj.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap' }).addTo(mapObj);
      towns.forEach((p) => {
        const m = L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 2, fillColor: COLORS[p.level], fillOpacity: 0.95 }).addTo(mapObj);
        m.bindTooltip(`${esc(p.name)}: ${p.score}`, { direction: 'top', offset: [0, -6] });
        m.on('click', () => open(p));
      });
      mapObj.fitBounds(towns.map((p) => [p.lat, p.lon]), { padding: [16, 16] });
      return;
    } catch { /* fall through to offline drawing */ }
  }
  // Offline: plot towns by latitude/longitude on a plain panel (Uganda spans ~29.5–35°E, -1.5–4.3°N)
  const W = 340, H = 360, x = (lo) => ((lo - 29.4) / (35.1 - 29.4)) * (W - 20) + 10, y = (la) => ((4.35 - la) / (4.35 + 1.55)) * (H - 20) + 10;
  $('#map').innerHTML = `<svg class="offline-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('map_title')}">
    <rect width="${W}" height="${H}" rx="14" fill="#E3E8E1"/>
    <text x="${x(32.2)}" y="${y(-0.9)}" font-size="11" fill="#7d8a84" text-anchor="middle">Lake Victoria</text>
    ${towns.map((p, i) => `<g class="town" data-i="${i}" tabindex="0" role="button" aria-label="${esc(p.name)} ${p.score}">
      <circle cx="${x(p.lon).toFixed(1)}" cy="${y(p.lat).toFixed(1)}" r="7" fill="${COLORS[p.level]}" stroke="#fff" stroke-width="1.5"/>
      ${['Kampala', 'Gulu', 'Arua', 'Mbarara', 'Jinja', 'Mbale', 'Lira', 'Moroto', 'Kabale', 'Fort Portal', 'Soroti', 'Hoima', 'Kitgum', 'Masaka'].includes(p.name) ? `<text x="${(x(p.lon) + 9).toFixed(1)}" y="${(y(p.lat) + 4).toFixed(1)}" font-size="10" fill="#18201C">${esc(p.name)} ${p.score}</text>` : ''}
    </g>`).join('')}</svg><p class="tiny pad">${t('map_offline')}</p>`;
  $('#map').querySelectorAll('.town').forEach((g) => { const p = towns[+g.dataset.i]; g.onclick = () => open(p); g.onkeydown = (e) => { if (e.key === 'Enter') open(p); }; });
}

// ---------- CHECK (on-device AI) ----------
function viewCheck() {
  view.innerHTML = `
    <section class="card">
      <h2>${t('check_title')}</h2>
      <p class="muted">${t('check_help')}</p>
      <label class="camera"><input type="file" accept="image/*" capture="environment" id="photo"><span>${t('take_photo')}</span></label>
    </section>
    <div id="result"></div>`;
  // warm the model in the background so the first check is quick
  import('./sitenet.js').then((m) => { sitenet = m; return m.load(); }).catch(() => {});
  $('#photo').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const res = $('#result');
    res.innerHTML = `<section class="card"><p class="muted">${sitenet ? t('analysing') : t('model_loading')}</p></section>`;
    try {
      sitenet = sitenet || (await import('./sitenet.js'));
      const out = await sitenet.classify(f);
      renderResult(out, f);
    } catch (err) {
      console.error(err);
      res.innerHTML = `<section class="card"><p>Model not available yet (${esc(err.message)}).</p></section>`;
    }
  };
}

let pos = null;
locate().then((p) => (pos = p)).catch(() => {});

async function renderResult(out, file) {
  const { top, ranked, ms } = out;
  const unsure = top.p < 0.5;
  const site = top.cls !== 'no_site';
  const fix = t('fix_' + top.cls);
  const url = URL.createObjectURL(file);
  $('#result').innerHTML = `
    <section class="card result ${unsure ? 'unsure' : site ? 'site' : 'clear'}">
      <img src="${url}" alt="">
      <div class="verdict">${unsure ? t('not_sure') : site ? t('result_site') : t('result_none')}</div>
      <h2>${unsure ? t('best_guess') + ': ' : ''}${esc(label(top.cls))}</h2>
      <p class="muted">${t('confidence', { p: Math.round(top.p * 100) })}</p>
      <ol class="bars">${ranked.slice(0, 3).map((x) => `<li><span>${esc(label(x.cls))}</span><i style="--w:${Math.round(x.p * 100)}%"></i><b>${Math.round(x.p * 100)}%</b></li>`).join('')}</ol>
      ${unsure ? '' : `<div class="row"><p class="fix">${esc(fix)}</p>${speakBtn(label(top.cls) + '. ' + fix)}</div>`}
      <p class="tiny">${t('ran_on_phone', { ms })}</p>
      <div class="actions">
        ${site && !unsure
          ? `<button class="primary" id="save" data-check="0">${t('save_report')}</button>`
          : `<button class="${unsure ? 'primary' : 'ghost'}" id="save" data-check="1">${unsure ? t('save_check') : t('save_override')}</button>`}
        <p class="tiny" id="saveNote">${site && !unsure ? t('save_hint') : t('save_check_hint')}</p>
      </div>
    </section>`;
  const save = $('#save');
  if (save) save.onclick = async () => {
    const needsCheck = save.dataset.check === '1';
    const photo = await shrink(out.bitmap);
    if (!pos) pos = await locate().catch(() => null);
    await addReport({ cls: top.cls, p: top.p, ms, lat: pos?.lat ?? null, lon: pos?.lon ?? null, photo, lang: getLang(),
      needsCheck, override: needsCheck && !unsure && !site });
    save.disabled = true; save.textContent = t('saved'); toast(t('saved'));
    $('#saveNote').innerHTML = `<a href="#reports">${t('view_reports')}</a>`;
  };
}

// ---------- REPORTS ----------
async function viewReports() {
  const list = (await allReports().catch(() => [])).reverse();
  view.innerHTML = `<h2 class="pad">${t('reports_title')}</h2>${list.length ? `<ul class="reports">${list.map((r) => `
    <li><img src="${URL.createObjectURL(r.photo)}" alt=""><div><b>${r.override ? t('possible_site') : esc(label(r.cls))}</b> <span class="tag ${r.needsCheck ? 'check' : 'ok'}">${r.needsCheck ? (r.override ? t('tag_person') : t('tag_check')) : t('tag_ai')}</span><br><span class="muted">${r.override ? t('ai_said', { label: label(r.cls), p: Math.round(r.p * 100) }) : Math.round(r.p * 100) + '%'} · ${new Date(r.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}${r.lat == null ? ' · ' + t('no_gps') : ''}</span><br>
    <button class="ghost" data-share="${r.id}">${t('share_report')}</button> <button class="del" data-del="${r.id}" aria-label="Delete report">✕</button></div></li>`).join('')}</ul>`
    : `<p class="muted pad">${t('reports_empty')}</p>`}`;
  view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await deleteReport(+b.dataset.del); viewReports(); }));
  view.querySelectorAll('[data-share]').forEach((b) => (b.onclick = async () => {
    const r = list.find((x) => x.id === +b.dataset.share);
    const text = (r.needsCheck ? `[${r.override ? t('tag_person') : t('tag_check')}] ` : '') + t('share_text', { label: r.override ? t('possible_site') : label(r.cls), p: Math.round(r.p * 100), lat: r.lat?.toFixed(5) ?? '?', lon: r.lon?.toFixed(5) ?? '?', date: new Date(r.createdAt).toLocaleDateString(), fix: t('fix_' + r.cls) })
      + (r.lat != null ? ` https://maps.google.com/?q=${r.lat.toFixed(5)},${r.lon.toFixed(5)}` : '');
    const file = new File([r.photo], `mosquitomo-${r.id}.jpg`, { type: 'image/jpeg' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text });
      else if (navigator.share) await navigator.share({ text });
      else location.href = `sms:?&body=${encodeURIComponent(text)}`;
    } catch { /* user cancelled */ }
  }));
}

// ---------- ABOUT ----------
async function viewAbout() {
  let m = null;
  try { m = await (await fetch('models/sitenet_meta.json')).json(); } catch { /* model not added yet */ }
  const kb = (n) => (n / 1e6).toFixed(1) + ' MB';
  view.innerHTML = `
    <section class="card prose">
      <h2>${t('about_title')}</h2>
      <p>Small AI for places with weak connectivity: a malaria breeding-risk reading and an on-phone photo check for mosquito breeding sites. It works offline after the first visit.</p>
      <h3>On-device model (SiteNet)</h3>
      ${m ? `<ul>
        <li>${esc(m.model)}</li>
        <li>Classes: ${m.classes.map(esc).join(', ')}</li>
        <li>Shipped: ${esc(m.shipped.toUpperCase())}, ${m.onnx[m.shipped].size_mb} MB</li>
        <li>Test accuracy ${(m.test.accuracy * 100).toFixed(1)}%, macro-F1 ${(m.test.macro_f1 * 100).toFixed(1)}%, site vs no-site ${(m.test.site_present_vs_absent_accuracy * 100).toFixed(1)}%</li>
        <li>Trained ${esc(m.trained_on)} on ${m.data.kept_after_teacher_cleaning} teacher-cleaned images</li>
      </ul><p class="muted">${esc(m.caveats)}</p>` : '<p class="muted">Model not added yet.</p>'}
      <h3>Risk engine</h3>
      <p>Computed on the phone from 92 days of rainfall, temperature and humidity plus a 16-day forecast (Open-Meteo), and local terrain. Weights rain from 3 to 5 weeks ago most, because that is when rain turns into malaria risk. The data is saved, so readings keep working offline for up to 16 days.</p>
      <h3>Honest limits</h3>
      <p>A pilot tool, not medical advice. The risk index is not yet calibrated against clinic data. Luganda and Swahili text need review by native speakers and health workers.</p>
      <p class="tiny" id="ver">Version …</p>
      <p class="muted">Built 3–4 October 2026 at the Hack-Nation Global AI Hackathon. It extends the MosquitoMo concept (public mosquito-risk information for Uganda) with on-device AI. Weather: Open-Meteo (CC BY 4.0). Places: © OpenStreetMap.</p>
    </section>`;
  appVersion().then((v) => { const el = $('#ver'); if (el) el.textContent = 'App version ' + v; });
}

// ---------- shell: language, install, service worker ----------
const sel = $('#lang');
sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${v}</option>`).join('');
sel.onchange = () => { setLang(sel.value); document.documentElement.lang = sel.value; route(); };
document.documentElement.lang = getLang();

let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#install').hidden = false; });
$('#install').onclick = async () => { if (deferred) { deferred.prompt(); deferred = null; $('#install').hidden = true; } };
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Check for a new version every time the app opens (and every 30 min); reload once when it takes over.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.update().catch(() => {});
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true; location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then((r) => r && r.update().catch(() => {}));
  });
}
async function appVersion() {
  const c = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!c) return 'dev';
  return new Promise((res) => {
    const done = (e) => { if (e.data && e.data.version) { navigator.serviceWorker.removeEventListener('message', done); res(e.data.version); } };
    navigator.serviceWorker.addEventListener('message', done); c.postMessage('version'); setTimeout(() => res('?'), 1500);
  });
}

route();
