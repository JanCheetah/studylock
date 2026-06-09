import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { AiGenerationLog, AppStateSnapshot, DocumentChunk, ExamProfile, RepositoryStatus, SessionResult, StudyAttempt, StudyDocument, StudyItem } from '../../types'
import { supabase } from '../supabaseClient'
import type { StudyRepository } from './studyRepository'
import { buildDocumentChunks } from '../studyEngine'

type DbDocument = {
  id: string
  title: string
  subject: string
  source_type: string
  raw_text: string
  exam_profile_id: string | null
  created_at: string
  updated_at: string
}

type DbExamProfile = {
  id: string
  subject: string
  exam_date: string
  daily_minutes: number
  goal: ExamProfile['goal']
  confidence: ExamProfile['confidence']
  created_at: string
  updated_at: string
}

type DbStudyItem = {
  id: string
  document_id: string
  topic: string
  question: string
  answer: string
  source: string
  type: StudyItem['type']
  difficulty: StudyItem['difficulty']
  due_at: string
  interval_days: number
  repetitions: number
  last_rating: StudyItem['lastRating'] | null
  generation_source: StudyItem['generationSource'] | null
}

type DbSession = {
  id: string
  document_id: string | null
  mode: SessionResult['mode']
  finished_at: string
  minutes: number
  score: number
  answered: number
  blocker_count: number
  readiness_after: number
}

