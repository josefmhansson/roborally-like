import type {
  TutorialActionId,
  TutorialEventId,
  TutorialGuardResult,
  TutorialLessonDef,
  TutorialLessonId,
  TutorialPayload,
  TutorialProgress,
  TutorialSession,
  TutorialStep,
  TutorialValue,
} from './types'

const COMPLETION_ALLOWED_ACTIONS = new Set<TutorialActionId>([
  'leave_match',
  'reset_game',
  'winner_primary',
  'winner_secondary',
])

export type TutorialAdvanceResult = {
  advanced: boolean
  completed: boolean
  lessonId: TutorialLessonId | null
}

export class TutorialController {
  private readonly lessons: Map<TutorialLessonId, TutorialLessonDef>
  private progress: TutorialProgress
  private session: TutorialSession | null

  constructor(lessons: TutorialLessonDef[], progress: TutorialProgress = { completedAt: {} }) {
    this.lessons = new Map(lessons.map((lesson) => [lesson.id, lesson]))
    this.progress = normalizeProgress(progress, this.lessons)
    this.session = null
  }

  listLessons(): TutorialLessonDef[] {
    return [...this.lessons.values()]
  }

  getProgress(): TutorialProgress {
    return {
      completedAt: { ...this.progress.completedAt },
    }
  }

  getSession(): TutorialSession | null {
    return this.session ? { ...this.session } : null
  }

  getLesson(lessonId: TutorialLessonId): TutorialLessonDef {
    const lesson = this.lessons.get(lessonId)
    if (!lesson) {
      throw new Error(`Unknown tutorial lesson: ${lessonId}`)
    }
    return lesson
  }

  getCurrentLesson(): TutorialLessonDef | null {
    return this.session ? this.getLesson(this.session.lessonId) : null
  }

  getCurrentStep(): TutorialStep | null {
    if (!this.session) return null
    const lesson = this.getLesson(this.session.lessonId)
    return lesson.steps[this.session.stepIndex] ?? null
  }

  startLesson(lessonId: TutorialLessonId, now = Date.now()): TutorialSession {
    this.session = {
      lessonId,
      stepIndex: 0,
      startedAt: now,
      completedAt: null,
    }
    return { ...this.session }
  }

  restartLesson(now = Date.now()): TutorialSession | null {
    if (!this.session) return null
    return this.startLesson(this.session.lessonId, now)
  }

  clearSession(): void {
    this.session = null
  }

  canPerform(action: TutorialActionId, payload: TutorialPayload = {}): TutorialGuardResult {
    const step = this.getCurrentStep()
    if (!step) {
      return { allowed: true }
    }
    if (this.session?.completedAt) {
      if (COMPLETION_ALLOWED_ACTIONS.has(action)) {
        return { allowed: true }
      }
      return { allowed: false, message: 'Lesson complete. Use Tutorial Hub to return.' }
    }
    const allowedRules = step.allowedActions ?? []
    if (allowedRules.length === 0) {
      return { allowed: true }
    }

    const actionRules = allowedRules.filter((rule) => rule.action === action)
    if (actionRules.length === 0) {
      const manualAdvanceRule = allowedRules.find((rule) => rule.action === 'tutorial_next')
      return {
        allowed: false,
        message: manualAdvanceRule?.message ?? step.blockedMessage ?? 'Follow the current tutorial step.',
      }
    }

    const matchedRule = actionRules.find((rule) => matchesPayload(rule.match, payload))
    if (matchedRule) {
      return { allowed: true }
    }

    return {
      allowed: false,
      message: actionRules[0].message,
    }
  }

  recordEvent(event: TutorialEventId, payload: TutorialPayload = {}, now = Date.now()): TutorialAdvanceResult {
    const step = this.getCurrentStep()
    if (!step || !this.session || this.session.completedAt) {
      return { advanced: false, completed: false, lessonId: null }
    }

    const matched = step.completeOn.some((rule) => rule.event === event && matchesPayload(rule.match, payload))
    if (!matched) {
      return { advanced: false, completed: false, lessonId: this.session.lessonId }
    }

    const lesson = this.getLesson(this.session.lessonId)
    const isFinalStep = this.session.stepIndex >= lesson.steps.length - 1
    if (isFinalStep) {
      this.session = {
        ...this.session,
        completedAt: now,
      }
      this.progress.completedAt[this.session.lessonId] = now
      return { advanced: true, completed: true, lessonId: this.session.lessonId }
    }

    this.session = {
      ...this.session,
      stepIndex: this.session.stepIndex + 1,
    }
    return { advanced: true, completed: false, lessonId: this.session.lessonId }
  }

  isLessonCompleted(lessonId: TutorialLessonId): boolean {
    return typeof this.progress.completedAt[lessonId] === 'number'
  }

  getCompletedCount(): number {
    return Object.keys(this.progress.completedAt).length
  }
}

function normalizeProgress(
  progress: TutorialProgress,
  lessons: ReadonlyMap<TutorialLessonId, TutorialLessonDef>
): TutorialProgress {
  const completedAt = Object.fromEntries(
    Object.entries(progress.completedAt ?? {}).filter(([lessonId, completedAt]) => {
      return lessons.has(lessonId as TutorialLessonId) && typeof completedAt === 'number'
    })
  ) as Partial<Record<TutorialLessonId, number>>

  return {
    completedAt,
  }
}

function matchesPayload(expected: TutorialPayload | undefined, actual: TutorialPayload): boolean {
  if (!expected) return true
  return Object.entries(expected).every(([key, expectedValue]) => matchesValue(expectedValue, actual[key]))
}

function matchesValue(expected: TutorialValue, actual: TutorialValue | undefined): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false
    return expected.every((item, index) => matchesValue(item, actual[index]))
  }

  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
    return Object.entries(expected).every(([key, value]) =>
      matchesValue(value as TutorialValue, (actual as Record<string, TutorialValue>)[key])
    )
  }

  return expected === actual
}
