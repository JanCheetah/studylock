# StudyLock Exam Accountability Skeleton Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn StudyLock from “PDF → cards” into a differentiated exam-coach MVP: onboarding with exam deadline, daily plan, readiness score, exam mode, panic mode, and anti-procrastination nudges.

**Architecture:** Keep the MVP local-first in the existing React/Vite app. Refactor the single `src/App.tsx` gradually by adding typed data models and pure calculation helpers first, then wiring UI sections into the current flow. Avoid backend/AI until the behavioral loop is clearly usable.

**Tech Stack:** React 19, TypeScript, Vite, localStorage, pdfjs-dist, existing CSS.

---

## Product Skeleton

### Positioning

**StudyLock — Der Klausurcoach für aufschiebende Studenten.**

Core promise:

> Lade dein Skript hoch. StudyLock baut dir tägliche 25-Minuten-Prüfungssessions, erkennt deine Lücken und zeigt dir ehrlich, ob du bestehen würdest.

### Differentiation vs ChatGPT

Not just:
- PDF hochladen
- Fragen generieren
- Chatten

Instead:
- Klausurdatum + Zielnote
- täglicher Lernplan
- prüfungsnahe Sessions
- Readiness Score
- Schwächenliste
- Panic Mode kurz vor Klausur
- Blocker-Flow bei Aufschieben

### Core User Flow

1. User imports PDF/text.
2. User sets exam profile:
   - Fach
   - Klausurdatum
   - Ziel: bestehen / 2,x / 1,x
   - Minuten pro Tag
   - Selbsteinschätzung
3. StudyLock shows daily command center:
   - Days left
   - Today’s required session
   - Readiness Score
   - weakest topics
4. User starts daily session.
5. Session asks exam-style questions.
6. User rates performance.
7. StudyLock updates plan/readiness.
8. If deadline is close, Panic Mode prioritizes high-yield items.

---

## Data Model Skeleton

Add/extend these types in `src/App.tsx` first. Later we can split into `src/types.ts`.

```ts
type ExamGoal = 'bestehen' | 'gut' | 'sehr-gut'
type Confidence = 1 | 2 | 3 | 4 | 5

type ExamProfile = {
  id: string
  subject: string
  examDate: string
  dailyMinutes: number
  goal: ExamGoal
  confidence: Confidence
  createdAt: string
  updatedAt: string
}

type TopicStat = {
  topic: string
  total: number
  good: number
  hard: number
  again: number
  readiness: number
}

type DailyPlan = {
  date: string
  minutes: number
  mode: Mode
  targetItems: number
  priority: 'normal' | 'review' | 'panic'
  message: string
}
```

Extend `StudyDocument`:

```ts
type StudyDocument = {
  id: string
  title: string
  subject: string
  text: string
  examProfileId?: string
  createdAt: string
  updatedAt: string
  items: StudyItem[]
}
```

Extend `StudyItem`:

```ts
type StudyItem = {
  id: string
  documentId: string
  topic: string
  question: string
  answer: string
  source: string
  difficulty: Difficulty
  type: 'karte' | 'quiz' | 'aufgabe'
  dueAt: string
  intervalDays: number
  repetitions: number
  lastRating?: Rating
}
```

---

## Implementation Tasks

### Task 1: Add exam profile state and persistence

**Objective:** Store exam deadline, goal, daily minutes, and confidence locally.

**Files:**
- Modify: `src/App.tsx`

**Steps:**
1. Add `ExamGoal`, `Confidence`, `ExamProfile`, `DailyPlan`, `TopicStat` types near current type definitions.
2. Add localStorage state:
   ```ts
   const [examProfiles, setExamProfiles] = useState<ExamProfile[]>(() => safeParse('studylock-exam-profiles', []))
   const [activeExamProfileId, setActiveExamProfileId] = useState<string | null>(() => safeParse<string | null>('studylock-active-exam-profile', null))
   ```
