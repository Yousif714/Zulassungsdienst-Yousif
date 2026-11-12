---
description: Session-Übergabe – Projektstand sichern, committen, pushen
---
Sichere den aktuellen Arbeitsstand für die nächste Session. Lies dafür nur, was nötig ist:

1. `git status --short` und `git log --oneline -10` prüfen.
2. In `docs/PROJEKT-STAND.md` nur den Abschnitt „Stand & nächste Schritte“ aktualisieren: was fertig ist, was offen ist und was als Nächstes kommt. Maximal 10 Zeilen.
3. Neue Architektur- oder Regelentscheidungen dieser Session in die Spec eintragen (`docs/superpowers/specs/…`, Abschnitt 4a oder passend). Verschobene Befunde gehören in `docs/phase2-backlog.md`. Keine Doppelungen.
4. Wenn nötig, die Grundregeln in `CLAUDE.md` anpassen. Die Datei bleibt kurz, nur dauerhaft gültige Regeln.
5. Alles committen (`docs: Session-Übergabe …`) und auf den aktuellen Branch pushen.
6. Am Ende in 3 Zeilen melden, was gesichert wurde, und empfehlen: `/clear`.
