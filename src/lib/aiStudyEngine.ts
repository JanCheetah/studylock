/**
 * AI-powered study engine using OpenRouter.
 * Generates intelligent study questions from material and evaluates user answers.
 */

import { callOpenRouter, parseAIJson, hasApiKey, type ChatMessage } from './openrouter'
import type { Difficulty, StudyItem } from '../types'
import { buildItems } from './studyEngine'

type AIGeneratedItem = {
  question: string
  answer: string
  topic: string
  difficulty: 'leicht' | 'mittel' | 'hart'
  type: 'karte' | 'quiz' | 'aufgabe'
}

type AIEvaluation = {
  score: number          // 0-100
  rating: 'again' | 'hard' | 'good'
  feedback: string       // Detailliertes Feedback
  strengths: string[]    // Was gut war
  weaknesses: string[]   // Was fehlt
  suggestion: string     // Konkreter Verbesserungsvorschlag
}

/**
 * Generate study items from text using AI.
 * Falls back to template-based generation if AI is unavailable.
 */
export async function generateItemsFromText(
  documentId: string,
  subject: string,
  text: string,
  count = 20,
  onProgress?: (status: string) => void
): Promise<{ items: StudyItem[]; aiGenerated: boolean; model?: string; promptVersion?: string; errorMessage?: string }> {
  if (!hasApiKey()) {
    onProgress?.('Kein AI Key – verwende Template-Generierung...')
    return { items: buildItems(documentId, subject, text), aiGenerated: false, errorMessage: 'Kein AI Key konfiguriert' }
  }

  onProgress?.('AI analysiert dein Material...')

  // Truncate very long texts to stay within token limits
  const maxChars = 12000
  const truncatedText = text.length > maxChars
    ? text.slice(0, maxChars) + '\n\n[... Text gekürzt ...]'
    : text

  const systemPrompt = `Du bist ein erfahrener Hochschul-Dozent und Prüfungsexperte. Deine Aufgabe ist es, aus dem bereitgestellten Lernmaterial hochwertige Prüfungsfragen zu erstellen, die Studierenden helfen, den Stoff wirklich zu verstehen und sich optimal auf die Klausur vorzubereiten.

Regeln:
- Erstelle genau ${count} Fragen
- Mische verschiedene Fragetypen: "karte" (Erkläre/Definiere), "quiz" (Multiple-Choice-artige Wissensfragen), "aufgabe" (Anwendungsaufgaben)
- Variiere die Schwierigkeit: "leicht", "mittel", "hart"
- Jede Frage muss eine vollständige, korrekte Musterantwort haben
- Fragen sollen prüfungsrelevant und auf Verständnis ausgerichtet sein, nicht auf reines Auswendiglernen
- Antworte NUR mit validem JSON, kein anderer Text

Antworte als JSON Array mit diesem Format:
[
  {
    "question": "Die Frage",
    "answer": "Vollständige Musterantwort",
    "topic": "Themengebiet (1-3 Wörter)",
    "difficulty": "leicht|mittel|hart",
    "type": "karte|quiz|aufgabe"
  }
]`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Fach: ${subject}\n\nLernmaterial:\n${truncatedText}` },
  ]

  try {
    onProgress?.('AI generiert Prüfungsfragen...')
    const response = await callOpenRouter(messages, {
      temperature: 0.75,
      maxTokens: 4096,
    })

    const rawItems = parseAIJson<AIGeneratedItem[]>(response)

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new Error('AI hat keine gültigen Fragen generiert')
    }

    onProgress?.(`${rawItems.length} Fragen generiert – verarbeite...`)

    const now = new Date().toISOString()
    const studyItems: StudyItem[] = rawItems.map((item, index) => ({
      id: `${documentId}-ai-${index}`,
      documentId,
      topic: item.topic || `Thema ${index + 1}`,
      question: item.question,
      answer: item.answer,
      source: 'AI-generiert',
      difficulty: (['leicht', 'mittel', 'hart'].includes(item.difficulty) ? item.difficulty : 'mittel') as Difficulty,
      type: (['karte', 'quiz', 'aufgabe'].includes(item.type) ? item.type : 'karte') as 'karte' | 'quiz' | 'aufgabe',
      dueAt: now,
      intervalDays: 0,
      repetitions: 0,
      easeFactor: 2.5,
      aiGenerated: true,
      generationSource: 'openrouter',
    }))

    onProgress?.(`✓ ${studyItems.length} AI-Fragen bereit!`)
    return { items: studyItems, aiGenerated: true, model: 'openrouter/owl-alpha', promptVersion: 'v1' }
  } catch (error) {
    console.warn('AI generation failed, falling back to templates:', error)
    onProgress?.('AI fehlgeschlagen – verwende Template-Fallback...')
    const msg = error instanceof Error ? error.message : 'Unknown AI error'
    return { items: buildItems(documentId, subject, text), aiGenerated: false, errorMessage: msg }
  }
}

/**
 * AI evaluates a user's answer to a study question.
 */
export async function evaluateAnswer(
  question: string,
  correctAnswer: string,
  userAnswer: string,
  subject: string
): Promise<AIEvaluation> {
  const systemPrompt = `Du bist ein fairer, aber strenger Prüfer für das Fach "${subject}". Bewerte die Antwort eines Studierenden auf eine Prüfungsfrage. 

Sei ermutigend aber ehrlich. Gib konkretes, hilfreiches Feedback.

Antworte NUR als JSON mit diesem Format:
{
  "score": 0-100,
  "rating": "again|hard|good",
  "feedback": "2-3 Sätze Gesamtbewertung",
  "strengths": ["Was war gut (max 3 Punkte)"],
  "weaknesses": ["Was fehlt oder ist falsch (max 3 Punkte)"],
  "suggestion": "Ein konkreter Tipp zur Verbesserung"
}

Bewertungslogik:
- "good" (75-100): Antwort ist im Wesentlichen korrekt und vollständig
- "hard" (40-74): Teilweise richtig, aber wichtige Aspekte fehlen
- "again" (0-39): Grundlegend falsch oder viel zu unvollständig`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Frage: ${question}\n\nMusterantwort: ${correctAnswer}\n\nAntwort des Studierenden: ${userAnswer}` },
  ]

  const response = await callOpenRouter(messages, {
    temperature: 0.4,
    maxTokens: 1024,
  })

  return parseAIJson<AIEvaluation>(response)
}

