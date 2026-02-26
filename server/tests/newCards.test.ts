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

function clearNonStrongholdUnits(state: GameState): void {
  Object.keys(state.units).forEach((unitId) => {
    if (!unitId.startsWith('stronghold-')) {
      delete state.units[unitId]
    }
  })
}

test('player 1 starts from the lower side of the board', () => {
  const state = createGameState()
  const p1Stronghold = state.units['stronghold-0']
  const p2Stronghold = state.units['stronghold-1']
  assert.ok(p1Stronghold)
  assert.ok(p2Stronghold)
  assert.ok(p1Stronghold.pos.r > p2Stronghold.pos.r)
})

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

test('trip prevents movement for two turns', () => {
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

  const enemyAfterTurnOne = state.units[enemyUnit.id]
  assert.ok(enemyAfterTurnOne)
  assert.deepEqual(enemyAfterTurnOne.pos, enemyStart)
  const moveLock = enemyAfterTurnOne.modifiers.find((modifier) => modifier.type === 'cannotMove')
  assert.ok(moveLock)
  assert.equal(moveLock.turnsRemaining, 1)
  assert.equal(state.turn, 2)

  const moveCardIdTurnTwo = findCardId(state, 1, 'move_any')
  const moveAgainPlanned = planOrder(state, 1, moveCardIdTurnTwo, {
    unitId: enemyUnit.id,
    direction: moveDirection,
    distance: 1,
  })
  assert.ok(moveAgainPlanned)

  readyAndResolve(state)

  const enemyAfterTurnTwo = state.units[enemyUnit.id]
  assert.ok(enemyAfterTurnTwo)
  assert.deepEqual(enemyAfterTurnTwo.pos, enemyStart)
  assert.equal(enemyAfterTurnTwo.modifiers.length, 0)
  assert.equal(state.turn, 3)
})

test('snare now lasts four turns total', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_snare'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const enemyUnit = Object.values(state.units).find((unit) => unit.owner === 1 && unit.kind === 'unit')
  assert.ok(enemyUnit)

  const cardId = findCardId(state, 0, 'spell_snare')
  const planned = planOrder(state, 0, cardId, { unitId: enemyUnit.id })
  assert.ok(planned)

  readyAndResolve(state)

  const enemyAfter = state.units[enemyUnit.id]
  assert.ok(enemyAfter)
  const moveLock = enemyAfter.modifiers.find((modifier) => modifier.type === 'cannotMove')
  assert.ok(moveLock)
  assert.equal(moveLock.turnsRemaining, 3)
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

test('barricades are valid reinforcement targets', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_boost'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  state.units['b-friendly'] = {
    id: 'b-friendly',
    owner: 0,
    kind: 'barricade',
    strength: 1,
    pos: { q: 0, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'reinforce_boost')
  const planned = planOrder(state, 0, cardId, { unitId: 'b-friendly' })
  assert.ok(planned)

  readyAndResolve(state)

  assert.equal(state.units['b-friendly']?.strength, 2)
})

test('barricades are valid spell targets', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_lightning'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  state.units['b-enemy'] = {
    id: 'b-enemy',
    owner: 1,
    kind: 'barricade',
    strength: 1,
    pos: { q: 0, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'spell_lightning')
  const planned = planOrder(state, 0, cardId, { unitId: 'b-enemy' })
  assert.ok(planned)

  readyAndResolve(state)

  assert.equal(state.units['b-enemy'], undefined)
})

test('burn deals damage each turn and lasts indefinitely', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 8, drawPerTurn: 4 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_burn'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const enemyUnit = Object.values(state.units).find((unit) => unit.owner === 1 && unit.kind === 'unit')
  assert.ok(enemyUnit)

  const burnCardId = findCardId(state, 0, 'spell_burn')
  const planned = planOrder(state, 0, burnCardId, { unitId: enemyUnit.id })
  assert.ok(planned)

  readyAndResolve(state)

  const afterFirstTurn = state.units[enemyUnit.id]
  assert.ok(afterFirstTurn)
  assert.equal(afterFirstTurn.strength, 1)
  const burn = afterFirstTurn.modifiers.find((modifier) => modifier.type === 'burn')
  assert.ok(burn)
  assert.equal(burn.turnsRemaining, 'indefinite')

  readyAndResolve(state)

  assert.equal(state.units[enemyUnit.id], undefined)
})

