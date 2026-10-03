// Weather + terrain data with an offline cache.
// One request fetches 92 days of history and a 16-day forecast (~4 KB). The app stores it
// on the phone and keeps computing readings from it for up to 16 days with no connection.

import { PLACES, searchLocal } from './places-ug.js';

const KEY = 'mmo:wx:';
const FRESH_MS = 6 * 3600 * 1000;

export const todayUG = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' });
const k = (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full */ } }

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

const toSeries = (d) => ({
  dates: d.daily.time, rain: d.daily.precipitation_sum, temp: d.daily.temperature_2m_mean,
  rh: d.daily.relative_humidity_2m_mean || d.daily.time.map(() => null),
});

/** One request for one or many points (Open-Meteo accepts comma-separated coordinates). */
async function fetchSeriesMany(lats, lons) {
  const base = 'https://api.open-meteo.com/v1/forecast';
  const q = (rh) => new URLSearchParams({
    latitude: lats.join(','), longitude: lons.join(','), past_days: 92, forecast_days: 16, timezone: 'Africa/Kampala',
    daily: ['precipitation_sum', 'temperature_2m_mean', rh && 'relative_humidity_2m_mean'].filter(Boolean).join(','),
  });
  let d;
  try { d = await json(`${base}?${q(true)}`); } catch (e) { if (e.status !== 400) throw e; d = await json(`${base}?${q(false)}`); }
  return (Array.isArray(d) ? d : [d]).map(toSeries);
}
const fetchSeries = async (lat, lon) => (await fetchSeriesMany([lat], [lon]))[0];

// ---------- Offline pack: readings for every town in the gazetteer ----------
const PACK = 'mmo:pack';
export const packInfo = () => load(PACK);
let packing = null;
/** Download weather for all gazetteer towns in batches of 50 (~3 requests). Skips if done in the last 12 h. */
export function syncPack({ force = false, onProgress } = {}) {
  if (packing) return packing;
  const info = load(PACK);
  if (!force && info && Date.now() - info.at < 12 * 3600 * 1000) return Promise.resolve(info);
  if (!navigator.onLine) return Promise.resolve(info);
  packing = (async () => {
    let done = 0;
    for (let i = 0; i < PLACES.length; i += 50) {
      const chunk = PLACES.slice(i, i + 50);
      const list = await fetchSeriesMany(chunk.map((p) => p.lat), chunk.map((p) => p.lon));
      list.forEach((series, j) => {
        const p = chunk[j], key = KEY + k(p.lat, p.lon), old = load(key);
        if (!old || old.fetchedAt < Date.now() - FRESH_MS) save(key, { series, tpi: old?.tpi ?? null, elevation: old?.elevation ?? null, fetchedAt: Date.now(), pack: true });
        if (!load('mmo:name:' + k(p.lat, p.lon))) save('mmo:name:' + k(p.lat, p.lon), { name: p.name, area: p.area });
      });
      done += chunk.length; onProgress && onProgress(done, PLACES.length);
    }
    const out = { at: Date.now(), towns: PLACES.length };
    save(PACK, out);
    return out;
  })().finally(() => { packing = null; });
  return packing;
}

async function fetchTPI(lat, lon) {
  const dl = 1.5 / 111, dn = 1.5 / (111 * Math.cos((lat * Math.PI) / 180));
  const la = [lat], lo = [lon];
  for (let a = 0; a < 8; a++) { la.push(+(lat + dl * Math.sin(a * Math.PI / 4)).toFixed(5)); lo.push(+(lon + dn * Math.cos(a * Math.PI / 4)).toFixed(5)); }
  const d = await json(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`);
  const e = d.elevation;
  return { elevation: Math.round(e[0]), tpi: Math.round(e[0] - e.slice(1).reduce((s, x) => s + x, 0) / 8) };
}

/** Returns { series, tpi, elevation, fetchedAt, offline } — from network if possible, else cache. */
export async function getData(lat, lon) {
  const key = KEY + k(lat, lon);
  const cached = load(key);
  if (cached && (Date.now() - cached.fetchedAt < FRESH_MS || !navigator.onLine)) return { ...cached, offline: !navigator.onLine };
  try {
    const [series, terr] = await Promise.all([fetchSeries(lat, lon), fetchTPI(lat, lon).catch(() => ({ tpi: null, elevation: null }))]);
    const out = { series, tpi: terr.tpi, elevation: terr.elevation, fetchedAt: Date.now() };
    save(key, out);
    save(KEY + 'last', { lat, lon });
    return { ...out, offline: false };
  } catch (e) {
    if (cached) return { ...cached, offline: true };
    // Offline and never fetched this exact spot: use the nearest place saved on the phone (within 30 km).
    const near = nearestSaved(lat, lon, 30);
    if (near) return { ...near.data, offline: true, near: { lat: near.lat, lon: near.lon, km: near.km } };
    throw e;
  }
}

export function lastPlace() { return load(KEY + 'last'); }

const kmBetween = (a, b, c, d) => {
  const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
/** Nearest place with saved weather data (any age that still covers today). */
export function nearestSaved(lat, lon, maxKm = Infinity) {
  let best = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(KEY) || key === KEY + 'last') continue;
      const [la, lo] = key.slice(KEY.length).split(',').map(Number);
      const km = kmBetween(lat, lon, la, lo);
      if (km <= maxKm && (!best || km < best.km)) best = { lat: la, lon: lo, km, data: load(key) };
    }
  } catch { /* storage blocked */ }
  return best;
}
/** Name saved for a place (works offline). */
export function savedName(lat, lon) { return load('mmo:name:' + k(lat, lon)); }

export async function placeName(lat, lon) {
  const key = 'mmo:name:' + k(lat, lon);
  const c = load(key); if (c) return c;
  try {
    const d = await json(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lon}&accept-language=en`);
    const a = d.address || {};
    const out = { name: a.village || a.neighbourhood || a.suburb || a.hamlet || a.town || a.city_district || a.city || '—', area: a.county || a.city || a.state_district || a.state || '' };
    save(key, out); return out;
  } catch { return { name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, area: '' }; }
}

export async function search(q) {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (m) return [{ name: `${(+m[1]).toFixed(4)}, ${(+m[2]).toFixed(4)}`, area: 'GPS', lat: +m[1], lon: +m[2] }];
  const local = searchLocal(q);                       // works offline
  if (!navigator.onLine) return local;
  let online = [];
  try { online = await searchOnline(q); } catch { return local; }
  const seen = new Set(local.map((p) => p.name.toLowerCase()));
  return [...local, ...online.filter((p) => !seen.has(p.name.toLowerCase()))].slice(0, 8);
}

async function searchOnline(q) {
  const d = await json(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ug,ke,tz,rw&limit=6&addressdetails=1&accept-language=en&q=${encodeURIComponent(q)}`);
  return d.map((x) => ({ name: x.name || x.display_name.split(',')[0], area: (x.address && (x.address.county || x.address.state || x.address.country)) || '', lat: +x.lat, lon: +x.lon }));
}

export function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no-gps'));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }), rej,
      { enableHighAccuracy: false, timeout: navigator.onLine ? 15000 : 8000, maximumAge: 600000 });
  });
}