/**
 * Generate a hint for a question without revealing the answer.
 */
export async function generateHint(
  question: string,
  answer: string,
  subject: string
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Du bist ein hilfreicher Tutor für "${subject}". Gib einen kurzen Hinweis (1-2 Sätze) der dem Studierenden hilft, selbst auf die Antwort zu kommen, OHNE die Antwort zu verraten. Nenne Schlüsselbegriffe oder Denkansätze.`,
    },
    {
      role: 'user',
      content: `Frage: ${question}\n\n(Die korrekte Antwort ist: ${answer} – aber verrrate sie NICHT, gib nur einen Hinweis)`,
    },
  ]

  return callOpenRouter(messages, { temperature: 0.6, maxTokens: 256 })
}

/**
 * Generate a single follow-up question based on a weakness.
 */
export async function generateFollowUp(
  topic: string,
  subject: string,
  previousQuestion: string
): Promise<{ question: string; answer: string } | null> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Du bist ein Prüfungsexperte für "${subject}". Erstelle EINE Vertiefungsfrage zum Thema "${topic}", die ein anderes Verständnisaspekt prüft als die vorherige Frage. Antworte NUR als JSON: {"question": "...", "answer": "..."}`,
    },
    {
      role: 'user',
      content: `Vorherige Frage war: ${previousQuestion}\n\nErstelle eine neue, andere Frage zum gleichen Thema.`,
    },
  ]

  try {
    const response = await callOpenRouter(messages, { temperature: 0.8, maxTokens: 512 })
    return parseAIJson<{ question: string; answer: string }>(response)
  } catch {
    return null
  }
}

/**
 * Check if AI features are available.
 */
export function isAIAvailable(): boolean {
  return hasApiKey()
}
