// Breeding-risk engine (transparent, rule-based layer).
// score = 100 · √thermal · (0.7·rain + 0.3·humidity) · terrain
//   rain:     lagged rainfall weighted 1–9 weeks back, peak weight at 3–5 weeks (rain→larvae→adults→parasite lag)
//   thermal:  P. falciparum / Anopheles suitability, optimum ≈ 25 °C, zero outside ≈ 16–34 °C
//   humidity: adult survival, poor below ≈ 45 % RH
//   terrain:  local topographic position (valleys ×1.15 … hilltops ×0.85)
// Works offline: everything is computed on the phone from a cached 108-day weather series
// (92 days observed + 16 days forecast), so a reading stays available for up to 16 days without data.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mean = (a) => { const v = a.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

export const LEVEL = (s) => (s >= 71 ? 'high' : s >= 41 ? 'elevated' : 'standard');

export function thermal(t) {
  if (t == null) return 0.8;
  if (t <= 16 || t >= 34) return 0;
  const sd = t < 25 ? 4.5 : 3.5;
  let v = Math.exp(-((t - 25) ** 2) / (2 * sd * sd));
  if (t < 18) v *= (t - 16) / 2;
  if (t > 32) v *= (34 - t) / 2;
  return v;
}
export const humidity = (rh) => (rh == null ? 0.75 : clamp((rh - 45) / 35, 0, 1));
export const rainSuit = (mmWeek) => 1 - Math.exp(-mmWeek / 35);
export const terrain = (tpi) => (tpi == null ? 1 : clamp(1 - tpi / 60, 0.85, 1.15));
export function lagWeight(d) {
  if (d < 7 || d > 63) return 0;
  if (d < 21) return (d - 7) / 14;
  if (d <= 35) return 1;
  return (63 - d) / 28;
}
const W = Array.from({ length: 64 }, (_, d) => lagWeight(d));

/** Extend a series past the forecast horizon by persistence (60-day means) so 8-week outlooks can be computed. */
function extend(s, until) {
  const n = s.dates.length;
  const fill = (k) => mean(s[k].slice(Math.max(0, n - 60)));
  const out = { dates: [...s.dates], rain: [...s.rain], temp: [...s.temp], rh: [...s.rh], lastKnown: n - 1 };
  const last = new Date(s.dates[n - 1] + 'T00:00:00Z');
  for (let i = 1; out.dates.length <= until; i++) {
    const d = new Date(last); d.setUTCDate(d.getUTCDate() + i);
    out.dates.push(d.toISOString().slice(0, 10));
    out.rain.push(fill('rain') ?? 3); out.temp.push(fill('temp') ?? 23); out.rh.push(fill('rh') ?? 70);
  }
  return out;
}

function scoreAt(s, i, tpi) {
  let acc = 0, w = 0, known = 0, total = 0;
  for (let d = 7; d <= 63; d++) {
    const j = i - d; if (j < 0) continue;
    total += W[d];
    if (j <= s.lastKnown) known += W[d];
    if (s.rain[j] == null) continue;
    acc += W[d] * s.rain[j]; w += W[d];
  }
  const mmWeek = w ? (acc / w) * 7 : 20;
  const t = mean(s.temp.slice(Math.max(0, i - 20), i + 1));
  const h = mean(s.rh.slice(Math.max(0, i - 13), i + 1));
  const score = Math.round(clamp(100 * Math.sqrt(thermal(t)) * (0.7 * rainSuit(mmWeek) + 0.3 * humidity(h)) * terrain(tpi), 0, 100));
  return { score, mmWeek, t, h, certainty: total ? known / total : 1 };
}

/**
 * series: { dates[], rain[], temp[], rh[] } (daily, ISO dates), today: 'YYYY-MM-DD'
 * Returns null if `today` is outside the cached data (cache too old).
 */
export function reading(series, today, tpi = null) {
  const t = series.dates.indexOf(today);
  if (t < 0) return null;
  const s = extend(series, t + 63);
  const now = scoreAt(s, t, tpi);
  const outlook = [1, 2, 3, 4, 5, 6, 7, 8].map((w) => {
    const r = scoreAt(s, t + 7 * w, tpi);
    return { week: w, score: r.score, level: LEVEL(r.score), certainty: r.certainty > 0.85 ? 'good' : r.certainty > 0.55 ? 'fair' : 'rough' };
  });
  const weeklyRain = [7, 6, 5, 4, 3, 2, 1, 0].map((k) => {
    let sum = 0; for (let j = t - 7 * k - 6; j <= t - 7 * k; j++) sum += series.rain[j] ?? 0;
    return { weeksAgo: k, mm: Math.round(sum) };
  });
  return {
    score: now.score, level: LEVEL(now.score), outlook, weeklyRain,
    inputs: { rainPerWeek: Math.round(now.mmWeek), temp: now.t == null ? null : +now.t.toFixed(1), rh: now.h == null ? null : Math.round(now.h), tpi },
    drivers: drivers(now, weeklyRain, tpi),
    daysLeftOffline: series.dates.length - 1 - t,
  };
}

function drivers(now, weekly, tpi) {
  const d = [];
  const past = weekly.filter((w) => w.weeksAgo >= 1);
  const heavy = past.reduce((a, b) => (b.mm > a.mm ? b : a), { mm: -1 });
  const med = [...past].map((w) => w.mm).sort((a, b) => a - b)[Math.floor(past.length / 2)] ?? 0;
  if (heavy.mm >= 40 && heavy.mm >= 1.5 * med) d.push({ key: 'rain_heavy', up: true, vars: { weeks: heavy.weeksAgo, mm: heavy.mm } });
  else if (now.mmWeek >= 15) d.push({ key: 'rain_steady', up: true, vars: { mm: Math.round(now.mmWeek) } });
  else d.push({ key: 'rain_little', up: false, vars: {} });
  if (now.t != null) {
    if (now.t < 19) d.push({ key: 'temp_cool', up: false, vars: { t: Math.round(now.t) } });
    else if (now.t > 29) d.push({ key: 'temp_hot', up: false, vars: { t: Math.round(now.t) } });
    else if (now.t >= 21) d.push({ key: 'temp_warm', up: true, vars: { t: Math.round(now.t) } });
  }
  if (now.h != null && now.h >= 70) d.push({ key: 'humid', up: true, vars: { rh: Math.round(now.h) } });
  if (now.h != null && now.h < 50) d.push({ key: 'dry_air', up: false, vars: { rh: Math.round(now.h) } });
  if (tpi != null && tpi <= -8) d.push({ key: 'low_ground', up: true, vars: {} });
  if (tpi != null && tpi >= 8) d.push({ key: 'high_ground', up: false, vars: {} });
  return d;
}
