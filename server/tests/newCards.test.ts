import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SETTINGS,
  createGameState,
  getBarricadeSpawnTiles,
  getPlannedOrderValidity,
  planOrder,
  resolveAllActions,
  startActionPhase,
} from '../../src/engine/game'
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

function clearNonLeaderUnits(state: GameState): void {
  Object.keys(state.units).forEach((unitId) => {
    if (!unitId.startsWith('stronghold-')) {
      delete state.units[unitId]
    }
  })
}

test('player 1 starts from the lower side of the board', () => {
  const state = createGameState()
  const p1Leader = state.units['stronghold-0']
  const p2Leader = state.units['stronghold-1']
  assert.ok(p1Leader)
  assert.ok(p2Leader)
  assert.equal(p1Leader.kind, 'leader')
  assert.equal(p2Leader.kind, 'leader')
  assert.ok(p1Leader.modifiers.some((modifier) => modifier.type === 'reinforcementPenalty'))
  assert.ok(p2Leader.modifiers.some((modifier) => modifier.type === 'reinforcementPenalty'))
  assert.ok(p1Leader.pos.r > p2Leader.pos.r)
})

test('leader has Slow and cannot move more than one tile per turn', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 8, drawPerTurn: 8 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_forward'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const leader = state.units['stronghold-0']
  assert.ok(leader)
  assert.equal(leader.kind, 'leader')
  assert.ok(leader.modifiers.some((modifier) => modifier.type === 'slow'))
  const leaderStartPos = { ...leader.pos }

  const moveDirection = ([0, 1, 2, 3, 4, 5] as Direction[]).find((direction) => {
    const target = neighbor(leader.pos, direction)
    if (target.q < 0 || target.q >= state.boardCols || target.r < 0 || target.r >= state.boardRows) return false
    return !Object.values(state.units).some((unit) => unit.pos.q === target.q && unit.pos.r === target.r)
  })
  assert.ok(moveDirection !== undefined)
  const direction = moveDirection as Direction

  const firstMoveCard = findCardId(state, 0, 'move_forward')
  assert.ok(planOrder(state, 0, firstMoveCard, { unitId: leader.id, direction, distance: 3 }))
  const secondMoveCard = findCardId(state, 0, 'move_forward')
  assert.ok(planOrder(state, 0, secondMoveCard, { unitId: leader.id, direction, distance: 3 }))

  readyAndResolve(state)

  const leaderAfter = state.units['stronghold-0']
  assert.ok(leaderAfter)
  const expectedPos = neighbor(leaderStartPos, direction)
  assert.deepEqual(leaderAfter.pos, expectedPos)
  assert.ok(leaderAfter.modifiers.some((modifier) => modifier.type === 'slow'))
  assert.equal(leaderAfter.modifiers.some((modifier) => modifier.type === 'cannotMove'), false)
})

test('commander leader grants adjacent friendly units +1 attack damage', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(
    settings,
    {
      p1: Array.from({ length: settings.deckSize }, () => 'attack_jab'),
      p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    },
    { p1: 'commander', p2: null }
  )

  clearNonLeaderUnits(state)
  const leader = state.units['stronghold-0']
  assert.ok(leader && leader.kind === 'leader')
  leader.pos = { q: 2, r: 2 }
  leader.facing = 0
  state.units['cmd-attacker'] = {
    id: 'cmd-attacker',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['cmd-target'] = {
    id: 'cmd-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_jab')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'cmd-attacker', direction: 0 }))
  readyAndResolve(state)

  assert.equal(state.units['cmd-target']?.strength, 1)
  assert.ok(
    state.units['cmd-attacker']?.modifiers.some(
      (modifier) => modifier.type === 'strong' && modifier.turnsRemaining === 'indefinite'
    )
  )
})

test('commander aura Strong is applied and removed based on adjacency', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 8, drawPerTurn: 8 }
  const state = createGameState(
    settings,
    {
      p1: Array.from({ length: settings.deckSize }, () => 'move_any'),
      p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    },
    { p1: 'commander', p2: null }
  )

  clearNonLeaderUnits(state)
  const leader = state.units['stronghold-0']
  assert.ok(leader && leader.kind === 'leader')
  leader.pos = { q: 2, r: 2 }
  leader.facing = 0
  state.units['cmd-aura-unit'] = {
    id: 'cmd-aura-unit',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 0, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const moveIntoAura = findCardId(state, 0, 'move_any')
  assert.ok(planOrder(state, 0, moveIntoAura, { unitId: 'cmd-aura-unit', direction: 0, distance: 1 }))
  readyAndResolve(state)
  assert.deepEqual(state.units['cmd-aura-unit']?.pos, { q: 1, r: 2 })
  assert.ok(
    state.units['cmd-aura-unit']?.modifiers.some(
      (modifier) => modifier.type === 'strong' && modifier.turnsRemaining === 'indefinite'
    )
  )

  const moveOutOfAura = findCardId(state, 0, 'move_any')
  assert.ok(planOrder(state, 0, moveOutOfAura, { unitId: 'cmd-aura-unit', direction: 3, distance: 1 }))
  readyAndResolve(state)
  assert.deepEqual(state.units['cmd-aura-unit']?.pos, { q: 0, r: 2 })
  assert.equal(state.units['cmd-aura-unit']?.modifiers.some((modifier) => modifier.type === 'strong'), false)
})

