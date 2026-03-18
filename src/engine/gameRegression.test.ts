import assert from 'node:assert/strict'
import test from 'node:test'

import { neighbor } from './hex'
import { createGameState, DEFAULT_SETTINGS, planOrder, resolveAllActions, startActionPhase, syncUnitState } from './game'
import type { Direction, GameState, Hex, PlayerId, Unit } from './types'

function setHand(state: GameState, player: PlayerId, defIds: string[]): void {
  state.players[player].deck = []
  state.players[player].discard = []
  state.players[player].orders = []
  state.players[player].hand = defIds.map((defId, index) => ({
    id: `p${player}-c${index + 1}`,
    defId: defId as typeof state.players[player].hand[number]['defId'],
  }))
}

function inBounds(state: GameState, hex: Hex): boolean {
  return hex.q >= 0 && hex.q < state.boardCols && hex.r >= 0 && hex.r < state.boardRows
}

function key(hex: Hex): string {
  return `${hex.q},${hex.r}`
}

function findOpenNeighbor(state: GameState, origin: Hex, blocked: Set<string>): { direction: Direction; tile: Hex } {
  for (let direction = 0 as Direction; direction < 6; direction += 1) {
    const tile = neighbor(origin, direction)
    if (!inBounds(state, tile)) continue
    if (blocked.has(key(tile))) continue
    return { direction, tile }
  }
  throw new Error(`No open neighbor found for ${origin.q},${origin.r}`)
}

function makeUnit(id: string, owner: PlayerId, pos: Hex, facing: Direction = 0, strength = 2): Unit {
  return {
    id,
    owner,
    kind: 'unit',
    strength,
    pos: { ...pos },
    facing,
    modifiers: [],
  }
}

test('Double Steps cannot reuse a slow unit after it already moved this action phase', () => {
  const state = createGameState(DEFAULT_SETTINGS, { p1: [], p2: [] }, { p1: 'commander', p2: 'commander' })
  const leader0 = { ...state.units['leader-0'], pos: { q: 2, r: 4 } }
  const leader1 = { ...state.units['leader-1'], pos: { q: 5, r: 0 } }
  const ally = makeUnit('slow-ally', 0, { q: 0, r: 4 }, 0, 2)
  state.units = {
    'leader-0': leader0,
    'leader-1': leader1,
    [ally.id]: ally,
  }
  syncUnitState(state)

  setHand(state, 0, ['move_forward', 'move_double_steps'])
  setHand(state, 1, [])

  const occupied = new Set(Object.values(state.units).map((unit) => key(unit.pos)))
  const firstLeaderMove = findOpenNeighbor(state, leader0.pos, occupied)
  const projectedOccupied = new Set(occupied)
  projectedOccupied.delete(key(leader0.pos))
  projectedOccupied.add(key(firstLeaderMove.tile))
  const secondLeaderMove = findOpenNeighbor(state, firstLeaderMove.tile, projectedOccupied)
  const allyMove = findOpenNeighbor(state, ally.pos, projectedOccupied)

  assert.ok(
    planOrder(state, 0, state.players[0].hand[0]!.id, {
      unitId: 'leader-0',
      direction: firstLeaderMove.direction,
      distance: 1,
    })
  )

  assert.ok(
    planOrder(state, 0, state.players[0].hand[0]!.id, {
      unitId: 'leader-0',
      tile: secondLeaderMove.tile,
      unitId2: ally.id,
      tile2: allyMove.tile,
    })
  )

  state.ready = [true, true]
  startActionPhase(state)
  resolveAllActions(state)

  assert.deepEqual(state.units['leader-0']?.pos, firstLeaderMove.tile)
  assert.deepEqual(state.units[ally.id]?.pos, allyMove.tile)
})

test('Pincer Attack hits a target with two opposite-side attackers', () => {
  const state = createGameState(DEFAULT_SETTINGS, { p1: [], p2: [] }, { p1: 'commander', p2: 'commander' })
  const targetPos = { q: 2, r: 2 }
  const leader0 = { ...state.units['leader-0'], pos: { q: 0, r: 5 } }
  const leader1 = { ...state.units['leader-1'], pos: { q: 5, r: 0 } }
  state.units = {
    'leader-0': leader0,
    'leader-1': leader1,
    'pincer-a': makeUnit('pincer-a', 0, neighbor(targetPos, 0), 0, 2),
    'pincer-b': makeUnit('pincer-b', 0, neighbor(targetPos, 3), 3, 2),
    target: makeUnit('target', 1, targetPos, 0, 8),
  }
  syncUnitState(state)

  setHand(state, 0, ['attack_pincer_attack'])
  setHand(state, 1, [])
  state.ready = [true, true]

  assert.ok(planOrder(state, 0, state.players[0].hand[0]!.id, {}))
  startActionPhase(state)
  resolveAllActions(state)

  assert.equal(state.units.target?.strength, 4)
})

test('Pincer Attack also hits a target with three evenly spaced attackers', () => {
  const state = createGameState(DEFAULT_SETTINGS, { p1: [], p2: [] }, { p1: 'commander', p2: 'commander' })
  const targetPos = { q: 2, r: 2 }
  const leader0 = { ...state.units['leader-0'], pos: { q: 0, r: 5 } }
  const leader1 = { ...state.units['leader-1'], pos: { q: 5, r: 0 } }
  state.units = {
    'leader-0': leader0,
    'leader-1': leader1,
    'pincer-a': makeUnit('pincer-a', 0, neighbor(targetPos, 0), 0, 2),
    'pincer-b': makeUnit('pincer-b', 0, neighbor(targetPos, 2), 2, 2),
    'pincer-c': makeUnit('pincer-c', 0, neighbor(targetPos, 4), 4, 2),
    target: makeUnit('target', 1, targetPos, 0, 8),
  }
  syncUnitState(state)

  setHand(state, 0, ['attack_pincer_attack'])
  setHand(state, 1, [])
  state.ready = [true, true]

  assert.ok(planOrder(state, 0, state.players[0].hand[0]!.id, {}))
  startActionPhase(state)
  resolveAllActions(state)

  assert.equal(state.units.target?.strength, 4)
})
