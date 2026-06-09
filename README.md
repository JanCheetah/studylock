# StudyLock – Dein persönlicher Klausur-Coach

**StudyLock** ist ein intelligenter, lokaler Klausur-Coach für Studierende. Die App hilft dir dabei, deine Lernmaterialien strukturiert aufzubereiten, einen maßgeschneiderten täglichen Lernplan zu erstellen und dich mithilfe von Spaced Repetition (aktivem Erinnern) optimal auf deine Prüfungen vorzubereiten.

## Features

- 📁 **Material-Import:** Lade deine Vorlesungs-PDFs oder Zusammenfassungen hoch. Der Text wird extrahiert und automatisch in Lernfragen unterteilt.
- ⚙️ **Klausur-Profiling:** Definiere dein Prüfungsdatum, deine Wunschnote und dein tägliches Lernzeit-Budget. StudyLock berechnet daraus deinen optimalen Lernpfad.
- 📅 **Täglicher Lernplan:** Jeden Tag generiert StudyLock eine maßgeschneiderte Session aus neuen Begriffen, Wiederholungen und Schwachstellen.
- ⚡ **Panic Mode:** Wenn die Klausur kurz bevorsteht, priorisiert StudyLock automatisch die wichtigsten Themen und deine größten Lücken.
- 📊 **Readiness Dashboard:** Behalte deinen aktuellen Wissensstand pro Thema und deine Gesamtkurs-Readiness im Auge.
- ☁️ **Cloud-Sync (Supabase):** Nutze StudyLock komplett lokal im Browser (localStorage) oder logge dich per Magic-Link ein, um deine Daten sicher in der Cloud zu synchronisieren.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Vanilla CSS (Glassmorphism & Dark Mode)
- **PDF-Parsing:** pdfjs-dist
- **Datenbank & Auth:** Supabase (PostgreSQL, Row Level Security)
- **Testing:** Vitest

## Installation & Start

1. **Abhängigkeiten installieren:**
   ```bash
   npm install
   ```

2. **Entwicklungsserver starten:**
   ```bash
   npm run dev
   ```

3. **Tests ausführen:**
   ```bash
   npm run test
   ```

4. **Projekt bauen:**
   ```bash
   npm run build
   ```

## Projektstruktur

- `src/components/` – Wiederverwendbare UI-Komponenten und Screens (Dashboard, Import, Active Session, etc.)
- `src/hooks/` – Custom React Hooks für zustandsorientierte Logik (Dokumente, Profil, Session, Sync)
- `src/lib/` – Hilfsfunktionen und Kernlogik (z. B. `studyEngine.ts` für Spaced Repetition und Readiness)
- `src/lib/repositories/` – Repository-Pattern zur Abstraktion von lokalem Storage und Supabase-Cloud-Sync
- `src/types.ts` – Globale TypeScript-Typdefinitionen
