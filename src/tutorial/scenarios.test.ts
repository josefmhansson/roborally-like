import assert from 'node:assert/strict'
import test from 'node:test'
import { cloneTutorialBootstrap, createTutorialScenarioBootstrap } from './scenarios'

test('first battle bootstrap sets the scripted opening state', () => {
  const bootstrap = createTutorialScenarioBootstrap('first_battle')
  assert.equal(bootstrap.mode, 'local')
  assert.equal(bootstrap.screen, 'game')
  assert.equal(bootstrap.state?.players[0].hand[0]?.defId, 'move_forward')
  assert.deepEqual(
    bootstrap.state?.players[0].deck.map((card) => card.defId),
    ['reinforce_spawn', 'attack_jab', 'attack_jab']
  )
  assert.equal(bootstrap.state?.players[1].hand[0]?.defId, 'move_pivot')
  assert.equal(bootstrap.state?.players[1].deck[0]?.defId, 'reinforce_boost')
  assert.deepEqual(bootstrap.state?.units['u0-1']?.pos, { q: 2, r: 3 })
  assert.deepEqual(bootstrap.state?.units['u1-2']?.pos, { q: 3, r: 0 })
  assert.equal(bootstrap.state?.units['leader-1']?.facing, 3)
  assert.equal(bootstrap.state?.settings.actionBudgetP1, 2)
  assert.equal(bootstrap.state?.settings.drawPerTurn, 2)
  assert.equal(bootstrap.statusMessage, 'Tutorial: select Advance.')
})

test('build deck bootstrap stays on loadout and clone isolation', () => {
  const bootstrap = createTutorialScenarioBootstrap('build_deck')
  assert.equal(bootstrap.mode, 'local')
  assert.equal(bootstrap.screen, 'loadout')
  assert.equal(bootstrap.state?.settings.deckSize, 10)
  assert.equal(bootstrap.state?.settings.maxCopies, 2)
  assert.equal(bootstrap.loadouts?.p1.length, 8)
  assert.equal(bootstrap.playerClasses?.p1, 'commander')

  const cloned = cloneTutorialBootstrap(bootstrap)
  assert.notEqual(cloned.state, bootstrap.state)
  assert.notEqual(cloned.loadouts, bootstrap.loadouts)
  cloned.loadouts!.p1[0] = 'attack_jab'
  assert.notEqual(bootstrap.loadouts?.p1[0], 'attack_jab')
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
