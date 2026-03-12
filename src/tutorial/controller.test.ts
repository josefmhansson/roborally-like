import assert from 'node:assert/strict'
import test from 'node:test'
import { TutorialController } from './controller'
import { TUTORIAL_LESSONS } from './lessons'

test('tutorial controller blocks incorrect actions and advances on matching events', () => {
  const controller = new TutorialController(TUTORIAL_LESSONS)
  controller.startLesson('first_battle', 100)

  assert.deepEqual(controller.getSession(), {
    lessonId: 'first_battle',
    stepIndex: 0,
    startedAt: 100,
    completedAt: null,
  })

  const wrongAction = controller.canPerform('hand_card_select', { defId: 'attack_jab' })
  assert.deepEqual(wrongAction, {
    allowed: false,
    message: 'Use Next to continue the explanation.',
  })

  assert.deepEqual(controller.canPerform('tutorial_next'), { allowed: true })

  const ignoredEvent = controller.recordEvent('card_selected', { defId: 'attack_jab' }, 150)
  assert.equal(ignoredEvent.advanced, false)
  assert.equal(controller.getSession()?.stepIndex, 0)

  controller.recordEvent('manual_next', {}, 160)
  controller.recordEvent('manual_next', {}, 170)
  controller.recordEvent('manual_next', {}, 180)

  assert.equal(controller.getSession()?.stepIndex, 3)
  assert.deepEqual(controller.canPerform('hand_card_select', { defId: 'move_forward' }), { allowed: true })

  const advanced = controller.recordEvent('card_selected', { defId: 'move_forward' }, 200)
  assert.equal(advanced.advanced, true)
  assert.equal(advanced.completed, false)
  assert.equal(controller.getSession()?.stepIndex, 4)

  const wrongBoardPick = controller.canPerform('board_select', { hex: { q: 1, r: 1 } })
  assert.deepEqual(wrongBoardPick, {
    allowed: false,
    message: 'Select the highlighted unit.',
  })
})

test('tutorial controller supports manual next steps', () => {
  const controller = new TutorialController(TUTORIAL_LESSONS)
  controller.startLesson('first_battle', 10)

  assert.deepEqual(controller.canPerform('tutorial_next'), { allowed: true })
  const advanced = controller.recordEvent('manual_next', {}, 20)
  assert.equal(advanced.advanced, true)
  assert.equal(controller.getSession()?.stepIndex, 1)
})

test('tutorial controller persists completion and restart resets the lesson session', () => {
  const controller = new TutorialController(TUTORIAL_LESSONS)
  controller.startLesson('play_online', 10)

  const createResult = controller.recordEvent('online_create_clicked', {}, 20)
  assert.equal(createResult.advanced, true)
  assert.equal(createResult.completed, false)
  assert.equal(controller.getSession()?.stepIndex, 1)

  const joinResult = controller.recordEvent('online_join_clicked', {}, 30)
  assert.equal(joinResult.advanced, true)
  assert.equal(joinResult.completed, true)
  assert.equal(controller.isLessonCompleted('play_online'), true)
  assert.equal(controller.getCompletedCount(), 1)
  assert.equal(controller.getSession()?.completedAt, 30)

  assert.deepEqual(controller.canPerform('winner_primary'), { allowed: true })
  assert.deepEqual(controller.canPerform('winner_secondary'), { allowed: true })
  assert.deepEqual(controller.canPerform('leave_match'), { allowed: true })

  assert.deepEqual(controller.canPerform('online_join'), {
    allowed: false,
    message: 'Lesson complete. Use Tutorial Hub to return.',
  })

  const restarted = controller.restartLesson(40)
  assert.deepEqual(restarted, {
    lessonId: 'play_online',
    stepIndex: 0,
    startedAt: 40,
    completedAt: null,
  })
  assert.equal(controller.getSession()?.stepIndex, 0)
  assert.equal(controller.getSession()?.completedAt, null)
  assert.equal(controller.isLessonCompleted('play_online'), true)
})

test('tutorial controller ignores stale completion entries for removed lessons', () => {
  const controller = new TutorialController(TUTORIAL_LESSONS, {
    completedAt: {
      play_online: 30,
      fight_bot: 20,
    } as Partial<Record<'play_online' | 'fight_bot', number>>,
  })

  assert.equal(controller.getCompletedCount(), 1)
  assert.equal(controller.isLessonCompleted('play_online'), true)
  assert.deepEqual(controller.getProgress(), {
    completedAt: {
      play_online: 30,
    },
  })
})
