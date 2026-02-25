import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStateView } from '../redaction'
import { RoomManager } from '../roomManager'

test('redaction hides opponent hand and planning orders', () => {
  const manager = new RoomManager()
  const room = manager.createRoom()

  const seat0View = buildStateView(room, 0)
  const seat1View = buildStateView(room, 1)

  assert.equal(seat0View.stateView.players[0].hand === null, false)
  assert.equal(seat0View.stateView.players[1].hand, null)
  assert.equal(seat0View.stateView.players[1].orders, null)

  assert.equal(seat1View.stateView.players[1].hand === null, false)
  assert.equal(seat1View.stateView.players[0].hand, null)
  assert.equal(seat1View.stateView.players[0].orders, null)
})

test('redaction strips detailed planned card names during planning', () => {
  const manager = new RoomManager()
  const room = manager.createRoom()
  room.state.phase = 'planning'
  room.state.log.push('Player 1 plans Meteor.')
  room.state.log.push('Player 2 plans Charge.')
  room.state.log.push('Turn 1 draw complete. Active player: 1.')

  const seat0View = buildStateView(room, 0)

  assert.equal(
    seat0View.stateView.log.includes('Player 1 plans Meteor.'),
    false
  )
  assert.equal(
    seat0View.stateView.log.includes('Player 2 plans Charge.'),
    false
  )
  assert.equal(
    seat0View.stateView.log.includes('Player 1 plans a card.'),
    true
  )
  assert.equal(
    seat0View.stateView.log.includes('Player 2 plans a card.'),
    true
  )
  assert.equal(
    seat0View.stateView.log.includes('Turn 1 draw complete. Active player: 1.'),
    true
  )
})
