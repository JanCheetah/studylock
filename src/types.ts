export type Mode = 'recall' | 'deepwork' | 'review' | 'exam'
export type Step = 'checkin' | 'material' | 'exam-setup' | 'session' | 'done'
export type Difficulty = 'leicht' | 'mittel' | 'hart'
export type Rating = 'again' | 'hard' | 'good'
export type ExamGoal = 'bestehen' | 'gut' | 'sehr-gut'
export type Confidence = 1 | 2 | 3 | 4 | 5
export type PlanPriority = 'setup' | 'normal' | 'review' | 'panic'

export type StudyItem = {
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

export type StudyDocument = {
  id: string
  title: string
  subject: string
  text: string
  examProfileId?: string
  createdAt: string
  updatedAt: string
  items: StudyItem[]
}

export type ExamProfile = {
  id: string
  subject: string
  examDate: string
  dailyMinutes: number
  goal: ExamGoal
  confidence: Confidence
  createdAt: string
  updatedAt: string
}

export type SessionResult = {
  id: string
  date: string
  subject: string
  documentTitle: string
  mode: Mode
  score: number
  minutes: number
  answered: number
  blockers: number
  readinessAfter: number
}

export type DailyPlan = {
  date: string
  daysLeft: number | null
  minutes: number
  mode: Mode
  targetItems: number
  priority: PlanPriority
  message: string
  command: string
}

export type TopicStat = {
  topic: string
  total: number
  good: number
  hard: number
  again: number
  readiness: number
}

export type AppStateSnapshot = {
  documents: StudyDocument[]
  examProfiles: ExamProfile[]
  results: SessionResult[]
}