3. Add `useEffect` persistence for both.
4. Compute:
   ```ts
   const activeExamProfile = examProfiles.find((profile) => profile.id === activeExamProfileId) ?? null
   ```
5. Verify with `npm run build`.
6. Commit: `feat: add exam profile state`

---

### Task 2: Add onboarding screen for exam setup

**Objective:** After import or from dashboard, user can define the exam context.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Steps:**
1. Extend `Step`:
   ```ts
   type Step = 'checkin' | 'material' | 'exam-setup' | 'session' | 'done'
   ```
2. Add form state:
   - `examDate`
   - `examGoal`
   - `confidence`
3. Add UI section for `step === 'exam-setup'` with fields:
   - Fach/Modul
   - Klausurdatum
   - Ziel
   - Minuten pro Tag
   - Gefühl aktuell
4. Add `saveExamProfile()` function.
5. Link imported document to `examProfileId` when saving profile.
6. Add button: `Klausurplan einrichten` in dashboard.
7. Verify manually: import demo → create profile → dashboard shows it.
8. Run `npm run build`.
9. Commit: `feat: add exam setup onboarding`

---

### Task 3: Calculate days left and daily plan

**Objective:** Show a concrete “today command” instead of generic next action.

**Files:**
- Modify: `src/App.tsx`

**Steps:**
1. Add helper:
   ```ts
   function daysUntil(date: string) {
     const target = new Date(date).setHours(0, 0, 0, 0)
     const today = new Date().setHours(0, 0, 0, 0)
     return Math.ceil((target - today) / 86_400_000)
   }
   ```
2. Add `buildDailyPlan(profile, dueCount, totalItems)` helper.
3. Rules:
   - no profile → “Klausurdatum setzen”
   - <= 3 days → panic mode, 50–90 min if available, exam/review only
   - due items > 0 → review priority
   - otherwise → normal active recall
4. Replace/extend `nextAction` with daily plan text.
5. Dashboard should display:
   - days left
   - today’s minutes
   - target items
   - mode
6. Run `npm run build`.
7. Commit: `feat: calculate daily study plan`

---

### Task 4: Add readiness score

**Objective:** Replace vague session score with exam-readiness estimate.

**Files:**
- Modify: `src/App.tsx`

**Steps:**
1. Add helper `calculateReadiness(items: StudyItem[])`.
2. Simple MVP formula:
   - starts at 15 if document exists
   - + good answers weighted by difficulty
   - - again answers weighted by difficulty
   - + repetition bonus
   - cap 0–100
3. Store `lastRating` in `rateItem()`.
4. Show readiness in sidebar metric instead of only last score.
5. Add copy:
   - `<40%`: “Wenn heute Klausur wäre: kritisch”
   - `40–69%`: “Wackelig, aber rettbar”
   - `70–84%`: “Bestehen realistisch”
   - `85%+`: “Klausurbereit”
6. Run `npm run build`.
7. Commit: `feat: add exam readiness score`

---

### Task 5: Add topic extraction and weakest topics

**Objective:** Make StudyLock feel diagnostic, not just sequential.

**Files:**
- Modify: `src/App.tsx`

**Steps:**
1. In `buildItems()`, set `topic` from first extracted term or `Abschnitt N`.
2. Add `buildTopicStats(items)` helper.
3. Calculate per topic:
   - total items
   - last ratings
   - readiness
4. Show `Top Schwächen` panel:
   - topic name
   - readiness percent
   - recommended action
5. Use weakest topics first in review/exam sessions.
6. Run `npm run build`.
7. Commit: `feat: add topic weakness dashboard`

---

### Task 6: Make Exam Mode actually exam-like

**Objective:** Exam mode should feel like a mini mock exam, not normal flashcards.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Steps:**
1. In `buildItems()`, create more exam-style prompts:
   - definition question
   - application question
   - “compare/explain” question
2. For `mode === 'exam'`, hide rating until user typed at least 30 chars.
3. Add self-score buttons:
   - `0 Punkte`
   - `teilweise`
   - `vollständig`
