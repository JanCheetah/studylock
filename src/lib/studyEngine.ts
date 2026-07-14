import type { DailyPlan, Difficulty, DocumentChunk, ExamProfile, Mode, Rating, StudyAttempt, StudyDocument, StudyItem, TopicStat } from '../types'

export const modeLabels: Record<Mode, string> = {
  recall: 'Active Recall',
  deepwork: 'Deep Work',
  review: 'Review',
  exam: 'Prüfungsmodus',
}

export const sampleText = `Aktivkonten mehren sich im Soll und mindern sich im Haben. Passivkonten mehren sich im Haben und mindern sich im Soll. Die Gewinn- und Verlustrechnung sammelt Aufwendungen und Erträge und zeigt den Periodenerfolg. Buchungssätze folgen dem Prinzip Soll an Haben. Eine Bilanz zeigt Vermögen auf der Aktivseite und Kapital auf der Passivseite. Beim einfachen Simplex-Verfahren werden Entscheidungsvariablen, Zielfunktion und Nebenbedingungen in eine zulässige Ausgangslösung überführt. Opportunitätskosten beschreiben den entgangenen Nutzen der besten nicht gewählten Alternative.`

export function id(prefix?: string) {
  // Retain the optional argument for compatibility with existing call sites; UUIDs need no prefix.
  void prefix
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    return (Number(char) ^ (random & (15 >> (Number(char) / 4)))).toString(16)
  })
}

export function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

export function splitIntoChunks(text: string) {
  const clean = normalizeText(text)
  if (!clean) return []

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24)

  const chunks: string[] = []
  let buffer = ''
  for (const sentence of sentences) {
    const next = `${buffer} ${sentence}`.trim()
    if (next.length > 280 && buffer) {
      chunks.push(buffer)
      buffer = sentence
    } else {
      buffer = next
    }
  }
  if (buffer) chunks.push(buffer)
  return chunks.slice(0, 16)
}

export function extractTerms(chunk: string) {
  const stop = new Set([
    'diese', 'dieser', 'dieses', 'einem', 'einen', 'einer', 'nicht', 'werden', 'durch', 'sind', 'oder', 'aber', 'auch', 'dass', 'eine', 'eines', 'wird', 'haben', 'sich', 'beim', 'werden', 'zeigt', 'folgen',
  ])
  return Array.from(new Set(chunk
    .replace(/[^\p{L}\p{N}äöüÄÖÜß\s-]/gu, '')
    .split(/\s+/)
    .filter((word) => word.length > 6 && !stop.has(word.toLowerCase()))))
    .slice(0, 4)
}

function difficultyWeight(difficulty: Difficulty) {
  if (difficulty === 'hart') return 1.3
  if (difficulty === 'mittel') return 1.05
  return 0.85
}

export function buildItems(documentId: string, subject: string, text: string): StudyItem[] {
  const chunks = splitIntoChunks(text)
  const now = new Date().toISOString()
  if (!chunks.length) return []

  return chunks.flatMap((chunk, index) => {
    const terms = extractTerms(chunk)
    const topic = terms[0] || `Abschnitt ${index + 1}`
    const termLabel = terms.join(', ') || 'Kernkonzept'
    const difficulty: Difficulty = chunk.length > 220 ? 'hart' : index % 2 ? 'mittel' : 'leicht'

    return [
      {
        id: id(),
        documentId,
        topic,
        question: `Erkläre für ${subject} in eigenen Worten: ${termLabel}`,
        answer: chunk,
        source: `Abschnitt ${index + 1}`,
        difficulty,
        type: 'karte' as const,
        dueAt: now,
        intervalDays: 0,
        repetitions: 0,
        easeFactor: 2.5,
        generationSource: 'heuristic-v1' as const,
      },
      {
        id: id(),
        documentId,
        topic,
        question: `Klausurfrage: Wende ${topic} auf ein kurzes Beispiel an und begründe deine Lösung.` ,
        answer: chunk,
        source: `Abschnitt ${index + 1}`,
        difficulty: (index % 3 === 0 ? 'hart' : 'mittel') as Difficulty,
        type: 'quiz' as const,
        dueAt: now,
        intervalDays: 0,
        repetitions: 0,
        easeFactor: 2.5,
        generationSource: 'heuristic-v1' as const,
      },
      {
        id: id(),
        documentId,
        topic,
        question: `Prüfungsdruck: Welche zwei typischen Fehler könnten bei ${topic} passieren?`,
        answer: `Nutze den Abschnitt als Musterlösung und prüfe besonders die Begriffe: ${termLabel}. ${chunk}`,
        source: `Abschnitt ${index + 1}`,
        difficulty: 'mittel' as const,
        type: 'aufgabe' as const,
        dueAt: now,
        intervalDays: 0,
        repetitions: 0,
        easeFactor: 2.5,
        generationSource: 'heuristic-v1' as const,
      },
    ]
  }).slice(0, 36)
}

