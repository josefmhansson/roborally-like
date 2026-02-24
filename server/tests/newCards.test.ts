import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SETTINGS, createGameState, getBarricadeSpawnTiles, planOrder, resolveAllActions, startActionPhase } from '../../src/engine/game'
import { neighbor } from '../../src/engine/hex'
import type { CardDefId, Direction, GameState, PlayerId } from '../../src/engine/types'

function findCardId(state: GameState, player: PlayerId, defId: CardDefId): string {
  const card = state.players[player].hand.find((entry) => entry.defId === defId)
  assert.ok(card, `expected ${defId} in player ${player + 1} hand`)
  return card.id
}

function readyAndResolve(state: GameState): void {
  state.ready = [true, true]
  startActionPhase(state)
  resolveAllActions(state)
}

test('barricade card spawns two barricade units on valid tiles', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_barricade'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const cardId = findCardId(state, 0, 'reinforce_barricade')
  const spawnTiles = getBarricadeSpawnTiles(state, 0)
  assert.ok(spawnTiles.length >= 2)

  const planned = planOrder(state, 0, cardId, { tile: spawnTiles[0], tile2: spawnTiles[1] })
  assert.ok(planned)

  readyAndResolve(state)

  const barricades = Object.values(state.units).filter((unit) => unit.owner === 0 && unit.kind === 'barricade')
  assert.equal(barricades.length, 2)
})

test('trip prevents movement this turn and expires at end of turn', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_trip'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_any'),
  })

  const enemyUnit = Object.values(state.units).find((unit) => unit.owner === 1 && unit.kind === 'unit')
  assert.ok(enemyUnit)
  const enemyStart = { ...enemyUnit.pos }

  const moveDirection = ([0, 1, 2, 3, 4, 5] as Direction[]).find((direction) => {
    const target = neighbor(enemyUnit.pos, direction)
    if (target.q < 0 || target.q >= state.boardCols || target.r < 0 || target.r >= state.boardRows) return false
    return !Object.values(state.units).some((unit) => unit.pos.q === target.q && unit.pos.r === target.r)
  })
  assert.ok(moveDirection !== undefined, 'expected at least one legal movement direction for enemy unit')

  const tripCardId = findCardId(state, 0, 'spell_trip')
  const moveCardId = findCardId(state, 1, 'move_any')

  const tripPlanned = planOrder(state, 0, tripCardId, { unitId: enemyUnit.id })
  assert.ok(tripPlanned)
  const movePlanned = planOrder(state, 1, moveCardId, {
    unitId: enemyUnit.id,
    direction: moveDirection,
    distance: 1,
  })
  assert.ok(movePlanned)

  readyAndResolve(state)

  const enemyAfter = state.units[enemyUnit.id]
  assert.ok(enemyAfter)
  assert.deepEqual(enemyAfter.pos, enemyStart)
  assert.equal(enemyAfter.modifiers.length, 0)
  assert.equal(state.turn, 2)
})

test('divination grants two extra cards on the next draw phase', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 10, drawPerTurn: 3 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_divination'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const cardId = findCardId(state, 0, 'spell_divination')
  const planned = planOrder(state, 0, cardId, {})
  assert.ok(planned)

  readyAndResolve(state)

  assert.equal(state.turn, 2)
  assert.equal(state.players[0].hand.length, settings.drawPerTurn + 2)
  assert.equal(state.players[0].modifiers.length, 0)
})

test('dispel can target barricades and removes their modifiers', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_dispel'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  state.units['b-test'] = {
    id: 'b-test',
    owner: 1,
    kind: 'barricade',
    strength: 1,
    pos: { q: 0, r: 2 },
    facing: 0,
    modifiers: [{ type: 'cannotMove', turnsRemaining: 2 }],
  }

  const cardId = findCardId(state, 0, 'spell_dispel')
  const planned = planOrder(state, 0, cardId, { unitId: 'b-test' })
  assert.ok(planned)

  readyAndResolve(state)

  assert.equal(state.units['b-test']?.modifiers.length, 0)
})
