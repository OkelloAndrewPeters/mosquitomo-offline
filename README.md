# MosquitoMo Offline: small AI for malaria prevention where the network ends

**Hack-Nation 7th Global AI Hackathon · Challenge 4: Small AI for Development (World Bank) · Sector: Health**
Built 3–4 October 2026 by **Team Moja**: Okello Andrew Peters, a one-person team from Kampala, Uganda. ("Moja" means "one" in Swahili.)

**Live app:** **https://okelloandrewpeters.github.io/mosquitomo-offline/** · **Training notebook:** [`training/MosquitoMo_SiteNet_Colab.ipynb`](training/MosquitoMo_SiteNet_Colab.ipynb)

> **Problem statement.** Because of this tool, **any Ugandan, and any village health team (VHT) worker,** will see when mosquito-breeding risk is rising where they live, and confirm and clear breeding sites around them, **weeks before malaria cases peak**, even with no internet. Today they find out late, when clinics fill up. We know this because malaria cases in Uganda rise 2–8 weeks after heavy rain (Iganga–Mayuge HDSS), and there is only about one entomologist per district to check breeding sites.

**In one line:** AirQo made air pollution visible to every Ugandan. MosquitoMo Offline does the same for mosquito-breeding risk, on any phone and without a connection.
---

## What it does

| | Feature | AI? | Works offline? |
|---|---|---|---|
| 📷 | **Check water.** Photograph standing water. **SiteNet**, a 1.5M-parameter vision model running *on the phone*, says whether it is a likely breeding site, what kind (puddle, blocked drain, tyres/containers, brick or construction pit, swamp/paddy) and the specific fix. | **Yes**: on-device computer vision | Yes |
| 📍 | **Risk.** A 0–100 breeding-risk reading for the user's location and an 8-week outlook, computed on the phone from rainfall, temperature, humidity and terrain. **Offline pack:** the first time the app is online, it saves weather for **108 Ugandan district towns and Kampala neighbourhoods**: 3 batched requests, about 300 KB. After that, searching "Gulu" works in airplane mode, with a town-level reading. | Transparent rule-based model (no ML) | Yes, for up to 16 days after the last sync, for any saved place or any of the 108 towns (offline search uses a bundled 5 KB gazetteer) |
| 🗂️ | **Reports.** Confirmed sites are saved on the phone with the photo and GPS, then shared to a health worker by WhatsApp or SMS when there is signal (*store-and-forward*). | — | Yes (saving); sharing needs signal |
| 🗣️ | **Local language.** The whole interface is in **English, Kiswahili and Luganda**, with spoken advice where the phone has a voice for that language. | — | Yes |

## Who it is for

| User | What they get |
|---|---|
| **Every Ugandan household** (the main audience) | A daily, local reading of mosquito-breeding risk with an 8-week outlook, so families clear water and use nets *before* the risk peaks, not after someone has fever. Works on a low-cost Android phone, in English, Kiswahili or Luganda, with no data bundle. |
| **Village health teams (VHTs) and community health workers** | The frontline layer. A photo check that confirms and classifies breeding sites on household rounds, and reports saved offline and shared with the LC or health centre when back in signal. This turns public alerts into action. |
| **Schools, landlords and local councils (LCs)** | Early warning of when to organise drain clearing and clean-ups, and evidence (photos and GPS) of the sites that need it. |
| **Travellers and tourists** | The risk for any of 108 towns, offline, plus a clear reminder that malaria prevention and medical advice still apply everywhere in Uganda, whatever the reading. |

**What it measures, honestly:** MosquitoMo Offline does **not count mosquitoes**. It estimates **how favourable conditions are for mosquito breeding and malaria transmission** (rain over the past weeks, temperature, humidity and terrain), and checks **breeding sites** from photos. Mosquito counts would need traps or partner data, such as VectorCam field surveillance, which is a natural next step.

**A day with it.** After heavy rain, Sarah in Kawempe sees her parish move to *Elevated*. She drains the puddle by her door and the family sleeps under nets. Her VHT, Joseph, is on household rounds with no signal. He photographs a blocked drain and a pile of tyres. The app confirms both as likely breeding sites and suggests the fix. He shares the reports with the LC that evening when he is back in coverage.

## Why AI, and why not a simpler tool?

- **An SMS or spreadsheet can carry a report, but it cannot check it.** Not every patch of water breeds *Anopheles*, and supervisors cannot visit every report. SiteNet confirms and classifies each photo on the spot. Reports arrive pre-triaged, so a VHT supervisor checks the uncertain ones instead of all of them.
- **A cloud vision API would fail exactly where it is needed**, because there is no signal at the puddle. A data bundle is also a real cost. SiteNet runs in about **25–100 ms (single-thread WebAssembly, measured in Chromium; phone timings in the demo) on the phone, with zero bytes uploaded**.
- **The risk reading is deliberately *not* ML.** It is a published, explainable formula. A black box should not tell families when to worry.

## Technical depth: infrastructure, models, APIs

