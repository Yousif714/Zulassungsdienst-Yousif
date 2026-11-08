---
name: muapi-ki-video
description: Use when KI-generierte Videos oder Bilder (B-Roll, Szenen, animierte Fotos, Lip-Sync, Motion Graphics) über MuAPI erzeugt werden sollen, z. B. für NEXUS-Reels. Deckt Modellwahl (Seedance, Kling, Veo, MiniMax/Hailuo, Wan, Sora, Nano Banana), API-Ablauf, Kosten und Prompt-Regeln ab. Basierend auf dem Open-Generative-AI-Projekt (Anil-matcha), das nur eine Oberfläche für MuAPI ist.
---

# MuAPI: KI-Video und KI-Bilder per API

**Was das ist:** „Open Generative AI“ (github.com/Anil-matcha/Open-Generative-AI)
ist nur eine Oberfläche. Die eigentliche Arbeit macht der Bezahldienst
**MuAPI** (muapi.ai), über den man an 600+ Modelle kommt. Die App brauchen wir
nicht, wir sprechen MuAPI direkt mit `scripts/muapi.py` an.

## Voraussetzung

- MuAPI-Konto mit Guthaben und API-Key (muapi.ai → Dashboard → API Keys).
- Key per `request_credential` für Host `api.muapi.ai`, Header `x-api-key`,
  ohne Präfix. Nie im Chat einfügen lassen. Das Skript schickt einen Platzhalter,
  den der Proxy ersetzt.
- Ergebnis-Dateien liegen auf `cdn.muapi.ai`. Den Host bei Bedarf per
  `update_environment` freigeben.
- **Jeder Job kostet Geld.** Vor dem ersten Lauf eines Modells immer
  `estimate`, Kosten nennen und Freigabe holen. Erst 1 Test-Clip, dann Serie.

## API-Ablauf

```
POST https://api.muapi.ai/api/v1/<endpoint>         (x-api-key, JSON)  -> {request_id}
GET  https://api.muapi.ai/api/v1/predictions/<id>/result               -> status, outputs[0]
POST https://api.muapi.ai/api/v1/upload_file        (multipart file)   -> {url}
POST https://api.muapi.ai/api/v1/models/<endpoint>/estimate-cost (JSON) -> {cost, currency}
```
Status fertig: `completed|succeeded|success`; Fehler: `failed|error`.
Video-Jobs dauern 1 bis 15 Minuten. Bei Timeout mit `result <id>` weitermachen,
**nicht** neu absenden (das kostet doppelt).

```bash
M=".claude/skills/muapi-ki-video/scripts/muapi.py"
python3 $M upload foto.jpg                                   # -> URL
python3 $M estimate seedance-2.5-image-to-video '{"prompt":"...","image_url":"URL","duration":5,"aspect_ratio":"9:16"}'
python3 $M run seedance-2.5-image-to-video '{"prompt":"...","image_url":"URL","duration":5,"aspect_ratio":"9:16"}' out.mp4
```

## Modellwahl (Endpunkte)

| Zweck | Endpunkt | Notiz |
|---|---|---|
| Foto animieren (Yousif/Event-Fotos → Bewegung) | `seedance-2.5-image-to-video`, `kling-v3.0-pro-image-to-video`, `veo3.1-image-to-video` | Seedance: 4 bis 30 s, `image_url`, `aspect_ratio`, `duration` |
| Start- und Endbild → Übergang | `seedance-2.5-first-last-frame`, `kling-…`, `vidu-q3-pro-first-last-frames` | gut für Match-Cuts |
| Reine Text → Video B-Roll | `seedance-2.5-text-to-video`, `kling-4.0-text-to-video`, `veo-4-text-to-video`, `minimax-h3-text-to-video` | Kling/Veo realistischer, teurer |
| Mit Referenzen (Person, Ort konstant) | `seedance-2.5-omni-reference`, `kling-v3.0-omni-pro-image-to-video` | `images_list`, `video_files` |
| Günstig testen | `seedance-2.5-text-to-video-480p`, `…-480p`, `seedance-2-mini-…` | erst Idee prüfen, dann HD |
| Motion Graphics aus Prompt | `motion-graphics` | `category`: infographics, text-animation, reel …; bis 6 `images_list` |
| Bilder | `nano-banana-pro`, `seedream-5.0`, `flux-3-text-to-image`, `gpt-image-2-text-to-image` | Edit: `nano-banana-pro-edit` |

Die vollständige Liste mit Parametern steht im Repo unter
`packages/studio/src/models.js` (Felder `endpoint`, `inputs`). Bei Unklarheit
dort nachsehen statt raten. Endpunkte mit „spicy“ im Namen (weniger
Inhaltsfilter) für NEXUS **nicht** verwenden.

## Prompt-Regeln (kurz)

1. Eine Einstellung pro Clip: Motiv, Aktion, Kamera, Licht, Stimmung.
   Beispiel: „Close-up of two men's hands in a firm handshake over a wooden
   table, warm candle light, slow push-in, shallow depth of field, cinematic,
   no text.“
2. Englisch prompten, **keinen Text im Bild** generieren lassen (Text kommt
   später sauber als Motion Graphic).
3. 9:16 für Reels, 5 s Standard. Kurze Clips sind stabiler als lange.
4. Für echte Personen (Yousif) nur image-to-video aus echten Fotos, keine
   erfundenen Gesichter als „echte Mitglieder“ ausgeben.
5. KI-Material ist Beiwerk. Echte Call-Ausschnitte (`nexus-vimeo`) tragen die
   Glaubwürdigkeit, KI-B-Roll füllt nur Übergänge und Symbole.

Für Storyboard, Start-/Endbilder und das Budget pro Clip zusätzlich den Skill
`ki-video-regisseur` nutzen.
