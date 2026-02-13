import test from 'node:test'
import assert from 'node:assert/strict'
import { applyRoomCommand } from '../commandHandlers'
import { RoomManager } from '../roomManager'

test('queue/remove ownership and ready flow', () => {
  const manager = new RoomManager()
  const room = manager.createRoom()

  room.state.players[0].hand = [{ id: 'card-invest', defId: 'spell_invest' }]
  room.state.players[0].orders = []
  room.state.players[1].hand = []
  room.state.players[1].orders = []
  room.state.ready = [false, false]

  const queue = applyRoomCommand(room, 0, {
    type: 'queue_order',
    cardId: 'card-invest',
    params: {},
  })
  assert.equal(queue.ok, true)
  assert.equal(room.state.players[0].orders.length, 1)

  const orderId = room.state.players[0].orders[0].id
  const removeByOpponent = applyRoomCommand(room, 1, {
    type: 'remove_order',
    orderId,
  })
  assert.equal(removeByOpponent.ok, false)

  const ready0 = applyRoomCommand(room, 0, { type: 'ready' })
  assert.equal(ready0.ok, true)
  assert.equal(room.state.ready[0], true)

  const ready1 = applyRoomCommand(room, 1, { type: 'ready' })
  assert.equal(ready1.ok, true)
  assert.equal(Boolean(ready1.ok && ready1.resolutionReplay), true)
  if (ready1.ok && ready1.resolutionReplay) {
    assert.equal(ready1.resolutionReplay.actionStartState.phase, 'action')
    assert.equal(ready1.resolutionReplay.finalState.phase, 'planning')
  }
  assert.equal(room.state.phase, 'planning')
  assert.equal(room.state.turn >= 2, true)
})

test('update_loadout allowed in pregame and rematch resets ended match', () => {
  const manager = new RoomManager()
  const room = manager.createRoom()

  const pregameUpdate = applyRoomCommand(room, 0, {
    type: 'update_loadout',
    loadout: ['spell_invest', 'spell_meteor', 'move_any'],
  })
  assert.equal(pregameUpdate.ok, true)

  room.ended = true
  room.state.winner = 0

  const postGameUpdate = applyRoomCommand(room, 1, {
    type: 'update_loadout',
    loadout: ['attack_arrow', 'move_forward', 'reinforce_spawn'],
  })
  assert.equal(postGameUpdate.ok, true)

  const rematch0 = applyRoomCommand(room, 0, { type: 'rematch' })
  assert.equal(rematch0.ok, true)
  assert.equal(room.ended, true)

  const rematch1 = applyRoomCommand(room, 1, { type: 'rematch' })
  assert.equal(rematch1.ok, true)
  assert.equal(room.ended, false)
  assert.equal(room.state.winner, null)
  assert.equal(room.state.turn, 1)
})

test('update_loadout from other seat does not clear existing rematch request', () => {
  const manager = new RoomManager()
  const room = manager.createRoom()
  room.ended = true
  room.state.winner = 1

  const update0 = applyRoomCommand(room, 0, {
    type: 'update_loadout',
    loadout: ['spell_invest', 'move_any'],
  })
  assert.equal(update0.ok, true)

  const rematch0 = applyRoomCommand(room, 0, { type: 'rematch' })
  assert.equal(rematch0.ok, true)
  assert.equal(room.rematchReady[0], true)
  assert.equal(room.rematchReady[1], false)

  const update1 = applyRoomCommand(room, 1, {
    type: 'update_loadout',
    loadout: ['attack_arrow', 'move_forward'],
  })
  assert.equal(update1.ok, true)
  assert.equal(room.rematchReady[0], true)
  assert.equal(room.rematchReady[1], false)

  const rematch1 = applyRoomCommand(room, 1, { type: 'rematch' })
  assert.equal(rematch1.ok, true)
  assert.equal(room.ended, false)
  assert.equal(room.state.winner, null)
  assert.equal(room.state.turn, 1)
})
