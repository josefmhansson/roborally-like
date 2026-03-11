import type { TutorialProgress } from './types'

export const TUTORIAL_PROGRESS_STORAGE_KEY = 'untitled_game_tutorial_progress_v1'

export function createEmptyTutorialProgress(): TutorialProgress {
  return { completedAt: {} }
}

export function loadTutorialProgress(storage: Pick<Storage, 'getItem'> = localStorage): TutorialProgress {
  try {
    const raw = storage.getItem(TUTORIAL_PROGRESS_STORAGE_KEY)
    if (!raw) return createEmptyTutorialProgress()
    const parsed = JSON.parse(raw) as Partial<TutorialProgress>
    return {
      completedAt:
        parsed.completedAt && typeof parsed.completedAt === 'object'
          ? { ...parsed.completedAt }
          : {},
    }
  } catch {
    return createEmptyTutorialProgress()
  }
}

export function saveTutorialProgress(
  progress: TutorialProgress,
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  try {
    storage.setItem(TUTORIAL_PROGRESS_STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // Ignore storage failures.
  }
}