```
Colab (T4 GPU) ── training ──▶ SiteNet INT8 ONNX (~1.5 MB) ──▶ GitHub Pages (static) ──▶ phone (PWA, service-worker cache)
   │  OpenCLIP ViT-B/32 teacher                                                            │
   │  MobileNetV3-Small student                                                            ├─ ONNX Runtime Web (WASM, 1 thread)
   └─ Wikimedia Commons + web images                                                       ├─ risk engine (JS) ◀─ Open-Meteo (cached 16 days)
                                                                                           └─ IndexedDB (reports, photos)
```

**Models**
- **Teacher:** OpenCLIP **ViT-B/32** (`laion2b_s34b_b79k`, about 150M parameters). It does zero-shot classification with prompt ensembles per habitat class, and is used to (a) clean noisy web labels and (b) produce soft labels.
- **Student, which ships to the phone:** **MobileNetV3-Small** (timm, ImageNet-pretrained, about 1.5M parameters). It is fine-tuned by **knowledge distillation**: (1−α)·CE(cleaned labels, class-weighted, label smoothing 0.05) + α·T²·KL(student‖teacher) with T = 2 and α = 0.5, using AdamW and OneCycle for 14 epochs at 224 px with augmentation.
- **Compression: what worked and what did not.** Standard **static INT8** (weights and activations, QDQ, 300-image calibration) **collapsed the model to 21.6%**, which is chance level. Dynamic Conv quantization did the same (31% agreement). This is a known weak spot of MobileNetV3's hard-swish and squeeze-excite activations. We therefore ship **weight-only INT8**: per-channel symmetric 8-bit weights with `DequantizeLinear`, and FP32 compute. It is **6.1 MB → 1.65 MB (1.46 MB gzipped)** with **99% top-1 agreement** with the FP32 model on 96 test-derived inputs (mean |Δp| = 0.06). See `training/weight_only_int8.py`.
- **Results (477 held-out test images, never seen in training):**

| Metric | Value |
|---|---|
| **Breeding site present vs absent** (the decision the VHT acts on) | **87.4%** |
| 6-class accuracy · macro-F1 | 69.6% · 68.0% |
| Per-class F1 | wetland 0.79 · puddle 0.77 · no site 0.70 · drain 0.65 · containers 0.59 · pits 0.58 |
| Student vs teacher agreement | 69.6% (1.5M-parameter student vs 150M-parameter teacher) |

  Training stopped improving after epoch 10, which means the model was capacity-limited rather than under-trained. Containers and pits get confused most, often with each other. A MobileNetV3-Large student (about 4M parameters) is the next experiment (`training/planB_larger_student_cell.py`).

**Inference on the phone:** ONNX Runtime Web 1.30 (WebAssembly, SIMD, single thread, because GitHub Pages is not cross-origin isolated and one thread also suits low-end phones). Preprocessing is a 256 px resize, a 224 centre-crop and ImageNet normalisation. I verified that the browser output gives the **same top class as Python ONNX Runtime**, with probabilities within about 3 points (the difference comes from canvas vs PIL resizing).

**APIs called (all keyless and free):**
- **Open-Meteo** forecast API: 92 days of past weather and a 16-day forecast, with daily rain, mean temperature and humidity. One call of about 4 KB.
- **Open-Meteo** elevation API: a 9-point ring around the user to work out whether they are in a valley or on a ridge.
- **OpenStreetMap Nominatim:** place names and search.

**What travels over the network:** after the first visit, only weather refreshes: about 4 KB per place, and about 300 KB for the 108-town offline pack, refreshed at most twice a day. Photos never leave the phone unless the user shares a report.

**Size budget (one-time download):**

| Part | Size |
|---|---|
| App code, icons, text in 3 languages | ~0.1 MB |
| SiteNet model (weight-only INT8) | **1.65 MB** (1.46 MB gzipped) |
| ONNX Runtime Web (WASM) | 14.2 MB raw, **3.7 MB gzipped** |

Everything is cached by the service worker. The model file is small enough to **side-load over Bluetooth or send on WhatsApp**.

## Data

| Dataset | Use | Licence | Size |
|---|---|---|---|
| **Wikimedia Commons** (40 searches across 6 classes, via the MediaWiki API) | Training and test images | Open licences, recorded per image at download: CC BY-SA 4.0/3.0/2.0, CC BY 4.0/2.0, CC0, public domain | about 3,950 images |
| Bing image search results (36 queries) | Extra training images | Unknown; used only to train, not redistributed | about 410 images |

After de-duplication: **4,362 unique images**. The CLIP teacher **kept 3,179** (it relabelled 1,074 and dropped 1,183). Per class: no site 683 · puddle 635 · drain 236 · containers 419 · pits 537 · wetland 669. Split 70/15/15: 2,225 train, 477 validation, 477 test. *(The per-image licence manifest was lost when the Colab runtime disconnected. The notebook regenerates it on every run.)*
| OpenCLIP ViT-B/32, LAION-2B | Teacher labels | MIT (code), LAION-2B (CC BY 4.0 metadata) | — |
| Open-Meteo (ECMWF IFS, DWD ICON and others) | Risk engine inputs | CC BY 4.0 | live |
| OpenStreetMap | Place names | ODbL | live |

