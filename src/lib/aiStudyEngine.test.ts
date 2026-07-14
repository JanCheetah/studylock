import { describe, expect, it, vi } from 'vitest'
import { generateItemsFromText } from './aiStudyEngine'
import { callOpenRouter } from './openrouter'

vi.mock('./openrouter', () => ({
  callOpenRouter: vi.fn(),
  hasApiKey: vi.fn(() => true),
  parseAIJson: vi.fn((value: string) => JSON.parse(value)),
}))

describe('aiStudyEngine.generateItemsFromText', () => {
  it('assigns UUIDs to OpenRouter-generated study items without network access', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue(JSON.stringify([
      { question: 'Question?', answer: 'Answer.', topic: 'Topic', difficulty: 'mittel', type: 'karte' },
      { question: 'Another?', answer: 'Another answer.', topic: 'Topic', difficulty: 'hart', type: 'quiz' },
    ]))

    const result = await generateItemsFromText('document-id', 'Math', 'Long enough study material')

    expect(callOpenRouter).toHaveBeenCalledOnce()
    expect(result.aiGenerated).toBe(true)
    expect(result.items).toHaveLength(2)
    expect(result.items.map((item) => item.id)).toEqual([
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    ])
    expect(new Set(result.items.map((item) => item.id)).size).toBe(2)
    expect(result.items.every((item) => item.documentId === 'document-id')).toBe(true)
  })
})
