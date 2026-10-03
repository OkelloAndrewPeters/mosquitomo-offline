"""Builds training/MosquitoMo_SiteNet_Colab.ipynb — run: python make_notebook.py"""
import json

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md(r"""
# MosquitoMo SiteNet: on-device breeding-site classifier

**Hack-Nation 7th Global AI Hackathon, Challenge 4: Small AI for Development (World Bank)**, 3–4 October 2026.

This notebook trains a **small model that runs offline on low-cost phones**. It recognises the standing-water habitats where malaria mosquitoes breed, from a single photo.

Pipeline:
1. **Data**: collect open web images for 6 habitat classes, then de-duplicate and clean them.
2. **Teacher**: **OpenCLIP ViT-B/32** (LAION-2B, ~150M params) labels every image zero-shot, using prompt ensembles. It removes noisy images and gives *soft labels*.
3. **Student**: **MobileNetV3-Small** (~1.5M params, ImageNet-pretrained), trained by **knowledge distillation**: a cross-entropy term on cleaned labels plus a KL term to the teacher's soft labels.
4. **Evaluation**: a held-out test set with accuracy, macro-F1, a confusion matrix and student–teacher agreement.
5. **Export**: ONNX FP32, then **static INT8 quantization** (QDQ, per-channel). The model runs in the browser with ONNX Runtime Web (WebAssembly), fully offline.

**Runtime → Change runtime type → T4 GPU**, then **Runtime → Run all**. It takes about 30–40 minutes. At the end, a zip downloads with the model, labels and metrics.
""")

code(r"""
!nvidia-smi -L || echo "No GPU: go to Runtime > Change runtime type > T4 GPU"
!pip -q install open_clip_torch timm icrawler onnx onnxruntime onnxscript imagehash scikit-learn
""")

code(r"""
import os, json, time, random, hashlib, shutil, glob, math, io
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from PIL import Image
random.seed(0); np.random.seed(0); torch.manual_seed(0)
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
ROOT = '/content/sitenet'; RAW = f'{ROOT}/raw'; OUT = f'{ROOT}/out'
os.makedirs(RAW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
print('device', DEVICE)

# The 6 habitat classes. Keys are stable IDs used by the app.
CLASSES = ['no_site', 'puddle', 'drain', 'container', 'pit', 'wetland']
LABELS = {
  'no_site':   'No breeding site visible',
  'puddle':    'Puddle, pothole or tyre ruts',
  'drain':     'Blocked drain or ditch',
  'container': 'Tyres or containers holding water',
  'pit':       'Brick, quarry or construction pit',
  'wetland':   'Swamp edge or rice paddy',
}
# Search queries used to collect candidate images for each class (several angles each).
QUERIES = {
  'no_site': ['dry dirt road africa', 'clean dry concrete drain', 'village compound swept dry', 'green lawn garden dry',
              'market street kampala', 'house interior living room', 'dry field maize uganda', 'tarmac road sunny day'],
  'puddle': ['muddy puddle dirt road africa', 'rain puddle pothole road', 'tyre ruts filled with rainwater',
             'stagnant rainwater puddle ground', 'flooded footpath after rain'],
  'drain': ['blocked drainage channel stagnant water garbage', 'clogged storm drain stagnant water',
            'open drain trench stagnant water africa', 'roadside ditch stagnant water', 'blocked gutter water rubbish'],
  'container': ['discarded tyres holding rainwater', 'old car tyres with water inside', 'plastic containers collecting rainwater',
                'buckets full of rainwater outdoors', 'jerrycans and bottles with stagnant water', 'flower pot saucer with water'],
  'pit': ['brick making pit filled with water', 'construction site excavation filled with water', 'flooded quarry pit',
          'borrow pit rainwater', 'foundation trench flooded'],
  'wetland': ['rice paddy field water uganda', 'papyrus swamp edge', 'wetland marsh stagnant water africa', 'flooded rice field'],
}
PER_QUERY = 120
""")

