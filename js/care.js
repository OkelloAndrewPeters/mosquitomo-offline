// Nearby health facilities from OpenStreetMap (Overpass API). Needs internet the first time;
// the last results are saved on the phone so they can still be shown offline.
const KEY = 'mmo:fac';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* */ } };
const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };

export async function nearbyFacilities(lat, lon) {
  if (navigator.onLine) {
    try {
      const q = `[out:json][timeout:20];(node(around:8000,${lat},${lon})[amenity~"^(hospital|clinic|doctors)$"];way(around:8000,${lat},${lon})[amenity~"^(hospital|clinic|doctors)$"];node(around:8000,${lat},${lon})[healthcare~"^(hospital|clinic|centre)$"];);out center 60;`;
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json(); const seen = new Set();
      const list = d.elements.map((e) => {
        const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon, tg = e.tags || {};
        return { name: tg.name, kind: tg.amenity || tg.healthcare || 'clinic', phone: tg.phone || tg['contact:phone'] || null, lat: la, lon: lo, km: km(lat, lon, la, lo) };
      }).filter((f) => f.name && !seen.has(f.name) && seen.add(f.name)).sort((a, b) => a.km - b.km).slice(0, 10);
      const out = { at: Date.now(), lat, lon, list };
      save(out); return { ...out, offline: false };
    } catch { /* fall back to saved list */ }
  }
  const saved = load();
  if (saved) return { ...saved, offline: true, list: saved.list.map((f) => ({ ...f, km: km(lat, lon, f.lat, f.lon) })).sort((a, b) => a.km - b.km) };
  return null;
}