**What the data does *not* cover (be honest):**
- **Few Ugandan field photos.** Most images are from elsewhere, many from Europe and North America. Muddy brown peri-urban drains, jerrycans and brick pits as they look in Kawempe are under-represented.
- **No larvae.** The model sees *water that could breed mosquitoes*, not mosquitoes or larvae. It cannot tell *Anopheles* habitat from *Aedes* or *Culex* habitat.
- **Labels come from a model (CLIP), not entomologists.** Test-set labels share the teacher's biases, so the accuracy above is an *upper bound* on field accuracy.
- **Drains are the weakest class** (236 images). Many 'drain' photos were dry or had no visible water, so the teacher moved them elsewhere.
- **Includes some unrelated web photos** (for example, news photos of people) in the 'no site' class, from the web-search part of the data.
- **No night, close-up macro or very blurry phone shots.**
- **The risk engine is not yet calibrated against clinic data** (DHIS2). Its weights come from published lag and temperature studies.

**Next data step:** consented photos from VHT pilot users, labelled by VHT supervisors, then retraining.

## Guardrails (human in the loop)

- **"Not sure, take a closer photo":** if the top class is below 50% confidence, the app says so and shows its *best guess*, labelled as a guess. Nothing can be saved as a report when the model is unsure.
- **The model only informs.** The VHT or the household decides what to do. The app never contacts anyone by itself. Sharing is a deliberate tap.
- **No diagnosis.** The app never interprets symptoms. It only gives the standard prevention advice: nets, draining water, and "fever? test within 24 hours".
- **A fixed list of answers.** Every output is one of 6 classes plus pre-written advice, so nothing is generated and nothing can be hallucinated.
- **Privacy:** photos and GPS stay in the phone's IndexedDB until the user shares them. There is no account, no server and no tracking. If the phone is lost, reports can be deleted in one tap. A PIN lock is on the roadmap.
- **Safe messaging:** there is no "safe" level. Baseline protection advice is shown at every risk level.

## Local language

The interface and all advice are in **Kiswahili** and **Luganda** as well as English. Spoken advice uses the phone's own on-device voices (Web Speech API), so it works offline where a voice exists, which is usually English and Swahili.

**For a less-supported language** (for example Acholi or Lusoga): the vision model is language-independent. Adding a language means translating about 70 short strings in `js/i18n.js`, which can be done by a community health worker in an afternoon. Voice would need recorded clips, because most phones have no Acholi voice.

*The Luganda and Swahili text is a first draft and must be reviewed by native speakers and health workers before field use.*

## Run it

- **App:** any static host. `python3 -m http.server` in this folder, then open `http://localhost:8000`.
- **Retrain:** open the notebook in Colab, switch to a T4 GPU, then Run all (about 35 minutes). Copy `sitenet.onnx` and `sitenet_meta.json` into `models/`.

## Scalability and what happens next

- **Replicable:** the risk engine works for any coordinates in the world, because Open-Meteo is global. SiteNet's classes describe habitats found across sub-Saharan Africa and South Asia.
- **Next:** (1) a field pilot with VHTs in Kawempe, Kampala, collecting consented photos and retraining; (2) calibrating the risk index against DHIS2 weekly malaria data; (3) SMS and USSD alerts for button phones; (4) syncing confirmed sites to DHIS2 as a community event.

## Prior work and disclosure

This builds on **MosquitoMo**, my concept (concept note dated 30 September 2026) for a public mosquito-risk service in Uganda. Before the hackathon there was also an online-only web pilot, in a separate repository, with a rule-based risk index, a map and a reporting form. It had no AI and no offline mode.

**Everything in this repository was written during the hackathon (3–4 October 2026)**: the offline-first app, the on-device SiteNet model and its training pipeline, and the three-language interface. The risk formula follows the concept note's published-evidence design and was re-implemented here for offline use.

## My take: what localising AI means to me

I live in Kampala, where malaria is part of ordinary life, not a statistic. For me, localising AI means three things.

**It runs on what people already have.** A cheap Android phone, an expired data bundle, and a language that isn't English. That is why the model is 1.65 MB, why the app works in airplane mode, and why it speaks Luganda and Kiswahili. AI that only works on fast Wi-Fi in a big office is not built for us.

**It starts from our problems and our evidence.** The 2–8-week lag between rain and malaria comes from studies in Iganga and Mayuge. AirQo, built at Makerere, showed that a Ugandan team can make an invisible risk visible to everyone. I want to do the same for mosquitoes.

**It is honest about what it doesn't know.** My model learned mostly from photos taken outside Uganda, so it can be confidently wrong about a Kawempe drain. That is why it says "not sure, take a closer photo", why a person always decides, and why the next dataset must come from Ugandan health workers and communities themselves. Localising AI is not only translating the buttons. It is making sure our own streets, our own languages and our own people are in the data.

---
*Not medical advice. A pilot research prototype.* Weather data © Open-Meteo.com (CC BY 4.0). Places © OpenStreetMap contributors. ONNX Runtime Web © Microsoft (MIT).