export function nextDueDate(item: StudyItem, rating: Rating) {
  const next = new Date()
  const ef = item.easeFactor ?? 2.5

  // SM-2 ease factor adjustment
  const newEF = rating === 'again'
    ? Math.max(1.3, ef - 0.3)
    : rating === 'hard'
      ? Math.max(1.3, ef - 0.15)
      : Math.max(1.3, ef + 0.1)

  let interval: number
  const reps = item.repetitions + (rating === 'again' ? 0 : 1)

  if (rating === 'again') {
    interval = 0
    next.setHours(next.getHours() + 4)
  } else if (reps <= 1) {
    interval = 1
    next.setDate(next.getDate() + 1)
  } else if (reps === 2) {
    interval = 3
    next.setDate(next.getDate() + 3)
  } else {
    interval = Math.round((item.intervalDays || 1) * newEF)
    next.setDate(next.getDate() + interval)
  }

  return { dueAt: next.toISOString(), intervalDays: interval, repetitions: reps, lastRating: rating, easeFactor: newEF }
}

export function daysUntil(date: string) {
  if (!date) return null
  const target = new Date(date).setHours(0, 0, 0, 0)
  const today = new Date().setHours(0, 0, 0, 0)
  return Math.ceil((target - today) / 86_400_000)
}

export function buildDailyPlan(profile: ExamProfile | null, dueCount: number, totalItems: number): DailyPlan {
  const today = new Date().toISOString().slice(0, 10)
  if (!profile) {
    return {
      date: today,
      daysLeft: null,
      minutes: 25,
      mode: 'recall',
      targetItems: Math.min(8, Math.max(4, totalItems)),
      priority: 'setup',
      message: 'Klausurdatum setzen, damit StudyLock dich nicht nur abfragt, sondern führt.',
      command: 'Klausurplan einrichten',
    }
  }

  const daysLeft = daysUntil(profile.examDate)
  const closeToExam = daysLeft !== null && daysLeft <= 3
  const targetItems = closeToExam ? Math.min(12, Math.max(8, totalItems)) : dueCount > 0 ? Math.min(10, Math.max(5, dueCount)) : Math.min(8, Math.max(4, totalItems))

  if (closeToExam) {
    return {
      date: today,
      daysLeft,
      minutes: Math.max(profile.dailyMinutes, 50),
      mode: 'exam',
      targetItems,
      priority: 'panic',
      message: `Klausur in ${Math.max(daysLeft, 0)} Tagen: keine Zusammenfassungen mehr. Nur Abruf, Aufgaben, Schwächen.`,
      command: 'Panic Session starten',
    }
  }

  if (dueCount > 0) {
    return {
      date: today,
      daysLeft,
      minutes: profile.dailyMinutes,
      mode: 'review',
      targetItems,
      priority: 'review',
      message: `${dueCount} fällige Fragen zuerst. Alte Lücken schlagen neue Notizen.`,
      command: 'Review starten',
    }
  }

  return {
    date: today,
    daysLeft,
    minutes: profile.dailyMinutes,
    mode: 'recall',
    targetItems,
    priority: 'normal',
    message: 'Heute zählt nur die nächste machbare Session. Kein Planungs-Overkill.',
    command: 'Tagesplan starten',
  }
}

export function calculateReadiness(items: StudyItem[]) {
  if (!items.length) return 0
  const baseline = 15
  const maxScore = items.reduce((sum, item) => sum + 2.4 * difficultyWeight(item.difficulty), 0)
  const earned = items.reduce((sum, item) => {
    const weight = difficultyWeight(item.difficulty)
    const ratingScore = item.lastRating === 'good' ? 2.1 : item.lastRating === 'hard' ? 1.15 : item.lastRating === 'again' ? -0.35 : 0
    const repetitionBonus = Math.min(item.repetitions, 4) * 0.18
    return sum + Math.max(0, ratingScore + repetitionBonus) * weight
  }, 0)
  return Math.max(0, Math.min(100, Math.round(baseline + (earned / Math.max(maxScore, 1)) * 85)))
}