test('burn stacks when applied multiple times and deals damage per stack', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 8, drawPerTurn: 8 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_burn'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const enemyUnit = Object.values(state.units).find((unit) => unit.owner === 1 && unit.kind === 'unit')
  assert.ok(enemyUnit)
  enemyUnit.strength = 6

  const burnCardA = findCardId(state, 0, 'spell_burn')
  assert.ok(planOrder(state, 0, burnCardA, { unitId: enemyUnit.id }))
  const burnCardB = findCardId(state, 0, 'spell_burn')
  assert.ok(planOrder(state, 0, burnCardB, { unitId: enemyUnit.id }))

  readyAndResolve(state)

  const afterFirstTurn = state.units[enemyUnit.id]
  assert.ok(afterFirstTurn)
  const stacks = afterFirstTurn.modifiers.filter((modifier) => modifier.type === 'burn')
  assert.equal(stacks.length, 2)
  assert.equal(afterFirstTurn.strength, 4)

  readyAndResolve(state)

  const afterSecondTurn = state.units[enemyUnit.id]
  assert.ok(afterSecondTurn)
  assert.equal(afterSecondTurn.strength, 2)
})

test('disarm reduces damage dealt by the target unit for two turns', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 12, drawPerTurn: 12 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_disarm'),
    p2: Array.from({ length: settings.deckSize }, () => 'attack_fwd_lr'),
  })

  clearNonStrongholdUnits(state)
  const actorPos = { q: 2, r: 2 }
  const enemyPos = neighbor(actorPos, 0)
  state.units['p1-actor'] = {
    id: 'p1-actor',
    owner: 0,
    kind: 'unit',
    strength: 8,
    pos: actorPos,
    facing: 0,
    modifiers: [],
  }
  state.units['p2-attacker'] = {
    id: 'p2-attacker',
    owner: 1,
    kind: 'unit',
    strength: 8,
    pos: enemyPos,
    facing: 3,
    modifiers: [],
  }

  const disarmCardId = findCardId(state, 0, 'attack_disarm')
  const strikeCardIdTurnOne = findCardId(state, 1, 'attack_fwd_lr')
  assert.ok(planOrder(state, 0, disarmCardId, { unitId: 'p1-actor', direction: 0 }))
  assert.ok(planOrder(state, 1, strikeCardIdTurnOne, { unitId: 'p2-attacker' }))
  readyAndResolve(state)

  const actorAfterTurnOne = state.units['p1-actor']
  const attackerAfterTurnOne = state.units['p2-attacker']
  assert.ok(actorAfterTurnOne)
  assert.ok(attackerAfterTurnOne)
  assert.equal(actorAfterTurnOne.strength, 7)
  const disarmedAfterTurnOne = attackerAfterTurnOne.modifiers.find((modifier) => modifier.type === 'disarmed')
  assert.ok(disarmedAfterTurnOne)
  assert.equal(disarmedAfterTurnOne.turnsRemaining, 1)

  const strikeCardIdTurnTwo = findCardId(state, 1, 'attack_fwd_lr')
  assert.ok(planOrder(state, 1, strikeCardIdTurnTwo, { unitId: 'p2-attacker' }))
  readyAndResolve(state)

  const actorAfterTurnTwo = state.units['p1-actor']
  const attackerAfterTurnTwo = state.units['p2-attacker']
  assert.ok(actorAfterTurnTwo)
  assert.ok(attackerAfterTurnTwo)
  assert.equal(actorAfterTurnTwo.strength, 6)
  assert.equal(attackerAfterTurnTwo.modifiers.filter((modifier) => modifier.type === 'disarmed').length, 0)

  const strikeCardIdTurnThree = findCardId(state, 1, 'attack_fwd_lr')
  assert.ok(planOrder(state, 1, strikeCardIdTurnThree, { unitId: 'p2-attacker' }))
  readyAndResolve(state)

  const actorAfterTurnThree = state.units['p1-actor']
  assert.ok(actorAfterTurnThree)
  assert.equal(actorAfterTurnThree.strength, 4)
})