4. For MVP map them to existing ratings:
   - 0 → again
   - teilweise → hard
   - vollständig → good
5. End screen for exam mode shows:
   - estimated points
   - pass/fail warning
   - weakest topic
6. Run `npm run build`.
7. Commit: `feat: make exam mode exam-like`

---

### Task 7: Add Panic Mode

**Objective:** If exam is near, StudyLock should stop being gentle and prioritize survival.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Steps:**
1. Add `panic` mode or priority flag. Prefer not extending `Mode` yet; use `DailyPlan.priority === 'panic'`.
2. If `daysLeft <= 3`, show red/orange panic panel:
   - “Klausur in X Tagen”
   - “Keine Zusammenfassungen mehr. Nur Abruf + Aufgaben.”
   - “Heute: schwierigste 10 Fragen.”
3. Add `startPanicSession()`:
   - prioritize items with `lastRating !== 'good'`
   - include hardest items first
   - max 12 items
4. Add button: `Panic Session starten`.
5. Run `npm run build`.
6. Commit: `feat: add panic mode`

---

### Task 8: Improve blocker flow

**Objective:** Turn anti-procrastination into a product feature.

**Files:**
- Modify: `src/App.tsx`

**Steps:**
1. Replace static blocker text with specific actions:
   - `Zu schwer` → “Beantworte nur den ersten Teilsatz.”
   - `Keine Motivation` → “2-Minuten-Regel: eine Miniantwort reicht.”
   - `Verstehe es nicht` → “Markiere die Begriffe, die unklar sind.”
   - `Ablenkung` → “Timer läuft weiter. Tab nicht wechseln. Nächster Satz.”
2. Add `Miniantwort übernehmen` shortcut that inserts a starter sentence.
3. Count blocker usage in session result.
4. Show on done screen: “Du hast trotz X Blockern weitergemacht.”
5. Run `npm run build`.
6. Commit: `feat: strengthen blocker flow`

---

### Task 9: Rewrite landing copy around differentiation

**Objective:** Make the product positioning visible immediately.

**Files:**
- Modify: `src/App.tsx`

**Steps:**
1. Replace hero eyebrow:
   - from `StudyLock MVP · lokal benutzbar`
   - to `Nicht chatten. Bestehen.`
2. Replace headline:
   - `Dein Skript wird ein täglicher Klausurplan.`
3. Replace paragraph:
   - emphasize exam deadline, daily plan, readiness score, panic mode.
4. Add small competitor contrast line:
   - “ChatGPT macht Fragen. StudyLock sagt dir, was du heute schaffen musst.”
5. Run `npm run build`.
6. Commit: `copy: reposition studylock as exam coach`

---

### Task 10: Verification pass

**Objective:** Ensure the skeleton works end-to-end.

**Files:**
- No code unless fixes needed.

**Steps:**
1. Run:
   ```bash
   npm run build
   npm audit --audit-level=moderate
   ```
2. Start local dev server:
   ```bash
   npm run dev -- --host 127.0.0.1
   ```
3. Browser smoke test:
   - open app
   - load demo
   - create exam profile with deadline 2 days away
   - verify panic panel appears
   - start panic session
   - answer one question
   - rate it
   - finish session
   - verify readiness/weakness changes
4. Commit fixes if needed.
5. Final commit if all tasks already committed is not needed.

---

## First Executable Slice

Build this first, before polishing:

1. Task 1: Exam profile state
2. Task 2: Exam setup onboarding
3. Task 3: Daily plan
4. Task 4: Readiness score
5. Task 9: Landing copy

That slice is enough to make the product feel different from a PDF chatbot.

## Out of Scope for This Skeleton

Do **not** build yet:
- Supabase backend
- accounts/login
- payment
- real AI API generation
- calendar notifications
- mobile app
- social/streak features

Those come after the core behavior loop feels valuable.
