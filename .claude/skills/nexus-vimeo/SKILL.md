---
name: nexus-vimeo
description: Use whenever NEXUS-Werbung, Reels, Trailer oder Clips aus den NEXUS-Live-Calls, Masterclasses oder Seele-Calls entstehen sollen, oder wenn Inhalte aus Yousifs Vimeo-Bibliothek gesucht, zitiert oder geschnitten werden müssen ("Ausschnitte aus den Calls", "was hat X im Call gesagt", "Vimeo", "Transkript").
---

# NEXUS Vimeo: Calls finden, Zitate suchen, Ausschnitte schneiden

Yousifs Vimeo-Konto enthält ~137 NEXUS-Aufnahmen (Live-Calls, Seele-Calls,
Finanz-/Bitcoin-Masterclasses, Gnade-Reihe, Gast-Stories, Legion-Calls).
Fast alle haben deutsche Auto-Transkripte (VTT) und Download-Dateien bis 1440p.

## Voraussetzung (Umgebung)

- Cloud-Umgebung **„NEXUS Video“**: Der Vimeo-Token ist dort als Netzwerk-Secret
  für `api.vimeo.com` hinterlegt, der Proxy hängt ihn automatisch an.
  **Niemals** nach dem Token fragen oder ihn in Code/Dateien schreiben.
- Erlaubte Hosts: api.vimeo.com, player.vimeo.com, captions.cloud.vimeo.com,
  download-video-ak.vimeocdn.com (+ i/f.vimeocdn.com, vimeo.com).
- Kommt ein 403 „CONNECT tunnel failed“ für einen neuen `*.vimeocdn.com`-Host:
  per `get_environment` + `update_environment` genau diesen Host ergänzen.
- 401 von api.vimeo.com → Token abgelaufen/falsch: per `request_credential`
  neu anfordern (Anleitung: developer.vimeo.com/apps → App → „Authenticated (you)“,
  Scopes Public, Private, Video Files).

## Werkzeug

`scripts/vimeo.py` (nur curl + ffmpeg, kein pip). Cache-Ordner per
`NEXUS_VIMEO_CACHE` auf das Scratchpad legen, nicht ins Repo.

```bash
V=".claude/skills/nexus-vimeo/scripts/vimeo.py"
export NEXUS_VIMEO_CACHE=<scratchpad>/vcache
python3 $V list                         # ID, Dauer, Datum, Titel
python3 $V find bitcoin                 # Titel-Suche
python3 $V transcripts-all              # alle Transkripte cachen (~2 min)
python3 $V search "eisen" --context 2   # Volltextsuche in allen Calls
python3 $V transcript 1216943870        # ein Transkript mit [h:mm:ss]
python3 $V clip 1216943870 0:05:12 18 out.mp4   # Ausschnitt, 1080p, direkt gestreamt
python3 $V still 1216943870 0:05:12 frame.jpg   # Standbild
```

`clip` springt per HTTP-Range direkt zur Stelle; ein 50-Minuten-Call muss nicht
komplett geladen werden. Für Reels danach auf 9:16 bringen (crop/pad) und mit dem
`videoschnitt`-Standard weiterarbeiten.

## Vorgehen für Werbe-Clips

1. **Ziel klären:** Welche Botschaft? (z. B. „wöchentliche Live-Calls“, „echte
   Ergebnisse“, „Glaube + Geld + Brüderlichkeit“). Länge, Format (meist 9:16).
2. **Material finden:** `transcripts-all`, dann `search` nach Schlüsselwörtern
   der Botschaft. Starke Sätze sind kurz (≤ 12 s), stehen für sich, haben Emotion
   oder eine klare Zahl/Aussage.
3. **Shortlist** mit Video-ID, Zeitstempel, Wortlaut vorlegen, bevor geschnitten
   wird, wenn die Auswahl inhaltlich heikel sein könnte (Politik, Religion,
   Aussagen von Gästen/Mitgliedern).
4. **Schneiden:** `clip` mit 0,5 s Vorlauf/Nachlauf, Satzgrenzen aus dem
   Transkript. Untertitel aus dem Transkript-Wortlaut, Rechtschreibung prüfen
   (Auto-Transkripte haben Fehler, z. B. Eigennamen).
5. **Sichtbar machen:** Zwischen den Call-Ausschnitten Motion Graphics einbauen
   (Zähler, Kalender-Raster der Calls, Bibliotheks-Kacheln, Handy-Mockup mit
   Portal-Aufnahmen). Dafür `motion-video` / `motion-craft`; optional KI-B-Roll
   über `muapi-ki-video`.
6. **QA:** Ton synchron, keine abgeschnittenen Wörter, Lesezeit der Untertitel,
   keine privaten Inhalte von Mitgliedern ohne Freigabe.

## Inhalts-Hinweise

- Calls mit Mitgliedern (Onboarding, Legion-Besprechungen, „GMT…Recording“)
  können private Aussagen enthalten → vor öffentlicher Nutzung Yousif fragen.
- Titel wie „Zensiert“ oder politische Calls nur nach ausdrücklicher Freigabe.
- Vimeo-Daten nur lesen. Nichts hochladen, löschen oder umbenennen, außer
  Yousif verlangt es ausdrücklich.
