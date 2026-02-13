import test from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { RoomManager } from '../roomManager'
import type { CardDefId } from '../../src/engine/types'

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

test('first join loadout uses submitted P1 deck, pads to deck size, and trims excess', () => {
  const manager = new RoomManager()
  const room = manager.createRoom({
    settings: {
      boardRows: 6,
      boardCols: 6,
      strongholdStrength: 5,
      deckSize: 6,
      drawPerTurn: 2,
      maxCopies: 3,
      actionBudgetP1: 3,
      actionBudgetP2: 3,
    },
    loadouts: {
      p1: ['reinforce_spawn'],
      p2: ['reinforce_spawn'],
    },
  })

  const submitted: CardDefId[] = [
    'spell_invest',
    'move_forward',
    'spell_lightning',
    'move_any',
    'attack_fwd',
    'spell_meteor',
    'attack_arrow',
    'reinforce_boost',
  ]
  manager.applySeatLoadoutOnFirstJoin(room, 1, submitted)
  const seatCards = [...room.state.players[1].hand, ...room.state.players[1].deck].map((card) => card.defId)

  assert.equal(seatCards.length, 6)
  assert.deepEqual(
    sortDefIds(seatCards),
    sortDefIds(submitted.slice(0, 6))
  )

  manager.applySeatLoadoutOnFirstJoin(room, 1, ['reinforce_spawn'])
  const seatCardsAfterRelock = [...room.state.players[1].hand, ...room.state.players[1].deck].map((card) => card.defId)
  assert.deepEqual(sortDefIds(seatCardsAfterRelock), sortDefIds(seatCards))

  const roomPadded = manager.createRoom({
    settings: {
      boardRows: 6,
      boardCols: 6,
      strongholdStrength: 5,
      deckSize: 6,
      drawPerTurn: 2,
      maxCopies: 3,
      actionBudgetP1: 3,
      actionBudgetP2: 3,
    },
    loadouts: {
      p1: ['reinforce_spawn'],
      p2: ['reinforce_spawn'],
    },
  })

  manager.applySeatLoadoutOnFirstJoin(roomPadded, 1, ['spell_meteor'])
  const paddedCards = [...roomPadded.state.players[1].hand, ...roomPadded.state.players[1].deck].map((card) => card.defId)
  assert.equal(paddedCards.length, 6)
  assert.equal(paddedCards.filter((defId) => defId === 'spell_meteor').length, 1)
})

function sortDefIds(values: CardDefId[]): CardDefId[] {
  return [...values].sort((a, b) => a.localeCompare(b)) as CardDefId[]
}
