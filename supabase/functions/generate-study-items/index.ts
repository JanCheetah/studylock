import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

type GeneratedItem = {
  topic: string
  question: string
  answer: string
  source?: string
  difficulty: 'leicht' | 'mittel' | 'hart'
  type: 'karte' | 'quiz' | 'aufgabe'
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const allowedDifficulties = new Set(['leicht', 'mittel', 'hart'])
const allowedTypes = new Set(['karte', 'quiz', 'aufgabe'])

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function cleanText(value: unknown, maxLength = 12_000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function extractJsonArray(content: string): GeneratedItem[] {
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
  const raw = fenced ?? trimmed
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) throw new Error('Model returned no JSON array')
  const parsed = JSON.parse(raw.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('Model JSON is not an array')
  return parsed
}

function normalizeItems(items: GeneratedItem[], documentId: string) {
  const now = new Date().toISOString()
  return items.slice(0, 24).map((item, index) => {
    const difficulty = allowedDifficulties.has(item.difficulty) ? item.difficulty : 'mittel'
    const type = allowedTypes.has(item.type) ? item.type : index % 3 === 0 ? 'karte' : index % 3 === 1 ? 'quiz' : 'aufgabe'
    return {
      id: `${documentId}-ai-${index}`,
      documentId,
      topic: cleanText(item.topic, 80) || `KI-Abschnitt ${index + 1}`,
      question: cleanText(item.question, 500),
      answer: cleanText(item.answer, 1_200),
      source: cleanText(item.source, 120) || 'OpenRouter KI',
      difficulty,
      type,
      dueAt: now,
      intervalDays: 0,
      repetitions: 0,
    }
  }).filter((item) => item.question.length > 12 && item.answer.length > 12)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) return jsonResponse({ error: 'OPENROUTER_API_KEY secret is not configured' }, 500)

  try {
    const body = await req.json()
    const documentId = cleanText(body.documentId, 120)
    const subject = cleanText(body.subject, 160) || 'Lernen'
    const text = cleanText(body.text)

    if (!documentId || text.length < 80) {
      return jsonResponse({ error: 'documentId and at least 80 chars of text are required' }, 400)
    }

    const model = Deno.env.get('OPENROUTER_MODEL') || 'openrouter/owl-alpha'
    const prompt = `Du bist StudyLock, ein deutscher Klausurtrainer. Erzeuge aus dem Material prüfungsnahe Lernitems.\n\nFach: ${subject}\n\nRegeln:\n- Antworte NUR als JSON-Array, kein Markdown.\n- 12 bis 18 Items.\n- Mische type: karte, quiz, aufgabe.\n- difficulty nur: leicht, mittel, hart.\n- Fragen müssen aktiv abrufen lassen, nicht nur Definitionen.\n- Antworten knapp, aber prüfungstauglich.\n- source als kurzer Quellenhinweis wie "Abschnitt 1".\n\nSchema pro Item:\n{"topic":"...","question":"...","answer":"...","source":"...","difficulty":"leicht|mittel|hart","type":"karte|quiz|aufgabe"}\n\nMaterial:\n${text}`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://studylock.local',
        'X-Title': 'StudyLock',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Du erzeugst ausschließlich valides JSON für eine Lern-App.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.35,
        max_tokens: 4000,
      }),
    })

    const payload = await response.json()
    if (!response.ok) {
      return jsonResponse({ error: payload?.error?.message ?? 'OpenRouter request failed' }, response.status)
    }

    const content = payload?.choices?.[0]?.message?.content
    if (!content) return jsonResponse({ error: 'OpenRouter returned no content' }, 502)

    const generated = extractJsonArray(content)
    const items = normalizeItems(generated, documentId)
    if (!items.length) return jsonResponse({ error: 'No usable study items generated' }, 502)

    return jsonResponse({ items, model, source: 'openrouter' })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})
