# Demo video script: MosquitoMo Offline (target 3 min 30 s, max 5 min)

Record on a phone screen (Android screen recorder) plus 2–3 short shots of real places. Speak slowly. Say the language names out loud.

---

## 1. Problem statement (0:00–0:30)
**On screen:** a photo of a puddle or blocked drain in Kampala (take one tonight or tomorrow morning), then the MosquitoMo logo.

> "Malaria is still Uganda's biggest killer: about 13 million cases a year. Cases rise two to eight weeks after heavy rain, because rain leaves pools where mosquitoes breed. Families can't see that risk coming. Village health teams are meant to find and clear those pools, but a district has about one entomologist, and many people have no data bundle when they're standing at the puddle. AirQo made air pollution visible to every Ugandan. I want to do the same for mosquitoes.
> **Because of MosquitoMo Offline, any Ugandan, and any village health worker, will see when mosquito-breeding risk is rising where they live, and clear breeding sites weeks before malaria cases peak, even with no internet, instead of finding out when clinics fill up. We know this because Ugandan data shows cases peak about four weeks after heavy rain."**

## 2. AI capabilities and why not a simpler tool (0:30–1:15)
**On screen:** the diagram from the README (teacher → student → INT8 → phone).

> "The AI is SiteNet, a computer-vision model small enough to run on a cheap phone with no internet. I trained it this weekend. A large model, OpenCLIP, trained on about two billion image–text pairs, labelled and cleaned thousands of openly licensed photos from Wikimedia Commons. Then I distilled what it knows into a tiny MobileNet, 1.5 million parameters, and quantized it to 8-bit. The whole model is about [SIZE] megabytes, small enough to send on WhatsApp.
> Why not just SMS? SMS can carry a report, but it can't check it. Not every patch of water breeds mosquitoes, and no supervisor can visit every report. SiteNet checks each photo on the spot, offline, in about [MS] milliseconds.
> Guardrails: if it isn't sure, it says 'not sure, take a closer photo', and you can't save an unsure report. It gives one of six fixed answers with pre-written advice, so it can't make things up. It never diagnoses anyone. And the person always decides what to do."

## 3. Tool demo (1:15–2:45), the most important part
**Turn on airplane mode at the start and show it on screen.**
1. Open the installed app from the home screen. Point out "offline" in the status bar.
2. **Risk tab:** "This is the breeding risk for Kalerwe, [score], [level], computed on the phone from 92 days of saved weather. It works for 16 days without data." Point at the rain bars, then the risk bars. "Heavy rain four weeks ago means risk now."
3. **Switch language to Luganda** (and Kiswahili). Tap **Listen** if a voice is available.
4. **Check water tab:** photograph a real puddle, drain or tyre (or a printed photo). Show the result: type, confidence, "Checked on this phone in X ms. No internet used." Read the fix.
5. Photograph something dry (floor, road): show "No breeding site seen".
6. Photograph something ambiguous or blurry: show **"Not sure"** (the guardrail).
7. **Save report**, go to **Reports**, then **Share with health worker**. Turn airplane mode off and show it going to WhatsApp.

## 4. The gap, and the tech stack (2:45–3:15)
**On screen:** README tech section.

> "Where it sits in her day: after rain, on household rounds. Check risk, photograph the water, fix it or report it, and share when there's signal.
> Stack: trained in Google Colab on a T4 GPU. OpenCLIP teacher, MobileNetV3 student, ONNX export with static INT8 quantization. On the phone: ONNX Runtime Web in WebAssembly, a service worker for offline, IndexedDB for reports. APIs: Open-Meteo for weather and elevation, OpenStreetMap for places. No server, no accounts.
> And what the data doesn't cover: few Ugandan field photos, no larvae, and labels from a model rather than entomologists. So the next step is a pilot in Kawempe, collecting consented VHT photos to retrain."

## 5. My take: localising AI (3:15–3:45)
*(Say this in your own words. Some prompts:)*
- Why you, a Ugandan, built this for Kampala and not for a generic user.
- Localising means **the phone people have, the language they speak, and data that looks like their streets**, and admitting where the data doesn't.
- The risk: a model trained on foreign photos can be confidently wrong about a Ugandan drain. That's why it says "not sure", and why the next dataset must come from VHTs themselves.

---
**Checklist before recording:** model installed and working offline · languages switch · a real puddle or drain photo ready · a dry photo · a blurry photo · WhatsApp set up · screen recorder on · airplane mode shown at the start.