test('warleader leader can move full distance without Slow restriction', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 8, drawPerTurn: 8 }
  const state = createGameState(
    settings,
    {
      p1: Array.from({ length: settings.deckSize }, () => 'move_forward'),
      p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    },
    { p1: 'warleader', p2: null }
  )

  clearNonLeaderUnits(state)
  const leader = state.units['stronghold-0']
  assert.ok(leader && leader.kind === 'leader')
  assert.equal(leader.modifiers.some((modifier) => modifier.type === 'slow'), false)
  const leaderStart = { ...leader.pos }

  const moveDirection = ([0, 1, 2, 3, 4, 5] as Direction[]).find((direction) => {
    let cursor = { ...leaderStart }
    for (let step = 0; step < 3; step += 1) {
      cursor = neighbor(cursor, direction)
      if (cursor.q < 0 || cursor.q >= state.boardCols || cursor.r < 0 || cursor.r >= state.boardRows) return false
      const occupied = Object.values(state.units).some((unit) => unit.pos.q === cursor.q && unit.pos.r === cursor.r)
      if (occupied) return false
    }
    return true
  })
  assert.ok(moveDirection !== undefined)
  const direction = moveDirection as Direction

  let expected = { ...leaderStart }
  for (let step = 0; step < 3; step += 1) {
    expected = neighbor(expected, direction)
  }

  const cardId = findCardId(state, 0, 'move_forward')
  assert.ok(planOrder(state, 0, cardId, { unitId: leader.id, direction, distance: 3 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['stronghold-0']?.pos, expected)
})

test('archmage leader gains +1 AP next turn when it stayed still last turn', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 8, drawPerTurn: 8, actionBudgetP1: 3 }
  const state = createGameState(
    settings,
    {
      p1: Array.from({ length: settings.deckSize }, () => 'move_forward'),
      p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    },
    { p1: 'archmage', p2: null }
  )

  assert.equal(state.actionBudgets[0], 3)

  readyAndResolve(state)
  assert.equal(state.turn, 2)
  assert.equal(state.actionBudgets[0], 4)

  const leader = state.units['stronghold-0']
  assert.ok(leader && leader.kind === 'leader')
  const moveDirection = ([0, 1, 2, 3, 4, 5] as Direction[]).find((direction) => {
    const target = neighbor(leader.pos, direction)
    if (target.q < 0 || target.q >= state.boardCols || target.r < 0 || target.r >= state.boardRows) return false
    return !Object.values(state.units).some((unit) => unit.pos.q === target.q && unit.pos.r === target.r)
  })
  assert.ok(moveDirection !== undefined)
  const cardId = findCardId(state, 0, 'move_forward')
  assert.ok(planOrder(state, 0, cardId, { unitId: leader.id, direction: moveDirection as Direction, distance: 1 }))

  readyAndResolve(state)
  assert.equal(state.turn, 3)
  assert.equal(state.actionBudgets[0], 3)
})

test('leader spell resistance halves spell damage rounded down', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_meteor'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const enemyLeader = state.units['stronghold-1']
  assert.ok(enemyLeader)
  assert.equal(enemyLeader.kind, 'leader')
  assert.ok(enemyLeader.modifiers.some((modifier) => modifier.type === 'spellResistance'))
  const startStrength = enemyLeader.strength

  const meteorCardId = findCardId(state, 0, 'spell_meteor')
  const planned = planOrder(state, 0, meteorCardId, { tile: { ...enemyLeader.pos } })
  assert.ok(planned)

  readyAndResolve(state)

  const leaderAfter = state.units['stronghold-1']
  assert.ok(leaderAfter)
  assert.equal(leaderAfter.strength, startStrength - 2)
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

test('pitfall trap triggers on movement, deals 2 damage, snares, and stops movement', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_pitfall_trap'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_any'),
  })

  clearNonLeaderUnits(state)
  state.units['trap-anchor'] = {
    id: 'trap-anchor',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 3 },
    facing: 0,
    modifiers: [],
  }
  state.units['trap-target'] = {
    id: 'trap-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const trapTile = { q: 3, r: 2 }
  const trapCardId = findCardId(state, 0, 'spell_pitfall_trap')
  const moveCardId = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 0, trapCardId, { tile: trapTile }))
  assert.ok(planOrder(state, 1, moveCardId, { unitId: 'trap-target', direction: 0, distance: 3 }))

  readyAndResolve(state)

  const moved = state.units['trap-target']
  assert.ok(moved)
  assert.deepEqual(moved.pos, trapTile)
  assert.equal(moved.strength, 2)
  const snared = moved.modifiers.find((modifier) => modifier.type === 'cannotMove')
  assert.ok(snared)
  assert.equal(snared.turnsRemaining, 1)
  assert.equal(state.traps.length, 0)
})

