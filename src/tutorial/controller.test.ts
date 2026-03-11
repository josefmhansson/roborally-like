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
    message: 'Select Advance from your hand.',
  })

  assert.deepEqual(controller.canPerform('hand_card_select', { defId: 'move_forward' }), { allowed: true })

  const ignoredEvent = controller.recordEvent('card_selected', { defId: 'attack_jab' }, 150)
  assert.equal(ignoredEvent.advanced, false)
  assert.equal(controller.getSession()?.stepIndex, 0)

  const advanced = controller.recordEvent('card_selected', { defId: 'move_forward' }, 200)
  assert.equal(advanced.advanced, true)
  assert.equal(advanced.completed, false)
  assert.equal(controller.getSession()?.stepIndex, 1)

  const wrongBoardPick = controller.canPerform('board_select', { hex: { q: 1, r: 1 } })
  assert.deepEqual(wrongBoardPick, {
    allowed: false,
    message: 'Select the highlighted unit.',
  })
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

  assert.deepEqual(controller.canPerform('online_join'), {
    allowed: false,
    message: 'Lesson complete. Use Back to Tutorials or Restart.',
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