md("## 1. Collect candidate images")
code(r"""
from icrawler.builtin import BingImageCrawler
import logging; logging.getLogger('icrawler').setLevel(logging.ERROR)
t0 = time.time()
for cls, qs in QUERIES.items():
    for qi, q in enumerate(qs):
        d = f'{RAW}/{cls}/{qi}'
        if os.path.isdir(d) and len(os.listdir(d)) > 20: continue
        os.makedirs(d, exist_ok=True)
        for attempt in range(2):
            try:
                BingImageCrawler(downloader_threads=8, storage={'root_dir': d}).crawl(keyword=q, max_num=PER_QUERY, min_size=(160, 160))
                break
            except Exception as e:
                print('retry', q, e); time.sleep(3)
        print(f'{cls:10s} {q[:45]:45s} {len(os.listdir(d))}')
print('download minutes', round((time.time() - t0) / 60, 1))
""")

md("### 1b. More data: Wikimedia Commons (openly licensed; per-image licence recorded)")
code(r"""
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

""")

code(r"""
# Clean: open, convert to RGB, drop tiny or corrupt images and near-duplicates (perceptual hash)
import imagehash
items, seen = [], set()
for cls in CLASSES:
    for p in glob.glob(f'{RAW}/{cls}/*/*'):
        try:
            im = Image.open(p); im.load(); im = im.convert('RGB')
            if min(im.size) < 128: continue
            h = str(imagehash.phash(im.resize((256, 256))))
            if h in seen: continue
            seen.add(h); items.append((p, cls))
        except Exception:
            pass
print('unique images:', len(items))
for c in CLASSES: print(f'  {c:10s}', sum(1 for _, k in items if k == c))
""")

md("## 2. Teacher: OpenCLIP zero-shot labelling with prompt ensembles")
code(r"""
import open_clip
teacher, _, clip_pre = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k', device=DEVICE)
tok = open_clip.get_tokenizer('ViT-B-32'); teacher.eval()
PROMPTS = {
  'no_site':   ['a photo of dry ground with no standing water', 'a photo of a clean dry street', 'a photo of a room indoors',
                'a photo of a dry field', 'a photo of a person', 'a photo of a dry concrete surface'],
  'puddle':    ['a photo of a muddy puddle of rainwater', 'a photo of a pothole filled with water', 'a photo of tyre ruts filled with water',
                'a photo of stagnant water on the ground'],
  'drain':     ['a photo of a blocked drain with stagnant water', 'a photo of a drainage ditch full of dirty still water and rubbish',
                'a photo of a clogged gutter with water'],
  'container': ['a photo of old tyres holding rainwater', 'a photo of plastic containers full of water outdoors',
                'a photo of buckets collecting rainwater', 'a photo of discarded bottles and cans holding water'],
  'pit':       ['a photo of a brick-making pit filled with water', 'a photo of a flooded construction excavation',
                'a photo of a quarry pit full of water', 'a photo of a flooded trench'],
  'wetland':   ['a photo of a rice paddy field with water', 'a photo of a swamp with reeds and papyrus', 'a photo of a marsh wetland'],
}
with torch.no_grad():
    W = []
    for c in CLASSES:
        e = teacher.encode_text(tok(PROMPTS[c]).to(DEVICE)); e = e / e.norm(dim=-1, keepdim=True)
        m = e.mean(0); W.append(m / m.norm())
    W = torch.stack(W)  # [6, D]

def teacher_logits(paths, bs=128):
    out = []
    for i in range(0, len(paths), bs):
        ims = torch.stack([clip_pre(Image.open(p).convert('RGB')) for p in paths[i:i + bs]]).to(DEVICE)
        with torch.no_grad(), torch.autocast(DEVICE, enabled=DEVICE == 'cuda'):
            f = teacher.encode_image(ims); f = f / f.norm(dim=-1, keepdim=True)
            out.append((100.0 * f @ W.T).float().cpu())
    return torch.cat(out)

paths = [p for p, _ in items]; qcls = [CLASSES.index(c) for _, c in items]
T_logits = teacher_logits(paths)
T_prob = T_logits.softmax(-1)
print('teacher logits', T_logits.shape)
""")