test('pitfall trap triggers on friendly movement by default', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: ['spell_pitfall_trap', 'move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['friendly-trap-anchor'] = {
    id: 'friendly-trap-anchor',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 3 },
    facing: 0,
    modifiers: [],
  }
  state.units['friendly-trap-target'] = {
    id: 'friendly-trap-target',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const trapTile = { q: 3, r: 2 }
  const trapCardId = findCardId(state, 0, 'spell_pitfall_trap')
  const moveCardId = findCardId(state, 0, 'move_any')
  assert.ok(planOrder(state, 0, trapCardId, { tile: trapTile }))
  assert.ok(planOrder(state, 0, moveCardId, { unitId: 'friendly-trap-target', direction: 0, distance: 3 }))

  readyAndResolve(state)

  const moved = state.units['friendly-trap-target']
  assert.ok(moved)
  assert.deepEqual(moved.pos, trapTile)
  assert.equal(moved.strength, 2)
  const snared = moved.modifiers.find((modifier) => modifier.type === 'cannotMove')
  assert.ok(snared)
  assert.equal(snared.turnsRemaining, 1)
  assert.equal(state.traps.length, 0)
})

test('planning ignores hidden enemy trap effects for follow-up orders', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: ['move_forward', 'attack_jab', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['planning-trap-user'] = {
    id: 'planning-trap-user',
    owner: 0,
    kind: 'unit',
    strength: 2,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['planning-trap-target'] = {
    id: 'planning-trap-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.traps.push({
    id: 'planning-hidden-pitfall',
    owner: 1,
    kind: 'pitfall',
    pos: { q: 2, r: 2 },
  })

  const moveCardId = findCardId(state, 0, 'move_forward')
  assert.ok(planOrder(state, 0, moveCardId, { unitId: 'planning-trap-user', direction: 0, distance: 1 }))
  const jabCardId = findCardId(state, 0, 'attack_jab')
  assert.ok(planOrder(state, 0, jabCardId, { unitId: 'planning-trap-user', direction: 0 }))
  assert.deepEqual(getPlannedOrderValidity(state, 0), [true, true])

  readyAndResolve(state)

  assert.equal(state.units['planning-trap-user'], undefined)
  assert.equal(state.units['planning-trap-target']?.strength, 4)
})

test('explosive trap triggers on movement and does not stop movement', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_explosive_trap'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_any'),
  })

  clearNonLeaderUnits(state)
  state.units['explosive-anchor'] = {
    id: 'explosive-anchor',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 3 },
    facing: 0,
    modifiers: [],
  }
  state.units['explosive-target'] = {
    id: 'explosive-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const trapCardId = findCardId(state, 0, 'spell_explosive_trap')
  const moveCardId = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 0, trapCardId, { tile: { q: 3, r: 2 } }))
  assert.ok(planOrder(state, 1, moveCardId, { unitId: 'explosive-target', direction: 0, distance: 3 }))

  readyAndResolve(state)

  const moved = state.units['explosive-target']
  assert.ok(moved)
  assert.deepEqual(moved.pos, { q: 4, r: 2 })
  assert.equal(moved.strength, 1)
  assert.equal(moved.modifiers.some((modifier) => modifier.type === 'cannotMove'), false)
  assert.equal(state.traps.length, 0)
})

test('pitfall trap kill still records move destination in the log', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_pitfall_trap'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_any'),
  })

  clearNonLeaderUnits(state)
  state.units['kill-anchor'] = {
    id: 'kill-anchor',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 3 },
    facing: 0,
    modifiers: [],
  }
  state.units['kill-target'] = {
    id: 'kill-target',
    owner: 1,
    kind: 'unit',
    strength: 2,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const trapTile = { q: 3, r: 2 }
  const trapCardId = findCardId(state, 0, 'spell_pitfall_trap')
  const moveCardId = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 0, trapCardId, { tile: trapTile }))
  assert.ok(planOrder(state, 1, moveCardId, { unitId: 'kill-target', direction: 0, distance: 3 }))

  readyAndResolve(state)

  assert.equal(state.units['kill-target'], undefined)
  assert.ok(state.log.some((entry) => entry === 'Unit kill-target moves to 3,2.'))
  assert.ok(state.log.some((entry) => entry === 'Unit kill-target triggers a pitfall trap at 3,2.'))
})

