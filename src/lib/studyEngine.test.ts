import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  splitIntoChunks,
  extractTerms,
  buildItems,
  nextDueDate,
  daysUntil,
  buildDailyPlan,
  calculateReadiness,
  readinessLabel,
  buildTopicStats,
  selectSessionItems,
  buildStudyAttempts,
} from './studyEngine'
import type { ExamProfile, StudyItem, StudyDocument } from '../types'

describe('studyEngine', () => {
  beforeEach(() => {
    // Set a constant system time for predictable date calculations
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-09T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('splitIntoChunks', () => {
    it('should return empty list for empty text', () => {
      expect(splitIntoChunks('')).toEqual([])
    })

    it('should split text into sentences and bundle them into chunks', () => {
      // Create a text with sentences. Each sentence is ~100 characters.
      const sentence1 = 'Das ist der erste lange Satz im Text der über 24 Zeichen hat und wichtig ist.'
      const sentence2 = 'Hier folgt der zweite Satz der ebenfalls relativ lang sein muss um die Mindestgrenze zu erreichen.'
      const sentence3 = 'Schließlich kommt noch ein dritter Satz um den Puffer zu füllen und den Chunk abzuschließen.'
      const text = `${sentence1} ${sentence2} ${sentence3}`

      const chunks = splitIntoChunks(text)
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0]).toContain(sentence1)
    })
  })

  describe('extractTerms', () => {
    it('should extract nouns/terms and exclude stop words', () => {
      const chunk = 'Das einfache Simplex-Verfahren ist eine mathematische Methode zur Lösung linearer Optimierungsprobleme.'
      const terms = extractTerms(chunk)
      expect(terms).toContain('Simplex-Verfahren')
      expect(terms).toContain('mathematische')
      // Stop words like "eine" should not be included
      expect(terms).not.toContain('eine')
    })
  })

  describe('buildItems', () => {
    it('should build cards, quizzes, and tasks for a document', () => {
      const docId = 'doc-123'
      const subject = 'Informatik'
      const text = 'Das ist ein langer Text für Informatik. Er muss über 24 Zeichen lang sein. Und noch ein Satz, der ebenfalls über 24 Zeichen lang sein muss.'
      const items = buildItems(docId, subject, text)

      expect(items.length).toBeGreaterThan(0)
      // Items are grouped in triplets: card (karte), quiz, task (aufgabe)
      const firstItem = items[0]
      expect(firstItem.documentId).toBe(docId)
      expect(firstItem.type).toBe('karte')
      expect(firstItem.dueAt).toBe(new Date().toISOString())

      const secondItem = items[1]
      expect(secondItem.type).toBe('quiz')

      const thirdItem = items[2]
      expect(thirdItem.type).toBe('aufgabe')
    })

    it('labels template-generated items with the heuristic generation source', () => {
      const items = buildItems(
        'doc-source',
        'Rechnungswesen',
        'Aktivkonten mehren sich im Soll und mindern sich im Haben. Passivkonten mehren sich im Haben und mindern sich im Soll.',
      )

      expect(items.length).toBeGreaterThan(0)
      expect(items.every((item) => item.generationSource === 'heuristic-v1')).toBe(true)
    })
  })

  describe('nextDueDate', () => {
    const mockItem: StudyItem = {
      id: 'item-1',
      documentId: 'doc-1',
      topic: 'Topic',
      question: 'Q',
      answer: 'A',
      source: 'S',
      difficulty: 'mittel',
      type: 'karte',
      dueAt: '2026-06-09T12:00:00.000Z',
      intervalDays: 0,
      repetitions: 0,
      easeFactor: 2.5,
    }

    it('should schedule in 4 hours for "again"', () => {
      const result = nextDueDate(mockItem, 'again')
      const expectedTime = new Date('2026-06-09T16:00:00.000Z').toISOString()
      expect(result.dueAt).toBe(expectedTime)
      expect(result.intervalDays).toBe(0)
      expect(result.repetitions).toBe(0)
      expect(result.lastRating).toBe('again')
    })

    it('should multiply interval by ease factor for "good"', () => {
      const itemWithInterval = { ...mockItem, intervalDays: 2, repetitions: 2, easeFactor: 2.5 }
      const result = nextDueDate(itemWithInterval, 'good')
      // interval = round(2 * 2.6) = 5 days (EF goes from 2.5 to 2.6 on good)
      expect(result.intervalDays).toBe(5)
      expect(result.repetitions).toBe(3)
      expect(result.lastRating).toBe('good')
    })

    it('should multiply interval by ease factor for "hard"', () => {
      const itemWithInterval = { ...mockItem, intervalDays: 3, repetitions: 2, easeFactor: 2.5 }
      const result = nextDueDate(itemWithInterval, 'hard')
      // interval = round(3 * 2.35) = 7 days (EF goes from 2.5 to 2.35 on hard)
      expect(result.intervalDays).toBe(7)
      expect(result.repetitions).toBe(3)
      expect(result.lastRating).toBe('hard')
    })
  })

  describe('daysUntil', () => {
    it('should calculate days correctly', () => {
      expect(daysUntil('2026-06-11T12:00:00.000Z')).toBe(2)
      expect(daysUntil('2026-06-09T08:00:00.000Z')).toBe(0)
      expect(daysUntil('2026-06-08T12:00:00.000Z')).toBe(-1)
    })
  })

  describe('buildDailyPlan', () => {
    it('should return setup plan if profile is null', () => {
      const plan = buildDailyPlan(null, 0, 10)
      expect(plan.priority).toBe('setup')
      expect(plan.mode).toBe('recall')
    })

    it('should return panic plan if exam is in <= 3 days', () => {
      const profile: ExamProfile = {
        id: 'profile-1',
        subject: 'Math',
        examDate: '2026-06-11T12:00:00.000Z', // 2 days left
        dailyMinutes: 30,
        goal: 'bestehen',
        confidence: 3,
        createdAt: '2026-06-09T12:00:00.000Z',
        updatedAt: '2026-06-09T12:00:00.000Z',
      }
      const plan = buildDailyPlan(profile, 0, 10)
      expect(plan.priority).toBe('panic')
      expect(plan.mode).toBe('exam')
      expect(plan.minutes).toBe(50) // math.max(30, 50)
    })

    it('should return review plan if there are due items and exam is far', () => {
      const profile: ExamProfile = {
        id: 'profile-2',
        subject: 'Math',
        examDate: '2026-07-09T12:00:00.000Z', // 30 days left
        dailyMinutes: 30,
        goal: 'bestehen',
        confidence: 3,
        createdAt: '2026-06-09T12:00:00.000Z',
        updatedAt: '2026-06-09T12:00:00.000Z',
      }
      const plan = buildDailyPlan(profile, 5, 10)
      expect(plan.priority).toBe('review')
      expect(plan.mode).toBe('review')
      expect(plan.minutes).toBe(30)
    })

    it('should return normal plan if there are no due items and exam is far', () => {
      const profile: ExamProfile = {
        id: 'profile-3',
        subject: 'Math',
        examDate: '2026-07-09T12:00:00.000Z',
        dailyMinutes: 30,
        goal: 'bestehen',
        confidence: 3,
        createdAt: '2026-06-09T12:00:00.000Z',
        updatedAt: '2026-06-09T12:00:00.000Z',
      }
      const plan = buildDailyPlan(profile, 0, 10)
      expect(plan.priority).toBe('normal')
      expect(plan.mode).toBe('recall')
      expect(plan.minutes).toBe(30)
    })
  })

  describe('calculateReadiness', () => {
    it('should return 0 for empty list', () => {
      expect(calculateReadiness([])).toBe(0)
    })

    it('should return score between 0 and 100 based on ratings', () => {
      const items: StudyItem[] = [
        {
          id: '1',
          documentId: 'doc-1',
          topic: 'Topic 1',
          question: 'Q1',
          answer: 'A1',
          source: 'S1',
          difficulty: 'leicht',
          type: 'karte',
          dueAt: '',
          intervalDays: 1,
          repetitions: 1,
          lastRating: 'good',
          easeFactor: 2.5,
        },
        {
          id: '2',
          documentId: 'doc-1',
          topic: 'Topic 2',
          question: 'Q2',
          answer: 'A2',
          source: 'S2',
          difficulty: 'mittel',
          type: 'karte',
          dueAt: '',
          intervalDays: 1,
          repetitions: 1,
          lastRating: 'again',
          easeFactor: 2.5,
        },
      ]

      const readiness = calculateReadiness(items)
      expect(readiness).toBeGreaterThanOrEqual(0)
      expect(readiness).toBeLessThanOrEqual(100)
    })
  })

  describe('readinessLabel', () => {
    it('should return correct labels', () => {
      expect(readinessLabel(30)).toBe('Wenn heute Klausur wäre: kritisch')
      expect(readinessLabel(60)).toBe('Wackelig, aber rettbar')
      expect(readinessLabel(80)).toBe('Bestehen realistisch')
      expect(readinessLabel(90)).toBe('Klausurbereit')
    })
  })

  describe('buildTopicStats', () => {
    it('should group items by topic and calculate correct statistics', () => {
      const items: StudyItem[] = [
        {
          id: '1',
          documentId: 'doc-1',
          topic: 'Accounting',
          question: 'Q1',
          answer: 'A1',
          source: 'S1',
          difficulty: 'leicht',
          type: 'karte',
          dueAt: '',
          intervalDays: 1,
          repetitions: 1,
          lastRating: 'good',
          easeFactor: 2.5,
        },
        {
          id: '2',
          documentId: 'doc-1',
          topic: 'Accounting',
          question: 'Q2',
          answer: 'A2',
          source: 'S2',
          difficulty: 'leicht',
          type: 'karte',
          dueAt: '',
          intervalDays: 1,
          repetitions: 1,
          lastRating: 'again',
          easeFactor: 2.5,
        },
        {
          id: '3',
          documentId: 'doc-1',
          topic: 'Statistics',
          question: 'Q3',
          answer: 'A3',
          source: 'S3',
          difficulty: 'leicht',
          type: 'karte',
          dueAt: '',
          intervalDays: 1,
          repetitions: 1,
          lastRating: 'good',
          easeFactor: 2.5,
        },
      ]

      const stats = buildTopicStats(items)
      expect(stats.length).toBe(2)
      const accounting = stats.find(s => s.topic === 'Accounting')
      const statistics = stats.find(s => s.topic === 'Statistics')

      expect(accounting).toBeDefined()
      expect(accounting?.total).toBe(2)
      expect(accounting?.good).toBe(1)
      expect(accounting?.again).toBe(1)

      expect(statistics).toBeDefined()
      expect(statistics?.total).toBe(1)
      expect(statistics?.good).toBe(1)
    })
  })

  describe('selectSessionItems', () => {
    it('should select weak items first', () => {
      const mockDoc: StudyDocument = {
        id: 'doc-1',
        title: 'Document 1',
        subject: 'Math',
        text: 'Langer Text ...',
        createdAt: '2026-06-09T12:00:00.000Z',
        updatedAt: '2026-06-09T12:00:00.000Z',
        items: [
          {
            id: '1',
            documentId: 'doc-1',
            topic: 'Math',
            question: 'Q1',
            answer: 'A1',
            source: 'S1',
            difficulty: 'leicht',
            type: 'karte',
            dueAt: '2026-06-09T12:00:00.000Z',
            intervalDays: 1,
            repetitions: 1,
            lastRating: 'good',
            easeFactor: 2.5,
          },
          {
            id: '2',
            documentId: 'doc-1',
            topic: 'Math',
            question: 'Q2',
            answer: 'A2',
            source: 'S2',
            difficulty: 'leicht',
            type: 'karte',
            dueAt: '2026-06-09T12:00:00.000Z',
            intervalDays: 1,
            repetitions: 1,
            lastRating: 'again', // this should be prioritized because again < good
            easeFactor: 2.5,
          },
        ]
      }

      const selected = selectSessionItems(mockDoc, 'recall', 1)
      expect(selected.length).toBe(1)
      expect(selected[0].id).toBe('2')
    })
  })

  describe('buildStudyAttempts', () => {
    it('creates one attempt for every answered or rated session item', () => {
      const attempts = buildStudyAttempts({
        sessionId: 'session-1',
        items: [
          {
            id: 'item-answered',
            documentId: 'doc-1',
            topic: 'Topic',
            question: 'Q1',
            answer: 'A1',
            source: 'S1',
            difficulty: 'leicht',
            type: 'karte',
            dueAt: '2026-06-09T12:00:00.000Z',
            intervalDays: 0,
            repetitions: 0,
            easeFactor: 2.5,
          },
          {
            id: 'item-rated',
            documentId: 'doc-1',
            topic: 'Topic',
            question: 'Q2',
            answer: 'A2',
            source: 'S2',
            difficulty: 'mittel',
            type: 'quiz',
            dueAt: '2026-06-09T12:00:00.000Z',
            intervalDays: 0,
            repetitions: 0,
            easeFactor: 2.5,
          },
        ],
        answers: { 'item-answered': 'Meine Antwort mit genug Inhalt' },
        ratings: { 'item-rated': 'hard' },
        now: '2026-06-09T12:00:00.000Z',
      })

      expect(attempts).toEqual([
        expect.objectContaining({
          id: 'session-1-item-answered',
          sessionId: 'session-1',
          studyItemId: 'item-answered',
          userAnswer: 'Meine Antwort mit genug Inhalt',
          rating: undefined,
          selfScore: undefined,
          createdAt: '2026-06-09T12:00:00.000Z',
        }),
        expect.objectContaining({
          id: 'session-1-item-rated',
          sessionId: 'session-1',
          studyItemId: 'item-rated',
          userAnswer: '',
          rating: 'hard',
          selfScore: 50,
          createdAt: '2026-06-09T12:00:00.000Z',
        }),
      ])
    })
  })
})