code(r"""
# Label cleaning: keep an image if the teacher agrees with its search class, or relabel it if the teacher is very sure.
keep_p, keep_y, keep_soft, dropped, relabeled = [], [], [], 0, 0
for i, (p, q) in enumerate(zip(paths, qcls)):
    pr = T_prob[i]; top = int(pr.argmax())
    if top == q and pr[q] >= 0.40:
        y = q
    elif pr[top] >= 0.75:
        y = top; relabeled += 1
    else:
        dropped += 1; continue
    keep_p.append(p); keep_y.append(y); keep_soft.append(T_logits[i])
print(f'kept {len(keep_p)}, relabeled {relabeled}, dropped {dropped}')
counts = {c: keep_y.count(k) for k, c in enumerate(CLASSES)}; print(counts)

# Stratified split 70/15/15
from sklearn.model_selection import train_test_split
idx = np.arange(len(keep_p))
tr, te = train_test_split(idx, test_size=0.30, stratify=keep_y, random_state=0)
va, te = train_test_split(te, test_size=0.50, stratify=[keep_y[i] for i in te], random_state=0)
print('train/val/test', len(tr), len(va), len(te))
""")

md("## 3. Student: MobileNetV3-Small trained by knowledge distillation")
code(r"""
import timm
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as Tr
MEAN, STD, SIZE = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225), 224
train_tf = Tr.Compose([Tr.RandomResizedCrop(SIZE, scale=(0.55, 1.0)), Tr.RandomHorizontalFlip(),
                       Tr.ColorJitter(0.3, 0.3, 0.25, 0.03), Tr.RandomRotation(10), Tr.ToTensor(), Tr.Normalize(MEAN, STD)])
eval_tf = Tr.Compose([Tr.Resize(256), Tr.CenterCrop(SIZE), Tr.ToTensor(), Tr.Normalize(MEAN, STD)])

class DS(Dataset):
    def __init__(s, ids, tf): s.ids, s.tf = ids, tf
    def __len__(s): return len(s.ids)
    def __getitem__(s, k):
        i = s.ids[k]
        return s.tf(Image.open(keep_p[i]).convert('RGB')), keep_y[i], keep_soft[i]

dl_tr = DataLoader(DS(tr, train_tf), batch_size=64, shuffle=True, num_workers=2, drop_last=True)
dl_va = DataLoader(DS(va, eval_tf), batch_size=128, num_workers=2)
dl_te = DataLoader(DS(te, eval_tf), batch_size=128, num_workers=2)

student = timm.create_model('mobilenetv3_small_100', pretrained=True, num_classes=len(CLASSES)).to(DEVICE)
print('student params (M):', round(sum(p.numel() for p in student.parameters()) / 1e6, 2))
# class weights against imbalance
cw = torch.tensor([len(keep_y) / (len(CLASSES) * max(1, keep_y.count(k))) for k in range(len(CLASSES))], dtype=torch.float).to(DEVICE)
EPOCHS, TEMP, ALPHA = 14, 2.0, 0.5
opt = torch.optim.AdamW(student.parameters(), lr=1.5e-3, weight_decay=0.02)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1.5e-3, total_steps=EPOCHS * len(dl_tr), pct_start=0.15)

def evaluate(dl):
    student.eval(); P, Y, TA = [], [], []
    with torch.no_grad():
        for x, y, s in dl:
            p = student(x.to(DEVICE)).argmax(-1).cpu(); P += p.tolist(); Y += y.tolist(); TA += s.argmax(-1).tolist()
    P, Y, TA = map(np.array, (P, Y, TA))
    return (P == Y).mean(), (P == TA).mean(), P, Y

best, hist = 0, []
for ep in range(EPOCHS):
    student.train(); tl = 0
    for x, y, s in dl_tr:
        x, y, s = x.to(DEVICE), y.to(DEVICE), s.to(DEVICE)
        out = student(x)
        ce = F.cross_entropy(out, y, weight=cw, label_smoothing=0.05)
        kd = F.kl_div(F.log_softmax(out / TEMP, -1), F.softmax(s / TEMP, -1), reduction='batchmean') * TEMP * TEMP
        loss = (1 - ALPHA) * ce + ALPHA * kd
        opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tl += loss.item()
    acc, agree, _, _ = evaluate(dl_va); hist.append((ep, tl / len(dl_tr), acc, agree))
    print(f'epoch {ep + 1:2d}  loss {tl / len(dl_tr):.3f}  val acc {acc:.3f}  teacher agreement {agree:.3f}')
    if acc > best: best = acc; torch.save(student.state_dict(), f'{OUT}/student_best.pt')
student.load_state_dict(torch.load(f'{OUT}/student_best.pt'))
""")