test('spawning onto an enemy trap triggers the trap immediately', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_pitfall_trap'),
    p2: Array.from({ length: settings.deckSize }, () => 'reinforce_battlefield_recruitment'),
  })

  clearNonLeaderUnits(state)
  state.units['spawn-trap-anchor'] = {
    id: 'spawn-trap-anchor',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 3 },
    facing: 0,
    modifiers: [],
  }
  state.units['spawn-target-anchor'] = {
    id: 'spawn-target-anchor',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 4, r: 3 },
    facing: 3,
    modifiers: [],
  }

  const trapTile = { q: 3, r: 2 }
  const trapCardId = findCardId(state, 0, 'spell_pitfall_trap')
  const recruitCardId = findCardId(state, 1, 'reinforce_battlefield_recruitment')
  assert.ok(planOrder(state, 0, trapCardId, { tile: trapTile }))
  assert.ok(planOrder(state, 1, recruitCardId, { tile: trapTile, direction: 0 }))

  readyAndResolve(state)

  const spawned = Object.values(state.units).find(
    (unit) => unit.owner === 1 && unit.kind === 'unit' && unit.pos.q === trapTile.q && unit.pos.r === trapTile.r
  )
  assert.equal(spawned, undefined)
  assert.equal(state.traps.length, 0)
  assert.ok(state.log.some((entry) => entry.includes('triggers a pitfall trap at 3,2.')))
})

test('teleport moves within range without triggering traps on intermediate tiles', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_teleport'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['tp-user'] = {
    id: 'tp-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.traps.push({
    id: 'tp-mid',
    owner: 1,
    kind: 'pitfall',
    pos: { q: 2, r: 2 },
  })

  const cardId = findCardId(state, 0, 'move_teleport')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'tp-user', tile: { q: 3, r: 2 } }))
  readyAndResolve(state)

  const actorAfter = state.units['tp-user']
  assert.ok(actorAfter)
  assert.deepEqual(actorAfter.pos, { q: 3, r: 2 })
  assert.equal(actorAfter.strength, 4)
  assert.equal(state.traps.some((trap) => trap.id === 'tp-mid'), true)
})

test('chain lightning jumps across adjacent unique units and never hits the origin unit', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_chain_lightning'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['cl-user'] = {
    id: 'cl-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['cl-a'] = {
    id: 'cl-a',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['cl-b'] = {
    id: 'cl-b',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['cl-c'] = {
    id: 'cl-c',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_chain_lightning')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'cl-user' }))
  readyAndResolve(state)

  assert.equal(state.units['cl-user']?.strength, 4)
  assert.equal(state.units['cl-a']?.strength, 2)
  assert.equal(state.units['cl-b']?.strength, 2)
  assert.equal(state.units['cl-c']?.strength, 2)
})

test('battlefield recruitment spawns a 1-strength unit adjacent to a friendly unit', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_battlefield_recruitment'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const cardId = findCardId(state, 0, 'reinforce_battlefield_recruitment')
  const candidates = getBarricadeSpawnTiles(state, 0)
  assert.ok(candidates.length > 0)
  const tile = candidates[0]
  const beforeIds = new Set(Object.keys(state.units))

  assert.ok(planOrder(state, 0, cardId, { tile, direction: 0 }))
  readyAndResolve(state)

  const recruited = Object.values(state.units).find(
    (unit) =>
      !beforeIds.has(unit.id) &&
      unit.owner === 0 &&
      unit.kind === 'unit' &&
      unit.pos.q === tile.q &&
      unit.pos.r === tile.r
  )
  assert.ok(recruited)
  assert.equal(recruited.strength, 1)
  assert.equal(recruited.facing, 0)
})