export function readinessLabel(score: number) {
  if (score < 40) return 'Wenn heute Klausur wäre: kritisch'
  if (score < 70) return 'Wackelig, aber rettbar'
  if (score < 85) return 'Bestehen realistisch'
  return 'Klausurbereit'
}

export function buildTopicStats(items: StudyItem[]): TopicStat[] {
  const groups = new Map<string, StudyItem[]>()
  for (const item of items) {
    groups.set(item.topic, [...(groups.get(item.topic) ?? []), item])
  }
  return Array.from(groups.entries()).map(([topic, topicItems]) => {
    const good = topicItems.filter((item) => item.lastRating === 'good').length
    const hard = topicItems.filter((item) => item.lastRating === 'hard').length
    const again = topicItems.filter((item) => item.lastRating === 'again').length
    return { topic, total: topicItems.length, good, hard, again, readiness: calculateReadiness(topicItems) }
  }).sort((a, b) => a.readiness - b.readiness)
}

export function selectSessionItems(doc: StudyDocument, mode: Mode, target = 8) {
  const now = Date.now()
  const dueItems = doc.items.filter((item) => new Date(item.dueAt).getTime() <= now)

  // Sort by urgency: overdue items first, then by weakness
  const byUrgency = [...doc.items].sort((a, b) => {
    const ratingRank = (rating?: Rating) => rating === 'again' ? 0 : rating === 'hard' ? 1 : rating === 'good' ? 3 : 2
    const difficultyRank = (difficulty: Difficulty) => difficulty === 'hart' ? 0 : difficulty === 'mittel' ? 1 : 2
    const overdueA = Math.max(0, now - new Date(a.dueAt).getTime()) / 86_400_000
    const overdueB = Math.max(0, now - new Date(b.dueAt).getTime()) / 86_400_000
    // Overdue items get priority boost
    const urgencyA = ratingRank(a.lastRating) - Math.min(overdueA * 0.5, 2)
    const urgencyB = ratingRank(b.lastRating) - Math.min(overdueB * 0.5, 2)
    return urgencyA - urgencyB || difficultyRank(a.difficulty) - difficultyRank(b.difficulty)
  })

  if (mode === 'review') return (dueItems.length ? dueItems : byUrgency).slice(0, target)
  if (mode === 'exam') return byUrgency.filter((item) => item.type !== 'karte').slice(0, target)
  if (mode === 'deepwork') return byUrgency.filter((item) => item.difficulty !== 'leicht').slice(0, Math.min(target, 5))
  return byUrgency.slice(0, target)
}

const scoreByRating: Record<Rating, number> = {
  again: 0,
  hard: 50,
  good: 100,
}

export function buildStudyAttempts({
  sessionId,
  items,
  answers,
  ratings,
  elapsedSeconds,
  now = new Date().toISOString(),
}: {
  sessionId: string
  items: StudyItem[]
  answers: Record<string, string>
  ratings: Record<string, Rating>
  elapsedSeconds?: number
  now?: string
}): StudyAttempt[] {
  return items
    .filter((item) => (answers[item.id] ?? '').trim().length > 0 || Boolean(ratings[item.id]))
    .map((item) => {
      const rating = ratings[item.id]
      return {
        id: id('attempt'),
        sessionId,
        studyItemId: item.id,
        userAnswer: answers[item.id]?.trim() ?? '',
        rating,
        selfScore: rating ? scoreByRating[rating] : undefined,
        timeSpentSeconds: elapsedSeconds,
        createdAt: now,
      }
    })
}

export function download(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function buildDocumentChunks(documentId: string, text: string): DocumentChunk[] {
  const chunks = splitIntoChunks(text)
  return chunks.map((chunkText, index) => ({
    id: `chunk-${documentId}-${index}`,
    documentId,
    chunkIndex: index,
    text: chunkText,
    tokenEstimate: Math.ceil(chunkText.length / 4),
  }))
}