md("## 4. Evaluation on the held-out test set")
code(r"""
from sklearn.metrics import classification_report, confusion_matrix, f1_score
import matplotlib.pyplot as plt
acc, agree, P, Y = evaluate(dl_te)
f1 = f1_score(Y, P, average='macro')
# teacher accuracy on the same test labels (labels are teacher-cleaned, so this is an upper reference, not independent)
print(f'TEST accuracy {acc:.3f} | macro-F1 {f1:.3f} | student-teacher agreement {agree:.3f}')
rep = classification_report(Y, P, target_names=CLASSES, digits=3, output_dict=True); print(classification_report(Y, P, target_names=CLASSES, digits=3))
# "Water vs no water" — the decision that matters for verification
water_true, water_pred = (Y != 0), (P != 0)
water_acc = (water_true == water_pred).mean(); print('breeding-site present vs absent accuracy:', round(water_acc, 3))
cm = confusion_matrix(Y, P)
fig, ax = plt.subplots(figsize=(6, 5)); ax.imshow(cm, cmap='Blues')
ax.set_xticks(range(len(CLASSES)), CLASSES, rotation=45, ha='right'); ax.set_yticks(range(len(CLASSES)), CLASSES)
for i in range(len(CLASSES)):
    for j in range(len(CLASSES)): ax.text(j, i, cm[i, j], ha='center', va='center', color='white' if cm[i, j] > cm.max() / 2 else 'black')
ax.set_xlabel('predicted'); ax.set_ylabel('label'); ax.set_title('SiteNet student — test set'); plt.tight_layout(); plt.savefig(f'{OUT}/confusion.png', dpi=150); plt.show()
""")

md("## 5. Export to ONNX, quantize to INT8, check parity and latency")
code(r"""
import onnx, onnxruntime as ort
from onnxruntime.quantization import quantize_static, CalibrationDataReader, QuantFormat, QuantType
from onnxruntime.quantization.shape_inference import quant_pre_process
student.eval().cpu()
dummy = torch.randn(1, 3, SIZE, SIZE)
fp32 = f'{OUT}/sitenet_fp32.onnx'
torch.onnx.export(student, dummy, fp32, input_names=['input'], output_names=['logits'], opset_version=17,
                  dynamic_axes={'input': {0: 'batch'}, 'logits': {0: 'batch'}}, dynamo=False)
pre = f'{OUT}/sitenet_pre.onnx'; quant_pre_process(fp32, pre)

class Calib(CalibrationDataReader):
    def __init__(s, ids): s.it = iter(ids[:300])
    def get_next(s):
        i = next(s.it, None)
        if i is None: return None
        return {'input': eval_tf(Image.open(keep_p[i]).convert('RGB')).unsqueeze(0).numpy()}
int8 = f'{OUT}/sitenet_int8.onnx'
quantize_static(pre, int8, Calib(list(tr)), quant_format=QuantFormat.QDQ, per_channel=True,
                activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8)

def ort_eval(path):
    s = ort.InferenceSession(path, providers=['CPUExecutionProvider']); P = []; t = []
    for i in te:
        x = eval_tf(Image.open(keep_p[i]).convert('RGB')).unsqueeze(0).numpy()
        t0 = time.perf_counter(); o = s.run(None, {'input': x})[0]; t.append(time.perf_counter() - t0); P.append(int(o.argmax()))
    P = np.array(P); Yt = np.array([keep_y[i] for i in te])
    return (P == Yt).mean(), f1_score(Yt, P, average='macro'), np.median(t) * 1000, os.path.getsize(path) / 1e6
res = {}
for name, pth in [('fp32', fp32), ('int8', int8)]:
    a, f, ms, mb = ort_eval(pth); res[name] = dict(accuracy=round(a, 4), macro_f1=round(f, 4), median_ms_colab_cpu=round(ms, 2), size_mb=round(mb, 2))
    print(name, res[name])
""")