test('planned recruitment spawn on a freshly cleared tile can receive another order in the same planning phase', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6, actionBudgetP1: 6 }
  const state = createGameState(settings, {
    p1: [
      'spell_lightning',
      'reinforce_battlefield_recruitment',
      'move_any',
      'move_pivot',
      'move_pivot',
      'move_pivot',
    ],
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['plan-ally'] = {
    id: 'plan-ally',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['plan-enemy'] = {
    id: 'plan-enemy',
    owner: 1,
    kind: 'unit',
    strength: 1,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const lightningId = findCardId(state, 0, 'spell_lightning')
  const recruitId = findCardId(state, 0, 'reinforce_battlefield_recruitment')
  const moveId = findCardId(state, 0, 'move_any')

  const lightningOrder = planOrder(state, 0, lightningId, { unitId: 'plan-enemy' })
  assert.ok(lightningOrder)

  const recruitOrder = planOrder(state, 0, recruitId, {
    tile: { q: 3, r: 2 },
    direction: 0,
  })
  assert.ok(recruitOrder)

  const followUpOrder = planOrder(state, 0, moveId, {
    unitId: `planned:${recruitOrder.id}`,
    direction: 0,
    distance: 1,
  })
  assert.ok(followUpOrder, 'expected spawned recruitment unit to be orderable during planning')

  readyAndResolve(state)
  const movedRecruit = Object.values(state.units).find(
    (unit) => unit.owner === 0 && unit.kind === 'unit' && unit.pos.q === 4 && unit.pos.r === 2
  )
  assert.ok(movedRecruit)
})

test('planned barricade can be boosted in the same planning phase', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6, actionBudgetP1: 6 }
  const state = createGameState(settings, {
    p1: [
      'reinforce_barricade',
      'reinforce_boost',
      'move_pivot',
      'move_pivot',
      'move_pivot',
      'move_pivot',
    ],
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['pb-anchor'] = {
    id: 'pb-anchor',
    owner: 0,
    kind: 'unit',
    strength: 2,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const barricadeCardId = findCardId(state, 0, 'reinforce_barricade')
  const boostCardId = findCardId(state, 0, 'reinforce_boost')
  const spawnTiles = getBarricadeSpawnTiles(state, 0)
  assert.ok(spawnTiles.length >= 2)

  const barricadeOrder = planOrder(state, 0, barricadeCardId, { tile: spawnTiles[0], tile2: spawnTiles[1] })
  assert.ok(barricadeOrder)

  const boostOrder = planOrder(state, 0, boostCardId, { unitId: `planned:${barricadeOrder.id}:tile2` })
  assert.ok(boostOrder)

  readyAndResolve(state)

  const firstBarricade = Object.values(state.units).find(
    (unit) =>
      unit.owner === 0 &&
      unit.kind === 'barricade' &&
      unit.pos.q === spawnTiles[0].q &&
      unit.pos.r === spawnTiles[0].r
  )
  const secondBarricade = Object.values(state.units).find(
    (unit) =>
      unit.owner === 0 &&
      unit.kind === 'barricade' &&
      unit.pos.q === spawnTiles[1].q &&
      unit.pos.r === spawnTiles[1].r
  )
  assert.ok(firstBarricade)
  assert.ok(secondBarricade)
  assert.equal(firstBarricade.strength, 1)
  assert.equal(secondBarricade.strength, 2)
})

test('mass boost grants +2 to units and halved gain to leader', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_mass_boost'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['mb-a'] = {
    id: 'mb-a',
    owner: 0,
    kind: 'unit',
    strength: 2,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['mb-b'] = {
    id: 'mb-b',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  const leaderBefore = state.units['stronghold-0']?.strength ?? 0

  const cardId = findCardId(state, 0, 'reinforce_mass_boost')
  assert.ok(planOrder(state, 0, cardId, {}))
  readyAndResolve(state)

  assert.equal(state.units['mb-a']?.strength, 4)
  assert.equal(state.units['mb-b']?.strength, 5)
  assert.equal(state.units['stronghold-0']?.strength, leaderBefore + 1)
})

test('train on a leader is halved and rounded down', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_boost_spawn'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const leaderBefore = state.units['stronghold-0']?.strength ?? 0
  const cardId = findCardId(state, 0, 'reinforce_boost_spawn')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'stronghold-0' }))

  readyAndResolve(state)

  assert.equal(state.units['stronghold-0']?.strength, leaderBefore + 1)
})

test('coordinated attack applies 2 damage from each friendly unit to the tile in front', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_coordinated'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['co-a'] = {
    id: 'co-a',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['co-b'] = {
    id: 'co-b',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 3 },
    facing: 0,
    modifiers: [],
  }
  state.units['co-target-a'] = {
    id: 'co-target-a',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['co-target-b'] = {
    id: 'co-target-b',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 2, r: 3 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_coordinated')
  assert.ok(planOrder(state, 0, cardId, {}))
  readyAndResolve(state)

  assert.equal(state.units['co-target-a']?.strength, 1)
  assert.equal(state.units['co-target-b']?.strength, 1)
})

test('tandem movement moves the selected unit and adjacent friendlies in one direction', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_tandem'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['tm-main'] = {
    id: 'tm-main',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['tm-adjacent'] = {
    id: 'tm-adjacent',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 2 },
    facing: 1,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'move_tandem')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'tm-main', direction: 0, distance: 2 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['tm-main']?.pos, { q: 4, r: 2 })
  assert.deepEqual(state.units['tm-adjacent']?.pos, { q: 3, r: 2 })
  assert.equal(state.units['tm-main']?.facing, 0)
  assert.equal(state.units['tm-adjacent']?.facing, 1)
})

test('tandem movement lets leader units follow after adjacent allies move away', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_tandem'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  const leader = state.units['stronghold-0']
  assert.ok(leader)
  leader.pos = { q: 2, r: 2 }
  leader.facing = 0

  state.units['tm-front'] = {
    id: 'tm-front',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'move_tandem')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'stronghold-0', direction: 0, distance: 3 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['stronghold-0']?.pos, { q: 3, r: 2 })
  assert.deepEqual(state.units['tm-front']?.pos, { q: 5, r: 2 })
})

