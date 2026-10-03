# Hack-Nation submission: three 60-second videos

The form asks for **Team introduction · Product demo · Technical walkthrough**, each **MP4 or MOV, at most 60 seconds**.
Each script below is about 120–135 words (roughly 55 seconds at a calm pace). Practise once with a timer.

**Recording tips:** phone held vertically for the demo, horizontal for you talking. Use daylight, a quiet room, and the phone close to your mouth. For screen recording on Android, pull down Quick Settings → Screen record (with mic). On iPhone, Control Centre → Screen Recording (long-press → Microphone on). Trim to 60 s or less before uploading.

---

## 1. Team introduction (you on camera, 60 s)

**Shot:** you, chest-up, outdoors near a drain or homestead in Kavule if possible. Hold up the phone with the app open at the end.

> "Hi, I'm Okello Andrew Peters, and I'm Team Moja. *Moja* means *one* in Swahili, because I'm a one-person team, building from Kavule, Kampala.
>
> I built **MosquitoMo Offline** for the Health track.
>
> Malaria is still Uganda's biggest killer, with about 13 million cases a year. Cases rise **two to eight weeks after heavy rain**, because rain leaves the pools where mosquitoes breed. But families can't see that risk coming, and village health workers often have no data bundle when they're standing at the puddle.
>
> AirQo, built here at Makerere, made air pollution visible to every Ugandan. I want to do the same for mosquitoes: a breeding-risk reading and an AI photo check, on any phone, **with no internet**.
>
> To me, localising AI means our phones, our languages and our streets in the data. Thank you."

*(about 130 words)*

---

## 2. Product demo (screen recording, 60 s)

**Before recording:** open the app online once (so "108 towns saved" appears), then **turn on airplane mode** and show it in the status bar at the start.

| Time | On screen | Say |
|---|---|---|
| 0–8 s | Airplane mode on. Open MosquitoMo from the home screen. | "Airplane mode is on. No internet at all." |
| 8–20 s | **Risk** tab: Use my location → score, level, rain and risk strip. | "This is the breeding risk for where I am, worked out on the phone from 92 days of saved weather. Heavy rain weeks ago means risk now." |
| 20–27 s | Search **Gulu** → reading. | "Even Gulu works offline. 108 towns are saved on the phone." |
| 27–32 s | Switch language to **Luganda**. | "And it speaks Luganda and Kiswahili." |
| 32–48 s | **Check water**: photograph a real puddle, drain or tyre → result, % and "Checked on this phone in __ ms". | "Now I photograph standing water. The AI checks it on the phone, with no upload, and tells me what it is and how to fix it." |
| 48–55 s | Photograph something unclear → **"Not sure"** → **Save for a health worker to check**. | "If it isn't sure, it says so, and a person decides." |
| 55–60 s | **Reports** → Share with health worker. | "Reports wait on the phone until there's signal." |

---

## 3. Technical walkthrough (screen recording of README / diagram + voice, 60 s)

**Shot:** scroll the GitHub README (diagram → results table → small-vs-large table → data table).

> "Here's how it works.
>
> **The model:** SiteNet. I used OpenCLIP, a 150-million-parameter vision-language model, as a teacher. It cleaned and labelled about 4,500 openly licensed photos from Wikimedia Commons into six breeding-habitat classes. Then I distilled it into a 4-million-parameter MobileNetV3 student, trained on a Colab T4 GPU.
>
> **Compression:** standard INT8 collapsed the model to chance, so I used weight-only INT8. That's 4.4 megabytes with **no accuracy loss: 72% on six classes, 88% on site versus no site**.
>
> **On the phone:** ONNX Runtime Web in WebAssembly, with a service worker for offline, and a risk engine fed by Open-Meteo weather.
>
> **Honest limits:** few Ugandan photos and no larvae, so it flags uncertainty, and a person always decides. Next: retrain on photos from Ugandan health workers."

*(about 130 words)*

---

## Team photo
A clear photo of you (JPG/PNG/WebP, at most 10 MB), ideally holding the phone with the app open, outdoors in Kavule.