code(r"""
# Pick the model to ship: INT8 unless it loses more than 2 points of accuracy
ship = 'int8' if res['int8']['accuracy'] >= res['fp32']['accuracy'] - 0.02 else 'fp32'
shutil.copy(int8 if ship == 'int8' else fp32, f'{OUT}/sitenet.onnx')
meta = {
  'model': 'SiteNet (MobileNetV3-Small student distilled from OpenCLIP ViT-B/32 laion2b_s34b_b79k)',
  'trained_on': time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()), 'shipped': ship,
  'classes': CLASSES, 'labels': LABELS, 'input': {'size': SIZE, 'mean': MEAN, 'std': STD, 'layout': 'NCHW', 'resize': 256, 'center_crop': SIZE},
  'data': {'sources': 'Wikimedia Commons (open licences, per-image record in commons_manifest.csv) + Bing image search results (unknown licences, used only for training, not redistributed)', 'unique_images': len(items), 'kept_after_teacher_cleaning': len(keep_p), 'relabeled': relabeled, 'dropped': dropped,
           'per_class': counts, 'split': {'train': len(tr), 'val': len(va), 'test': len(te)}},
  'training': {'epochs': EPOCHS, 'temperature': TEMP, 'alpha_kd': ALPHA, 'optimizer': 'AdamW + OneCycle', 'history': hist},
  'test': {'accuracy': round(float(acc), 4), 'macro_f1': round(float(f1), 4), 'teacher_agreement': round(float(agree), 4),
           'site_present_vs_absent_accuracy': round(float(water_acc), 4), 'per_class': {c: {k: round(v, 3) for k, v in rep[c].items()} for c in CLASSES}},
  'onnx': res,
  'caveats': 'Images are open web images labelled by a zero-shot teacher, so test labels share the teacher\'s biases. Field validation with photos from Ugandan pilot users is the next step.',
}
json.dump(meta, open(f'{OUT}/sitenet_meta.json', 'w'), indent=2)
print(json.dumps({k: meta[k] for k in ['shipped', 'test', 'onnx']}, indent=2))
""")

code(r"""
# A grid of test predictions for the demo and write-up
s = ort.InferenceSession(f'{OUT}/sitenet.onnx', providers=['CPUExecutionProvider'])
pick = random.sample(list(te), 12)
fig, axs = plt.subplots(3, 4, figsize=(12, 9))
for ax, i in zip(axs.flat, pick):
    im = Image.open(keep_p[i]).convert('RGB'); x = eval_tf(im).unsqueeze(0).numpy()
    pr = torch.tensor(s.run(None, {'input': x})[0][0]).softmax(-1); k = int(pr.argmax())
    ax.imshow(im.resize((256, 256))); ax.axis('off')
    ax.set_title(f'{CLASSES[k]} {pr[k]:.0%}\n(label: {CLASSES[keep_y[i]]})', fontsize=9, color='green' if k == keep_y[i] else 'red')
plt.tight_layout(); plt.savefig(f'{OUT}/samples.png', dpi=110); plt.show()
""")

code(r"""
# Download the results (model + metadata + figures). Upload this zip to Claude.
import zipfile
z = f'/content/sitenet_results.zip'
with zipfile.ZipFile(z, 'w') as f:
    for n in ['sitenet.onnx', 'sitenet_fp32.onnx', 'sitenet_int8.onnx', 'sitenet_meta.json', 'confusion.png', 'samples.png', 'commons_manifest.csv']:
        if os.path.exists(f'{OUT}/{n}'): f.write(f'{OUT}/{n}', n)
print(round(os.path.getsize(z) / 1e6, 1), 'MB')
from google.colab import files; files.download(z)
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
      "kernelspec": {"display_name": "Python 3", "name": "python3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}
for c in nb["cells"]:
    c["source"] = [l + "\n" for l in c["source"].split("\n")]
    c["source"][-1] = c["source"][-1].rstrip("\n")
import os
os.makedirs('/home/claude/hack/training', exist_ok=True)
json.dump(nb, open('/home/claude/hack/training/MosquitoMo_SiteNet_Colab.ipynb', 'w'), indent=1)
print('written')