test('tandem movement does not pass through a non-participant blocker', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_tandem'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['tm-main'] = {
    id: 'tm-main',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['tm-front'] = {
    id: 'tm-front',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['tm-back'] = {
    id: 'tm-back',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['tm-blocker'] = {
    id: 'tm-blocker',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 5, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'move_tandem')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'tm-main', direction: 0, distance: 3 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['tm-front']?.pos, { q: 4, r: 2 })
  assert.deepEqual(state.units['tm-main']?.pos, { q: 3, r: 2 })
  assert.deepEqual(state.units['tm-back']?.pos, { q: 2, r: 2 })
  assert.deepEqual(state.units['tm-blocker']?.pos, { q: 5, r: 2 })
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

test('divination grants three extra cards on the next draw phase', () => {
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
  assert.equal(state.players[0].hand.length, settings.drawPerTurn + 3)
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

test('burn does not stack when applied multiple times', () => {
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
  assert.equal(stacks.length, 1)
  assert.equal(afterFirstTurn.strength, 5)

  readyAndResolve(state)

  const afterSecondTurn = state.units[enemyUnit.id]
  assert.ok(afterSecondTurn)
  assert.equal(afterSecondTurn.strength, 4)
})

test('disarm reduces damage dealt by the target unit for two turns', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 12, drawPerTurn: 12 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_disarm'),
    p2: Array.from({ length: settings.deckSize }, () => 'attack_fwd_lr'),
  })

  clearNonLeaderUnits(state)
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

  clearNonLeaderUnits(state)
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

  clearNonLeaderUnits(state)
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

  clearNonLeaderUnits(state)
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

test('harpoon damages and pulls the first unit in line toward the attacker', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_harpoon'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['harpoon-user'] = {
    id: 'harpoon-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['harpoon-target'] = {
    id: 'harpoon-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_harpoon')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'harpoon-user' }))
  readyAndResolve(state)

  const targetAfter = state.units['harpoon-target']
  assert.ok(targetAfter)
  assert.equal(targetAfter.strength, 3)
  assert.deepEqual(targetAfter.pos, { q: 2, r: 2 })
})

test('execute destroys non-leader units directly in front', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_execute'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['exec-user'] = {
    id: 'exec-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['exec-target'] = {
    id: 'exec-target',
    owner: 1,
    kind: 'unit',
    strength: 10,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_execute')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'exec-user' }))
  readyAndResolve(state)

  assert.equal(state.units['exec-target'], undefined)
})

test('execute deals 3 damage to leaders in front', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_execute'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['exec-user'] = {
    id: 'exec-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  const leader = state.units['stronghold-1']
  assert.ok(leader && leader.kind === 'leader')
  leader.pos = { q: 3, r: 2 }
  const startStrength = leader.strength

  const cardId = findCardId(state, 0, 'attack_execute')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'exec-user' }))
  readyAndResolve(state)

  const leaderAfter = state.units['stronghold-1']
  assert.ok(leaderAfter)
  assert.equal(leaderAfter.strength, startStrength - 3)
})

test('charge only needs a direction and moves until blocked before attacking', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_charge'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['charge-user'] = {
    id: 'charge-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['charge-blocker'] = {
    id: 'charge-blocker',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_charge')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'charge-user', direction: 0 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['charge-user']?.pos, { q: 3, r: 2 })
  assert.equal(state.units['charge-blocker']?.strength, 3)
})

test('blade dance chains three moves and damages adjacent units after each step', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6, actionBudgetP1: 3 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_blade_dance'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['bd-user'] = {
    id: 'bd-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['bd-step-1'] = {
    id: 'bd-step-1',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 3 },
    facing: 3,
    modifiers: [],
  }
  state.units['bd-step-2-3'] = {
    id: 'bd-step-2-3',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 0 },
    facing: 3,
    modifiers: [],
  }
  state.units['bd-step-3'] = {
    id: 'bd-step-3',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['bd-all-steps'] = {
    id: 'bd-all-steps',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_blade_dance')
  assert.ok(
    planOrder(state, 0, cardId, {
      unitId: 'bd-user',
      tile: { q: 2, r: 2 },
      tile2: { q: 3, r: 1 },
      tile3: { q: 4, r: 1 },
      direction: 0,
      moveDirection: 1,
      faceDirection: 0,
    })
  )
  readyAndResolve(state)

  assert.deepEqual(state.units['bd-user']?.pos, { q: 4, r: 1 })
  assert.equal(state.units['bd-step-1']?.strength, 2)
  assert.equal(state.units['bd-step-2-3']?.strength, 1)
  assert.equal(state.units['bd-step-3']?.strength, 2)
  assert.equal(state.units['bd-all-steps']?.strength, 1)
})

