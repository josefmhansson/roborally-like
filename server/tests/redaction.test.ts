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
