import assert from 'node:assert/strict'
import test from 'node:test'
import { cloneTutorialBootstrap, createTutorialScenarioBootstrap } from './scenarios'

test('first battle bootstrap sets the scripted opening state', () => {
  const bootstrap = createTutorialScenarioBootstrap('first_battle')
  assert.equal(bootstrap.mode, 'local')
  assert.equal(bootstrap.screen, 'game')
  assert.equal(bootstrap.state?.players[0].hand[0]?.defId, 'move_forward')
  assert.equal(bootstrap.state?.players[0].deck[0]?.defId, 'attack_jab')
  assert.equal(bootstrap.state?.players[1].hand[0]?.defId, 'move_pivot')
  assert.deepEqual(bootstrap.state?.units['u0-1']?.pos, { q: 2, r: 3 })
  assert.equal(bootstrap.state?.units['leader-1']?.facing, 3)
  assert.equal(bootstrap.statusMessage, 'Tutorial: select Advance.')
})

test('roguelike bootstrap seeds a fixed reward scene and clone isolation', () => {
  const bootstrap = createTutorialScenarioBootstrap('roguelike_run')
  assert.equal(bootstrap.mode, 'roguelike')
  assert.equal(bootstrap.state?.settings.victoryCondition, 'eliminate_units')
  assert.equal(bootstrap.state?.players[0].hand[0]?.defId, 'attack_roguelike_basic')
  assert.deepEqual(bootstrap.state?.units['u0-1']?.pos, { q: 2, r: 2 })
  assert.deepEqual(bootstrap.state?.units['tut-monster-1']?.pos, { q: 2, r: 1 })
  assert.deepEqual(bootstrap.roguelikeRun?.draftOptions, ['spell_lightning', 'move_forward', 'reinforce_boost'])
  assert.equal(bootstrap.roguelikeRun?.pendingRandomReward, 'extraDraw')

  const cloned = cloneTutorialBootstrap(bootstrap)
  assert.notEqual(cloned.state, bootstrap.state)
  assert.notEqual(cloned.roguelikeRun, bootstrap.roguelikeRun)
  cloned.roguelikeRun!.draftOptions[0] = 'move_forward_face'
  assert.deepEqual(bootstrap.roguelikeRun?.draftOptions, ['spell_lightning', 'move_forward', 'reinforce_boost'])
})

test('play online bootstrap stays in tutorial mode with sample room data', () => {
  const bootstrap = createTutorialScenarioBootstrap('play_online')
  assert.equal(bootstrap.mode, 'tutorial')
  assert.equal(bootstrap.screen, 'menu')
  assert.equal(bootstrap.onlineDemo?.roomCode, 'TUTOR1')
  assert.equal(bootstrap.onlineDemo?.seatToken, 'seat-token-p2-demo')
  assert.equal(bootstrap.onlineDemo?.inviteLinks.seat0.includes('/join/TUTOR1/'), true)
  assert.equal(bootstrap.statusMessage, 'Tutorial: review the online flow with sample room details.')
})