test('blade dance only damages after a successful movement step', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6, actionBudgetP1: 3 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_blade_dance'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['bd-user'] = {
    id: 'bd-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['bd-blocker'] = {
    id: 'bd-blocker',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['bd-step-1-only'] = {
    id: 'bd-step-1-only',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 1 },
    facing: 3,
    modifiers: [],
  }
  state.units['bd-step-3-only'] = {
    id: 'bd-step-3-only',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 4, r: 3 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_blade_dance')
  assert.ok(
    planOrder(state, 0, cardId, {
      unitId: 'bd-user',
      tile: { q: 2, r: 2 },
      tile2: { q: 3, r: 2 },
      tile3: { q: 4, r: 3 },
      direction: 0,
      moveDirection: 0,
      faceDirection: 5,
    })
  )
  readyAndResolve(state)

  assert.deepEqual(state.units['bd-user']?.pos, { q: 3, r: 3 })
  assert.equal(state.units['bd-blocker']?.strength, 3)
  assert.equal(state.units['bd-step-1-only']?.strength, 2)
  assert.equal(state.units['bd-step-3-only']?.strength, 2)
})

test('whirlwind damages adjacent units and pushes when space is open', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_whirlwind'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
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

test('whirlwind can damage and push enemy leader', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_whirlwind'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  const enemyLeader = state.units['stronghold-1']
  assert.ok(enemyLeader && enemyLeader.kind === 'leader')
  const leaderStartPos = { ...enemyLeader.pos }
  const leaderStartStrength = enemyLeader.strength

  const setup = ([0, 1, 2, 3, 4, 5] as Direction[])
    .map((dir) => {
      const actorTile = neighbor(enemyLeader.pos, dir)
      const pushTile = neighbor(enemyLeader.pos, ((dir + 3) % 6) as Direction)
      return { dir, actorTile, pushTile }
    })
    .find(({ actorTile, pushTile }) => {
      if (actorTile.q < 0 || actorTile.q >= state.boardCols || actorTile.r < 0 || actorTile.r >= state.boardRows) return false
      if (pushTile.q < 0 || pushTile.q >= state.boardCols || pushTile.r < 0 || pushTile.r >= state.boardRows) return false
      const actorOccupied = Object.values(state.units).some((unit) => unit.pos.q === actorTile.q && unit.pos.r === actorTile.r)
      const pushOccupied = Object.values(state.units).some((unit) => unit.pos.q === pushTile.q && unit.pos.r === pushTile.r)
      return !actorOccupied && !pushOccupied
    })
  assert.ok(setup)

  state.units['ww-actor-stronghold'] = {
    id: 'ww-actor-stronghold',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: setup.actorTile,
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_whirlwind')
  const planned = planOrder(state, 0, cardId, { unitId: 'ww-actor-stronghold' })
  assert.ok(planned)

  readyAndResolve(state)

  const leaderAfter = state.units['stronghold-1']
  assert.ok(leaderAfter)
  assert.equal(leaderAfter.strength, leaderStartStrength - 3)
  assert.notDeepEqual(leaderAfter.pos, leaderStartPos)
})

test('slow cards and subsequent cards resolve after all non-slow cards', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: ['attack_roguelike_slow', 'attack_jab', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: ['attack_jab', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
  })

  clearNonLeaderUnits(state)
  state.units['slow-user'] = {
    id: 'slow-user',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['slow-enemy'] = {
    id: 'slow-enemy',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const slowCardId = findCardId(state, 0, 'attack_roguelike_slow')
  const p1JabCardId = findCardId(state, 0, 'attack_jab')
  const p2JabCardId = findCardId(state, 1, 'attack_jab')
  assert.ok(planOrder(state, 0, slowCardId, { unitId: 'slow-user', direction: 0 }))
  assert.ok(planOrder(state, 0, p1JabCardId, { unitId: 'slow-user', direction: 0 }))
  assert.ok(planOrder(state, 1, p2JabCardId, { unitId: 'slow-enemy', direction: 3 }))

  state.ready = [true, true]
  startActionPhase(state)

  assert.deepEqual(
    state.actionQueue.map((order) => `${order.player}:${order.defId}`),
    ['1:attack_jab', '0:attack_roguelike_slow', '0:attack_jab']
  )
})

test('roguelike elimination victory triggers when all enemy mobs are defeated', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'slimes' as const,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_execute'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['elim-user'] = {
    id: 'elim-user',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['elim-target'] = {
    id: 'elim-target',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'slime_small',
  }

  const cardId = findCardId(state, 0, 'attack_execute')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'elim-user' }))
  readyAndResolve(state)

  assert.equal(state.winner, 0)
  assert.ok(state.units['stronghold-1'])
  assert.ok(state.log.some((entry) => entry === 'Player 1 wins by eliminating all enemy units.'))
})

