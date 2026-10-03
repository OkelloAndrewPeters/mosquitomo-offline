// Weather + terrain data with an offline cache.
// One request fetches 92 days of history and a 16-day forecast (~4 KB). The app stores it
// on the phone and keeps computing readings from it for up to 16 days with no connection.

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

async function fetchSeries(lat, lon) {
  const base = 'https://api.open-meteo.com/v1/forecast';
  const q = (rh) => new URLSearchParams({
    latitude: lat, longitude: lon, past_days: 92, forecast_days: 16, timezone: 'Africa/Kampala',
    daily: ['precipitation_sum', 'temperature_2m_mean', rh && 'relative_humidity_2m_mean'].filter(Boolean).join(','),
  });
  let d;
  try { d = await json(`${base}?${q(true)}`); } catch (e) { if (e.status !== 400) throw e; d = await json(`${base}?${q(false)}`); }
  return {
    dates: d.daily.time, rain: d.daily.precipitation_sum, temp: d.daily.temperature_2m_mean,
    rh: d.daily.relative_humidity_2m_mean || d.daily.time.map(() => null),
  };
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
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return { ...cached, offline: false };
  try {
    const [series, terr] = await Promise.all([fetchSeries(lat, lon), fetchTPI(lat, lon).catch(() => ({ tpi: null, elevation: null }))]);
    const out = { series, tpi: terr.tpi, elevation: terr.elevation, fetchedAt: Date.now() };
    save(key, out);
    save(KEY + 'last', { lat, lon });
    return { ...out, offline: false };
  } catch (e) {
    if (cached) return { ...cached, offline: true };
    throw e;
  }
}

export function lastPlace() { return load(KEY + 'last'); }

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
  const d = await json(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ug,ke,tz,rw&limit=6&addressdetails=1&accept-language=en&q=${encodeURIComponent(q)}`);
  return d.map((x) => ({ name: x.name || x.display_name.split(',')[0], area: (x.address && (x.address.county || x.address.state || x.address.country)) || '', lat: +x.lat, lon: +x.lon }));
}

export function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no-gps'));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }), rej,
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
}
