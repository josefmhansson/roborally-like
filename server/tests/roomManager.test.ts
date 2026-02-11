import test from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { RoomManager } from '../roomManager'

function mockSocket(): WebSocket {
  return {
    close: () => {
      // no-op
    },
  } as unknown as WebSocket
}

test('disconnect timeout forfeits to connected seat', () => {
  const manager = new RoomManager(1_000)
  const room = manager.createRoom()
  manager.attachSeat(room, 0, mockSocket())
  manager.attachSeat(room, 1, mockSocket())

  manager.detachSeat(room.code, 1)
  assert.equal(room.paused, true)
  assert.equal(room.reconnectDeadlineAt === null, false)

  room.reconnectDeadlineAt = Date.now() - 10
  const timedOut = manager.tick(Date.now())
  assert.equal(timedOut.some((item) => item.code === room.code), true)
  assert.equal(room.state.winner, 0)
  assert.equal(room.ended, true)
})