const textHash = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class SupabaseStudyRepository implements StudyRepository {
  private client: SupabaseClient

  constructor(client = supabase) {
    if (!client) throw new Error('Supabase is not configured')
    this.client = client
  }

  async status(): Promise<RepositoryStatus> {
    const { data } = await this.client.auth.getUser()
    return {
      mode: 'supabase',
      configured: true,
      authenticated: Boolean(data.user),
      label: data.user ? 'Supabase Cloud' : 'Supabase bereit, Login fehlt',
      detail: data.user
        ? 'Cloud-Sync kann Dokumente, Sessions, Ratings und AI-Kontext speichern.'
        : 'VITE_SUPABASE_URL/ANON_KEY sind gesetzt. Für RLS-Schreibzugriff braucht StudyLock als nächstes Auth UI.',
    }
  }

  async loadSnapshot(): Promise<AppStateSnapshot> {
    const user = await this.requireUser()
    const [{ data: documents }, { data: profiles }, { data: items }, { data: sessions }, { data: attempts }] = await Promise.all([
      this.client.from('documents').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      this.client.from('exam_profiles').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      this.client.from('study_items').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
      this.client.from('study_sessions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
      this.client.from('study_attempts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1000),
    ])

    const itemsByDocument = new Map<string, StudyItem[]>()
    for (const item of (items ?? []) as DbStudyItem[]) {
      const mapped = this.mapStudyItem(item)
      itemsByDocument.set(mapped.documentId, [...(itemsByDocument.get(mapped.documentId) ?? []), mapped])
    }

    const mappedAttempts: StudyAttempt[] = (attempts ?? []).map((attempt: any) => ({
      id: attempt.id,
      sessionId: attempt.session_id,
      studyItemId: attempt.study_item_id,
      userAnswer: attempt.user_answer ?? '',
      rating: attempt.rating ?? undefined,
      createdAt: attempt.created_at,
    }))

    return {
      documents: ((documents ?? []) as DbDocument[]).map((doc) => this.mapDocument(doc, itemsByDocument.get(doc.id) ?? [])),
      examProfiles: ((profiles ?? []) as DbExamProfile[]).map(this.mapExamProfile),
      results: ((sessions ?? []) as DbSession[]).map((session) => this.mapSession(session, ((documents ?? []) as DbDocument[]).find((doc) => doc.id === session.document_id))),
      attempts: mappedAttempts,
    }
  }

  async saveDocument(document: StudyDocument): Promise<void> {
    const user = await this.requireUser()
    const hash = await textHash(document.text)
    const { error } = await this.client.from('documents').upsert({
      id: document.id,
      user_id: user.id,
      title: document.title,
      subject: document.subject,
      source_type: document.sourceType ?? 'paste',
      raw_text: document.text,
      text_hash: hash,
      exam_profile_id: document.examProfileId ?? null,
      created_at: document.createdAt,
      updated_at: document.updatedAt,
    })
    if (error) throw error
    await this.saveStudyItems(document.id, document.items)
    const chunks = buildDocumentChunks(document.id, document.text)
    await this.saveDocumentChunks(document.id, chunks)
  }

  async deleteDocument(documentId: string): Promise<void> {
    const { error } = await this.client.from('documents').delete().eq('id', documentId)
    if (error) throw error
  }

  async saveExamProfile(profile: ExamProfile): Promise<void> {
    const user = await this.requireUser()
    const { error } = await this.client.from('exam_profiles').upsert({
      id: profile.id,
      user_id: user.id,
      subject: profile.subject,
      exam_date: profile.examDate,
      goal: profile.goal,
      daily_minutes: profile.dailyMinutes,
      confidence: profile.confidence,
      created_at: profile.createdAt,
      updated_at: profile.updatedAt,
    })
    if (error) throw error
  }

  async saveStudyItems(documentId: string, items: StudyItem[]): Promise<void> {
    const user = await this.requireUser()
    const rows = items.map((item) => ({
      id: item.id,
      user_id: user.id,
      document_id: documentId,
      topic: item.topic,
      question: item.question,
      answer: item.answer,
      source: item.source,
      type: item.type,
      difficulty: item.difficulty,
      due_at: item.dueAt,
      interval_days: item.intervalDays,
      repetitions: item.repetitions,
      last_rating: item.lastRating ?? null,
      generation_source: item.generationSource ?? (item.aiGenerated ? 'openrouter' : 'heuristic-v1'),
    }))
    const { error } = await this.client.from('study_items').upsert(rows)
    if (error) throw error
  }

  async saveSession(result: SessionResult): Promise<void> {
    const user = await this.requireUser()
    const { error } = await this.client.from('study_sessions').upsert({
      id: result.id,
      user_id: user.id,
      mode: result.mode,
      finished_at: new Date().toISOString(),
      minutes: result.minutes,
      score: result.score,
      answered: result.answered,
      blocker_count: result.blockers,
      readiness_after: result.readinessAfter,
    })
    if (error) throw error
  }

  async saveStudyAttempts(attempts: StudyAttempt[]): Promise<void> {
    if (!attempts.length) return
    const user = await this.requireUser()
    const rows = attempts.map((attempt) => ({
      id: attempt.id,
      user_id: user.id,
      session_id: attempt.sessionId,
      study_item_id: attempt.studyItemId,
      user_answer: attempt.userAnswer,
      rating: attempt.rating ?? null,
      self_score: attempt.selfScore ?? null,
      time_spent_seconds: attempt.timeSpentSeconds ?? null,
      created_at: attempt.createdAt,
    }))
    const { error } = await this.client.from('study_attempts').insert(rows)
    if (error) throw error
  }

  async saveDocumentChunks(documentId: string, chunks: DocumentChunk[]): Promise<void> {
    const user = await this.requireUser()
    const rows = chunks.map((chunk) => ({
      user_id: user.id,
      document_id: documentId,
      chunk_index: chunk.chunkIndex,
      text: chunk.text,
      token_estimate: chunk.tokenEstimate,
    }))
    const { error } = await this.client.from('document_chunks').upsert(rows, { onConflict: 'document_id,chunk_index' })
    if (error) throw error
  }

  async recordAiGeneration(log: AiGenerationLog): Promise<void> {
    try {
      const user = await this.requireUser()
      const { error } = await this.client.from('ai_generations').insert({
        user_id: user.id,
        document_id: log.documentId ?? null,
        chunk_id: log.chunkId ?? null,
        status: log.status,
        model: log.model,
        prompt_version: log.promptVersion,
        input_hash: log.inputHash,
        output: {
          provider: log.provider,
          items_count: log.itemsCount ?? 0,
        },
        error_message: log.errorMessage ?? null,
      })
      if (error) throw error
    } catch (error) {
      console.warn('StudyLock AI generation audit logging failed:', error)
    }
  }

  async saveSnapshot(snapshot: AppStateSnapshot): Promise<void> {
    for (const profile of snapshot.examProfiles) await this.saveExamProfile(profile)
    for (const document of snapshot.documents) await this.saveDocument(document)
    for (const result of snapshot.results) await this.saveSession(result)
    if (snapshot.attempts) {
      await this.saveStudyAttempts(snapshot.attempts)
    }
  }

  private async requireUser(): Promise<User> {
    const { data, error } = await this.client.auth.getUser()
    if (error) throw error
    if (!data.user) throw new Error('Supabase auth required before cloud persistence')
    return data.user
  }

  private mapDocument(row: DbDocument, items: StudyItem[]): StudyDocument {
    return {
      id: row.id,
      title: row.title,
      subject: row.subject,
      sourceType: row.source_type as StudyDocument['sourceType'],
      text: row.raw_text,
      examProfileId: row.exam_profile_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items,
    }
  }

  private mapExamProfile(row: DbExamProfile): ExamProfile {
    return {
      id: row.id,
      subject: row.subject,
      examDate: row.exam_date,
      dailyMinutes: row.daily_minutes,
      goal: row.goal,
      confidence: row.confidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapStudyItem(row: DbStudyItem): StudyItem {
    return {
      id: row.id,
      documentId: row.document_id,
      topic: row.topic,
      question: row.question,
      answer: row.answer,
      source: row.source,
      type: row.type,
      difficulty: row.difficulty,
      dueAt: row.due_at,
      intervalDays: row.interval_days,
      repetitions: row.repetitions,
      lastRating: row.last_rating ?? undefined,
      easeFactor: 2.5,
      generationSource: row.generation_source ?? undefined,
      aiGenerated: row.generation_source === 'openrouter' || undefined,
    }
  }

  private mapSession(row: DbSession, document?: DbDocument): SessionResult {
    return {
      id: row.id,
      date: new Date(row.finished_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }),
      subject: document?.subject ?? 'Cloud Session',
      documentTitle: document?.title ?? 'Cloud Dokument',
      mode: row.mode,
      score: row.score,
      minutes: row.minutes,
      answered: row.answered,
      blockers: row.blocker_count,
      readinessAfter: row.readiness_after,
    }
  }
}