test('bleed applies stackable vulnerable that increases damage taken', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 12, drawPerTurn: 12 }
  const state = createGameState(settings, {
    p1: ['attack_bleed', 'attack_bleed', 'attack_jab', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonStrongholdUnits(state)
  const actorPos = { q: 2, r: 2 }
  const targetPos = neighbor(actorPos, 0)
  state.units['p1-bleeder'] = {
    id: 'p1-bleeder',
    owner: 0,
    kind: 'unit',
    strength: 8,
    pos: actorPos,
    facing: 0,
    modifiers: [],
  }
  state.units['p2-target'] = {
    id: 'p2-target',
    owner: 1,
    kind: 'unit',
    strength: 8,
    pos: targetPos,
    facing: 3,
    modifiers: [],
  }

  const bleedA = findCardId(state, 0, 'attack_bleed')
  const jab = findCardId(state, 0, 'attack_jab')
  assert.ok(planOrder(state, 0, bleedA, { unitId: 'p1-bleeder', direction: 0 }))
  const bleedB = findCardId(state, 0, 'attack_bleed')
  assert.ok(planOrder(state, 0, bleedB, { unitId: 'p1-bleeder', direction: 0 }))
  assert.ok(planOrder(state, 0, jab, { unitId: 'p1-bleeder', direction: 0 }))
  readyAndResolve(state)

  const targetAfter = state.units['p2-target']
  assert.ok(targetAfter)
  assert.equal(targetAfter.strength, 1)
  const vulnerableStacks = targetAfter.modifiers.filter((modifier) => modifier.type === 'vulnerable')
  assert.equal(vulnerableStacks.length, 2)
  vulnerableStacks.forEach((modifier) => {
    assert.equal(modifier.turnsRemaining, 1)
  })
})

test('rage and bolster share strong logic with stacking and turn duration', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 12, drawPerTurn: 12 }
  const state = createGameState(settings, {
    p1: ['reinforce_rage', 'reinforce_bolster', 'attack_jab', 'attack_jab', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonStrongholdUnits(state)
  const actorPos = { q: 2, r: 2 }
  const targetPos = neighbor(actorPos, 0)
  state.units['p1-rager'] = {
    id: 'p1-rager',
    owner: 0,
    kind: 'unit',
    strength: 8,
    pos: actorPos,
    facing: 0,
    modifiers: [],
  }
  state.units['p2-target'] = {
    id: 'p2-target',
    owner: 1,
    kind: 'unit',
    strength: 10,
    pos: targetPos,
    facing: 3,
    modifiers: [],
  }

  const rage = findCardId(state, 0, 'reinforce_rage')
  const bolster = findCardId(state, 0, 'reinforce_bolster')
  const jabTurnOne = findCardId(state, 0, 'attack_jab')
  assert.ok(planOrder(state, 0, rage, { unitId: 'p1-rager' }))
  assert.ok(planOrder(state, 0, bolster, { unitId: 'p1-rager' }))
  assert.ok(planOrder(state, 0, jabTurnOne, { unitId: 'p1-rager', direction: 0 }))
  readyAndResolve(state)

  const targetAfterTurnOne = state.units['p2-target']
  const actorAfterTurnOne = state.units['p1-rager']
  assert.ok(targetAfterTurnOne)
  assert.ok(actorAfterTurnOne)
  assert.equal(targetAfterTurnOne.strength, 6)
  assert.equal(actorAfterTurnOne.modifiers.filter((modifier) => modifier.type === 'strong').length, 1)
  assert.equal(actorAfterTurnOne.modifiers.filter((modifier) => modifier.type === 'vulnerable').length, 1)

  const jabTurnTwo = findCardId(state, 0, 'attack_jab')
  assert.ok(planOrder(state, 0, jabTurnTwo, { unitId: 'p1-rager', direction: 0 }))
  readyAndResolve(state)

  const targetAfterTurnTwo = state.units['p2-target']
  assert.ok(targetAfterTurnTwo)
  assert.equal(targetAfterTurnTwo.strength, 3)
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

test('priority cards jump ahead of opposing non-priority cards', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 8, drawPerTurn: 8 }
  const state = createGameState(settings, {
    p1: ['move_any', 'attack_jab', 'move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: ['move_any', 'move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
  })

  const p1Unit = Object.values(state.units).find((unit) => unit.owner === 0 && unit.kind === 'unit')
  const p2Unit = Object.values(state.units).find((unit) => unit.owner === 1 && unit.kind === 'unit')
  assert.ok(p1Unit)
  assert.ok(p2Unit)

  const p1MoveCardId = findCardId(state, 0, 'move_any')
  const p1JabCardId = findCardId(state, 0, 'attack_jab')
  const p2MoveCardId = findCardId(state, 1, 'move_any')

  assert.ok(planOrder(state, 0, p1MoveCardId, { unitId: p1Unit.id, direction: 0, distance: 1 }))
  assert.ok(planOrder(state, 0, p1JabCardId, { unitId: p1Unit.id, direction: 0 }))
  const p1SecondMoveCardId = findCardId(state, 0, 'move_any')
  assert.ok(planOrder(state, 0, p1SecondMoveCardId, { unitId: p1Unit.id, direction: 1, distance: 1 }))
  assert.ok(planOrder(state, 1, p2MoveCardId, { unitId: p2Unit.id, direction: 3, distance: 1 }))
  const p2SecondMoveCardId = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 1, p2SecondMoveCardId, { unitId: p2Unit.id, direction: 4, distance: 1 }))

  state.ready = [true, true]
  startActionPhase(state)

  assert.deepEqual(
    state.actionQueue.map((order) => `${order.player}:${order.defId}`),
    ['0:move_any', '0:attack_jab', '1:move_any', '1:move_any', '0:move_any']
  )
})

test('priority card leads even when opponent is active player', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: ['attack_jab', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: ['move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
  })

  const p1Unit = Object.values(state.units).find((unit) => unit.owner === 0 && unit.kind === 'unit')
  const p2Unit = Object.values(state.units).find((unit) => unit.owner === 1 && unit.kind === 'unit')
  assert.ok(p1Unit)
  assert.ok(p2Unit)

  const p1JabCardId = findCardId(state, 0, 'attack_jab')
  const p2MoveCardId = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 0, p1JabCardId, { unitId: p1Unit.id, direction: 0 }))
  assert.ok(planOrder(state, 1, p2MoveCardId, { unitId: p2Unit.id, direction: 3, distance: 1 }))

  state.activePlayer = 1
  state.ready = [true, true]
  startActionPhase(state)

  assert.deepEqual(
    state.actionQueue.map((order) => `${order.player}:${order.defId}`),
    ['0:attack_jab', '1:move_any']
  )
})

