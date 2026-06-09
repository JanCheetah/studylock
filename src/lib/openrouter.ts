/**
 * OpenRouter API client for StudyLock.
 * Uses the openrouter/owl-alpha model for AI-powered study features.
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'openrouter/optimus-alpha'

const STORAGE_KEY = 'studylock-openrouter-key'
const USAGE_KEY = 'studylock-ai-usage'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenRouterOptions = {
  temperature?: number
  maxTokens?: number
  model?: string
}

export type AIUsageStats = {
  totalCalls: number
  totalPromptTokens: number
  totalCompletionTokens: number
  lastReset: string
}

function getApiKey(): string | null {
  // Priority: localStorage (user-set) > env variable
  const localKey = localStorage.getItem(STORAGE_KEY)
  if (localKey) return localKey
  const envKey = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined
  return envKey || null
}

export function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEY, key)
}

export function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY)
}

export function hasApiKey(): boolean {
  return !!getApiKey()
}

export function getUsageStats(): AIUsageStats {
  try {
    const saved = localStorage.getItem(USAGE_KEY)
    if (saved) return JSON.parse(saved) as AIUsageStats
  } catch { /* ignore */ }
  return { totalCalls: 0, totalPromptTokens: 0, totalCompletionTokens: 0, lastReset: new Date().toISOString() }
}

function trackUsage(promptTokens: number, completionTokens: number) {
  const stats = getUsageStats()
  stats.totalCalls += 1
  stats.totalPromptTokens += promptTokens
  stats.totalCompletionTokens += completionTokens
  localStorage.setItem(USAGE_KEY, JSON.stringify(stats))
}

export function resetUsageStats() {
  localStorage.setItem(USAGE_KEY, JSON.stringify({
    totalCalls: 0, totalPromptTokens: 0, totalCompletionTokens: 0, lastReset: new Date().toISOString(),
  }))
}

export class OpenRouterError extends Error {
  statusCode?: number
  isRateLimit: boolean
  isAuthError: boolean

  constructor(
    message: string,
    statusCode?: number,
    isRateLimit = false,
    isAuthError = false
  ) {
    super(message)
    this.name = 'OpenRouterError'
    this.statusCode = statusCode
    this.isRateLimit = isRateLimit
    this.isAuthError = isAuthError
  }
}

export async function callOpenRouter(
  messages: ChatMessage[],
  options: OpenRouterOptions = {}
): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new OpenRouterError(
      'Kein API Key gesetzt. Gehe in die Einstellungen und trage deinen OpenRouter API Key ein.',
      401, false, true
    )
  }

  const { temperature = 0.7, maxTokens = 2048, model = DEFAULT_MODEL } = options

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'StudyLock',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw new OpenRouterError('Rate Limit erreicht. Warte einen Moment und versuche es erneut.', 429, true)
    }
    if (response.status === 401 || response.status === 403) {
      throw new OpenRouterError('API Key ungültig oder abgelaufen. Prüfe deinen OpenRouter API Key.', response.status, false, true)
    }
    const errorBody = await response.text().catch(() => '')
    throw new OpenRouterError(
      `OpenRouter API Fehler (${response.status}): ${errorBody || response.statusText}`,
      response.status
    )
  }

  const data = await response.json()

  // Track token usage
  if (data.usage) {
    trackUsage(data.usage.prompt_tokens ?? 0, data.usage.completion_tokens ?? 0)
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new OpenRouterError('Leere Antwort vom AI-Modell. Versuche es erneut.')
  }

  return content
}

/**
 * Parse a JSON response from the AI, handling markdown code fences.
 */
export function parseAIJson<T>(text: string): T {
  // Strip markdown code fences if present
  let clean = text.trim()
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return JSON.parse(clean) as T
}