test('destroyed slimes split into two smaller scaled slimes', () => {
  const matchNumber = 8
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'slimes' as const,
    roguelikeMatchNumber: matchNumber,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_execute'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['split-user'] = {
    id: 'split-user',
    owner: 0,
    kind: 'unit',
    strength: 6,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['slime-grand'] = {
    id: 'slime-grand',
    owner: 1,
    kind: 'unit',
    strength: 1,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'slime_grand',
  }

  const cardId = findCardId(state, 0, 'attack_execute')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'split-user' }))
  readyAndResolve(state)

  assert.equal(state.units['slime-grand'], undefined)
  const children = Object.values(state.units).filter((unit) => unit.owner === 1 && unit.roguelikeRole === 'slime_mid')
  assert.equal(children.length, 2)
  children.forEach((child) => {
    assert.equal(child.strength, 3 + Math.floor(matchNumber / 2))
  })
  assert.equal(
    state.log.filter((entry) => entry.startsWith('Slime split: slime-grand lobs from ')).length,
    2
  )
  assert.equal(state.winner, null)
})

test('stomp stuns adjacent enemies and blocks their later orders this turn', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: ['move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: ['attack_roguelike_stomp', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
  })

  clearNonLeaderUnits(state)
  state.units['stun-target'] = {
    id: 'stun-target',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['stomp-user'] = {
    id: 'stomp-user',
    owner: 1,
    kind: 'unit',
    strength: 6,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const p1MoveCardId = findCardId(state, 0, 'move_any')
  const stompCardId = findCardId(state, 1, 'attack_roguelike_stomp')
  assert.ok(planOrder(state, 0, p1MoveCardId, { unitId: 'stun-target', direction: 0, distance: 1 }))
  assert.ok(planOrder(state, 1, stompCardId, { unitId: 'stomp-user' }))

  state.activePlayer = 1
  readyAndResolve(state)

  const targetAfter = state.units['stun-target']
  assert.ok(targetAfter)
  assert.deepEqual(targetAfter.pos, { q: 2, r: 2 })
  assert.ok(state.log.some((entry) => entry === 'Unit stun-target is stunned and cannot act this turn.'))
})

test('regeneration heals units at turn end', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['regen-troll'] = {
    id: 'regen-troll',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [{ type: 'regeneration', turnsRemaining: 'indefinite' }],
    roguelikeRole: 'troll',
  }

  readyAndResolve(state)

  assert.equal(state.units['regen-troll']?.strength, 6)
  assert.ok(state.log.some((entry) => entry === 'Regeneration heals unit regen-troll for 1.'))
})

test('pack hunt uses scaled damage per adjacent ally', () => {
  const matchNumber = 7
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    roguelikeMatchNumber: matchNumber,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: ['attack_roguelike_pack_hunt', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
  })

  clearNonLeaderUnits(state)
  const targetTile = { q: 4, r: 2 }
  state.units['alpha'] = {
    id: 'alpha',
    owner: 1,
    kind: 'unit',
    strength: 8,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'alpha_wolf',
  }
  state.units['wolf-a'] = {
    id: 'wolf-a',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: neighbor(targetTile, 2),
    facing: 3,
    modifiers: [],
    roguelikeRole: 'wolf',
  }
  state.units['wolf-b'] = {
    id: 'wolf-b',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: neighbor(targetTile, 5),
    facing: 3,
    modifiers: [],
    roguelikeRole: 'wolf',
  }
  state.units['pack-prey'] = {
    id: 'pack-prey',
    owner: 0,
    kind: 'unit',
    strength: 20,
    pos: targetTile,
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 1, 'attack_roguelike_pack_hunt')
  assert.ok(planOrder(state, 1, cardId, { unitId: 'alpha', direction: 0 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['alpha']?.pos, { q: 3, r: 2 })
  assert.equal(state.units['pack-prey']?.strength, 8)
})

test('mark only targets enemies and advances allied units toward the target', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_roguelike_mark'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['mark-a'] = {
    id: 'mark-a',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 1 },
    facing: 0,
    modifiers: [],
  }
  state.units['mark-b'] = {
    id: 'mark-b',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 3 },
    facing: 0,
    modifiers: [],
  }
  state.units['mark-target'] = {
    id: 'mark-target',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'spell_roguelike_mark')
  assert.equal(planOrder(state, 0, cardId, { unitId: 'mark-a' }), null)
  assert.ok(planOrder(state, 0, cardId, { unitId: 'mark-target' }))
  readyAndResolve(state)

  assert.deepEqual(state.units['mark-a']?.pos, { q: 2, r: 1 })
  assert.deepEqual(state.units['mark-b']?.pos, { q: 1, r: 2 })
})

test('roguelike basic attack scales damage with match number', () => {
  const matchNumber = 11
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    roguelikeMatchNumber: matchNumber,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_roguelike_basic'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['scaled-user'] = {
    id: 'scaled-user',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['scaled-target'] = {
    id: 'scaled-target',
    owner: 1,
    kind: 'unit',
    strength: 7,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_roguelike_basic')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'scaled-user', direction: 0 }))
  readyAndResolve(state)

  assert.equal(state.units['scaled-target']?.strength, 4)
})