test('shove deals collision damage when push destination is occupied', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_shove'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonStrongholdUnits(state)
  const actorPos = { q: 2, r: 2 }
  const targetPos = neighbor(actorPos, 0)
  const blockerPos = neighbor(targetPos, 0)

  state.units['u-actor'] = {
    id: 'u-actor',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: actorPos,
    facing: 0,
    modifiers: [],
  }
  state.units['u-target'] = {
    id: 'u-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: targetPos,
    facing: 3,
    modifiers: [],
  }
  state.units['u-blocker'] = {
    id: 'u-blocker',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: blockerPos,
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_shove')
  const planned = planOrder(state, 0, cardId, { unitId: 'u-actor', direction: 0 })
  assert.ok(planned)

  readyAndResolve(state)

  assert.equal(state.units['u-target']?.strength, 1)
  assert.equal(state.units['u-blocker']?.strength, 1)
  assert.deepEqual(state.units['u-target']?.pos, targetPos)
  assert.deepEqual(state.units['u-blocker']?.pos, blockerPos)
})

test('whirlwind damages adjacent units and pushes when space is open', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_whirlwind'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonStrongholdUnits(state)
  const actorPos = { q: 2, r: 2 }
  const frontPos = neighbor(actorPos, 0)
  const frontPushPos = neighbor(frontPos, 0)
  const diagPos = neighbor(actorPos, 1)
  const diagBlockPos = neighbor(diagPos, 1)

  state.units['ww-actor'] = {
    id: 'ww-actor',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: actorPos,
    facing: 0,
    modifiers: [],
  }
  state.units['ww-front'] = {
    id: 'ww-front',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: frontPos,
    facing: 3,
    modifiers: [],
  }
  state.units['ww-diag'] = {
    id: 'ww-diag',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: diagPos,
    facing: 3,
    modifiers: [],
  }
  state.units['ww-blocker'] = {
    id: 'ww-blocker',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: diagBlockPos,
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_whirlwind')
  const planned = planOrder(state, 0, cardId, { unitId: 'ww-actor' })
  assert.ok(planned)

  readyAndResolve(state)

  assert.equal(state.units['ww-front']?.strength, 1)
  assert.deepEqual(state.units['ww-front']?.pos, frontPushPos)
  assert.equal(state.units['ww-diag']?.strength, 1)
  assert.deepEqual(state.units['ww-diag']?.pos, diagPos)
  assert.equal(state.units['ww-blocker']?.strength, 4)
})

