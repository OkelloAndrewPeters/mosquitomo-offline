# ===== ADD-ON CELL: more data from Wikimedia Commons (openly licensed, with per-image licence records) =====
# Paste this as a NEW cell directly after the Bing download cell, run it, then re-run every cell below it
# (starting with the "Clean" cell). It saves into the same RAW/<class>/ folders, so nothing else changes.
import requests, csv, concurrent.futures as cf, re, html
UA = {'User-Agent': 'MosquitoMo-SiteNet/0.1 (Hack-Nation 2026 research prototype; https://github.com/OkelloAndrewPeters)'}
API = 'https://commons.wikimedia.org/w/api.php'
COMMONS_Q = {
  'no_site':   ['dirt road Uganda', 'village Uganda', 'street Kampala', 'dry season road Africa', 'maize field', 'living room interior',
                'market Uganda', 'football field Africa', 'tarmac road Africa', 'homestead Uganda'],
  'puddle':    ['puddle', 'puddle road', 'pothole water', 'flooded road', 'muddy road rain', 'rain puddle Africa', 'waterlogged path'],
  'drain':     ['drainage ditch', 'open drain', 'blocked drain', 'storm drain water', 'clogged gutter', 'open sewer', 'drainage channel Kampala'],
  'container': ['tyres water', 'discarded tires', 'old tires', 'jerrycan', 'bucket water', 'plastic waste water', 'water container outdoor', 'tire dump'],
  'pit':       ['brick pit', 'brick making Uganda', 'brick kiln Africa', 'borrow pit', 'quarry pond', 'excavation water', 'flooded excavation', 'construction pit'],
  'wetland':   ['papyrus swamp', 'rice paddy', 'wetland Uganda', 'marsh', 'swamp Africa', 'paddy field water', 'Nakivubo wetland'],
}
PER_Q = 120

def commons_search(q):
    out, cont = [], {}
    while len(out) < PER_Q:
        p = {'action': 'query', 'format': 'json', 'generator': 'search', 'gsrsearch': f'{q} filetype:bitmap', 'gsrnamespace': 6,
             'gsrlimit': 50, 'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': 384,
             'iiextmetadatafilter': 'LicenseShortName|Artist', **cont}
        r = requests.get(API, params=p, headers=UA, timeout=30).json()
        for pg in (r.get('query', {}).get('pages', {}) or {}).values():
            ii = (pg.get('imageinfo') or [{}])[0]
            if not ii.get('thumburl'): continue
            em = ii.get('extmetadata', {})
            out.append({'title': pg['title'], 'url': ii['thumburl'], 'page': ii.get('descriptionurl', ''),
                        'license': em.get('LicenseShortName', {}).get('value', ''),
                        'artist': re.sub('<[^>]+>', '', html.unescape(em.get('Artist', {}).get('value', '')))[:120]})
        if 'continue' not in r: break
        cont = r['continue']
    return out[:PER_Q]

def fetch(job):
    rec, path = job
    if os.path.exists(path): return True
    try:
        b = requests.get(rec['url'], headers=UA, timeout=30)
        if b.status_code != 200 or len(b.content) < 3000: return False
        open(path, 'wb').write(b.content); return True
    except Exception:
        return False

manifest, t0 = [], time.time()
for cls, qs in COMMONS_Q.items():
    for qi, q in enumerate(qs):
        d = f'{RAW}/{cls}/commons_{qi}'; os.makedirs(d, exist_ok=True)
        try:
            recs = commons_search(q)
        except Exception as e:
            print('search failed', q, e); continue
        jobs = []
        for k, rec in enumerate(recs):
            ext = os.path.splitext(rec['url'].split('?')[0])[1].lower() or '.jpg'
            path = f'{d}/{k:04d}{ext}'; jobs.append((rec, path))
        with cf.ThreadPoolExecutor(8) as ex:
            ok = list(ex.map(fetch, jobs))
        for (rec, path), good in zip(jobs, ok):
            if good: manifest.append({'class': cls, 'query': q, 'file': path, **rec})
        print(f'{cls:10s} {q[:40]:40s} {sum(ok)}/{len(recs)}')
with open(f'{OUT}/commons_manifest.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=['class', 'query', 'file', 'title', 'url', 'page', 'license', 'artist']); w.writeheader(); w.writerows(manifest)
from collections import Counter
print('Commons images:', len(manifest), dict(Counter(m['class'] for m in manifest)))
print('Licences:', Counter(m['license'] for m in manifest).most_common(8))
print('minutes', round((time.time() - t0) / 60, 1))