test('whirlwind costs 2 AP', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6, actionBudgetP1: 2 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_whirlwind'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const actor = Object.values(state.units).find((unit) => unit.owner === 0 && unit.kind === 'unit')
  assert.ok(actor)

  const firstCardId = findCardId(state, 0, 'attack_whirlwind')
  const firstPlanned = planOrder(state, 0, firstCardId, { unitId: actor.id })
  assert.ok(firstPlanned)

  const secondCardId = findCardId(state, 0, 'attack_whirlwind')
  const secondPlanned = planOrder(state, 0, secondCardId, { unitId: actor.id })
  assert.equal(secondPlanned, null)
})

test('whirlwind can damage enemy stronghold and does not push it', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_whirlwind'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonStrongholdUnits(state)
  const enemyStronghold = state.units['stronghold-1']
  assert.ok(enemyStronghold && enemyStronghold.kind === 'stronghold')
  const strongholdStartPos = { ...enemyStronghold.pos }
  const strongholdStartStrength = enemyStronghold.strength

  const actorPos = ([0, 1, 2, 3, 4, 5] as Direction[]).map((dir) => neighbor(enemyStronghold.pos, dir)).find((tile) => {
    if (tile.q < 0 || tile.q >= state.boardCols || tile.r < 0 || tile.r >= state.boardRows) return false
    return !Object.values(state.units).some((unit) => unit.pos.q === tile.q && unit.pos.r === tile.r)
  })
  assert.ok(actorPos)

  state.units['ww-actor-stronghold'] = {
    id: 'ww-actor-stronghold',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: actorPos,
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_whirlwind')
  const planned = planOrder(state, 0, cardId, { unitId: 'ww-actor-stronghold' })
  assert.ok(planned)

  readyAndResolve(state)

  const strongholdAfter = state.units['stronghold-1']
  assert.ok(strongholdAfter)
  assert.equal(strongholdAfter.strength, strongholdStartStrength - 3)
  assert.deepEqual(strongholdAfter.pos, strongholdStartPos)
})
