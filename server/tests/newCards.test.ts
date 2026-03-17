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
import { CARD_DEFS } from '../../src/engine/cards'
import { neighbor, offsetToAxial } from '../../src/engine/hex'
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
    if (!unitId.startsWith('leader-')) {
      delete state.units[unitId]
    }
  })
}

function hexDistanceBetween(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const aAxial = offsetToAxial(a)
  const bAxial = offsetToAxial(b)
  const dq = aAxial.q - bAxial.q
  const dr = aAxial.r - bAxial.r
  const ds = -aAxial.q - aAxial.r - (-bAxial.q - bAxial.r)
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
}

test('player 1 starts from the lower side of the board', () => {
  const state = createGameState()
  const p1Leader = state.units['leader-0']
  const p2Leader = state.units['leader-1']
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

  const leader = state.units['leader-0']
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

  const leaderAfter = state.units['leader-0']
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
  const leader = state.units['leader-0']
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
  const leader = state.units['leader-0']
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

test('pitfall trap card is renamed to bear trap', () => {
  assert.equal(CARD_DEFS.spell_pitfall_trap.name, 'Bear Trap')
})

test('joint attack includes the originating unit plus adjacent friendly units', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_joint_attack'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  const targetTile = { q: 3, r: 2 }
  state.units['joint-user'] = {
    id: 'joint-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['joint-ally-a'] = {
    id: 'joint-ally-a',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor(targetTile, 1),
    facing: 0,
    modifiers: [],
  }
  state.units['joint-ally-b'] = {
    id: 'joint-ally-b',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor(targetTile, 5),
    facing: 0,
    modifiers: [],
  }
  state.units['joint-target'] = {
    id: 'joint-target',
    owner: 1,
    kind: 'unit',
    strength: 10,
    pos: targetTile,
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_joint_attack')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'joint-user', tile: targetTile }))
  readyAndResolve(state)

  assert.equal(state.units['joint-target']?.strength, 4)
})

test('joint attack uses adjacent allies as individual damage sources', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_joint_attack'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  const targetTile = { q: 3, r: 2 }
  state.units['joint-user'] = {
    id: 'joint-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [{ type: 'strong', turnsRemaining: 1 }],
  }
  state.units['joint-ally-a'] = {
    id: 'joint-ally-a',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor(targetTile, 1),
    facing: 0,
    modifiers: [{ type: 'strong', turnsRemaining: 1 }],
  }
  state.units['joint-ally-b'] = {
    id: 'joint-ally-b',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor(targetTile, 5),
    facing: 0,
    modifiers: [{ type: 'disarmed', turnsRemaining: 1 }],
  }
  state.units['joint-target'] = {
    id: 'joint-target',
    owner: 1,
    kind: 'unit',
    strength: 10,
    pos: targetTile,
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_joint_attack')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'joint-user', tile: targetTile }))
  readyAndResolve(state)

  assert.equal(state.units['joint-target']?.strength, 3)
})

test('joint attack turns participants toward the target tile', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_joint_attack'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  const targetTile = { q: 3, r: 2 }
  state.units['joint-user'] = {
    id: 'joint-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['joint-ally-a'] = {
    id: 'joint-ally-a',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor(targetTile, 1),
    facing: 3,
    modifiers: [],
  }
  state.units['joint-ally-b'] = {
    id: 'joint-ally-b',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor(targetTile, 5),
    facing: 2,
    modifiers: [],
  }
  state.units['joint-target'] = {
    id: 'joint-target',
    owner: 1,
    kind: 'unit',
    strength: 12,
    pos: targetTile,
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_joint_attack')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'joint-user', tile: targetTile }))
  readyAndResolve(state)

  ;(['joint-user', 'joint-ally-a', 'joint-ally-b'] as const).forEach((unitId) => {
    const unit = state.units[unitId]
    assert.ok(unit)
    const expected = ([0, 1, 2, 3, 4, 5] as Direction[]).find((direction) => {
      const candidate = neighbor(unit.pos, direction)
      return candidate.q === targetTile.q && candidate.r === targetTile.r
    })
    assert.notEqual(expected, undefined)
    assert.equal(unit.facing, expected)
  })
})

test('double steps moves two different units to chosen adjacent tiles', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_double_steps'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['double-a'] = {
    id: 'double-a',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['double-b'] = {
    id: 'double-b',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 4 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'move_double_steps')
  assert.ok(
    planOrder(state, 0, cardId, {
      unitId: 'double-a',
      unitId2: 'double-b',
      tile: { q: 2, r: 2 },
      tile2: { q: 2, r: 4 },
    })
  )
  readyAndResolve(state)

  assert.deepEqual(state.units['double-a']?.pos, { q: 2, r: 2 })
  assert.deepEqual(state.units['double-b']?.pos, { q: 2, r: 4 })
  assert.equal(state.units['double-a']?.facing, 0)
  assert.equal(state.units['double-b']?.facing, 3)
})

test('double steps can swap into tiles vacated by the other selected unit', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_double_steps'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['swap-a'] = {
    id: 'swap-a',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['swap-b'] = {
    id: 'swap-b',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'move_double_steps')
  assert.ok(
    planOrder(state, 0, cardId, {
      unitId: 'swap-a',
      tile: { q: 3, r: 2 },
      unitId2: 'swap-b',
      tile2: { q: 2, r: 2 },
    })
  )
  readyAndResolve(state)

  assert.deepEqual(state.units['swap-a']?.pos, { q: 3, r: 2 })
  assert.deepEqual(state.units['swap-b']?.pos, { q: 2, r: 2 })
})

test('pincer attack damages surrounded enemy units only', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6, actionBudgetP1: 1 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_pincer_attack'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  const surroundedTile = { q: 2, r: 2 }
  state.units['pincer-target'] = {
    id: 'pincer-target',
    owner: 1,
    kind: 'unit',
    strength: 6,
    pos: surroundedTile,
    facing: 3,
    modifiers: [],
  }
  ;([0, 1, 2, 3, 4, 5] as Direction[]).forEach((direction, index) => {
    state.units[`pincer-ally-${index}`] = {
      id: `pincer-ally-${index}`,
      owner: 0,
      kind: 'unit',
      strength: 4,
      pos: neighbor(surroundedTile, direction),
      facing: 0,
      modifiers: [],
    }
  })
  state.units['pincer-open-target'] = {
    id: 'pincer-open-target',
    owner: 1,
    kind: 'unit',
    strength: 6,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_pincer_attack')
  assert.ok(planOrder(state, 0, cardId, {}))
  readyAndResolve(state)

  assert.equal(state.units['pincer-target']?.strength, 2)
  assert.equal(state.units['pincer-open-target']?.strength, 6)
})

test('volley deals 1 damage from the acting unit and each adjacent friendly unit', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_volley'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['volley-user'] = {
    id: 'volley-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['volley-ally-a'] = {
    id: 'volley-ally-a',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor({ q: 2, r: 2 }, 1),
    facing: 0,
    modifiers: [],
  }
  state.units['volley-ally-b'] = {
    id: 'volley-ally-b',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor({ q: 2, r: 2 }, 5),
    facing: 0,
    modifiers: [],
  }
  state.units['volley-target'] = {
    id: 'volley-target',
    owner: 1,
    kind: 'unit',
    strength: 6,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_volley')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'volley-user', tile: { q: 4, r: 2 } }))
  readyAndResolve(state)

  assert.equal(state.units['volley-target']?.strength, 3)
})

test('volley uses each participant as an individual damage source', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_volley'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['volley-user'] = {
    id: 'volley-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [{ type: 'disarmed', turnsRemaining: 1 }],
  }
  state.units['volley-ally-a'] = {
    id: 'volley-ally-a',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor({ q: 2, r: 2 }, 1),
    facing: 0,
    modifiers: [{ type: 'strong', turnsRemaining: 1 }],
  }
  state.units['volley-ally-b'] = {
    id: 'volley-ally-b',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: neighbor({ q: 2, r: 2 }, 5),
    facing: 0,
    modifiers: [{ type: 'strong', turnsRemaining: 1 }],
  }
  state.units['volley-target'] = {
    id: 'volley-target',
    owner: 1,
    kind: 'unit',
    strength: 10,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_volley')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'volley-user', tile: { q: 4, r: 2 } }))
  readyAndResolve(state)

  assert.equal(state.units['volley-target']?.strength, 6)
})

test('volley cannot target tiles beyond 2 range', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_volley'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['volley-user'] = {
    id: 'volley-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const outOfRangeTile = state.tiles
    .map((tile) => ({ q: tile.q, r: tile.r }))
    .find((tile) => hexDistanceBetween(state.units['volley-user'].pos, tile) === 3)
  assert.ok(outOfRangeTile)

  const cardId = findCardId(state, 0, 'attack_volley')
  assert.equal(planOrder(state, 0, cardId, { unitId: 'volley-user', tile: outOfRangeTile }), null)
})

test('converge moves friendly units one tile toward the chosen tile and faces the moved direction', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_converge'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['converge-left'] = {
    id: 'converge-left',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 0, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['converge-right'] = {
    id: 'converge-right',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 4, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'move_converge')
  assert.ok(planOrder(state, 0, cardId, { tile: { q: 2, r: 2 } }))
  readyAndResolve(state)

  assert.deepEqual(state.units['converge-left']?.pos, { q: 1, r: 2 })
  assert.equal(state.units['converge-left']?.facing, 0)
  assert.deepEqual(state.units['converge-right']?.pos, { q: 3, r: 2 })
  assert.equal(state.units['converge-right']?.facing, 3)
})

test('converge resolves movement simultaneously so units can fill vacated tiles', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_converge'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['conv-back'] = {
    id: 'conv-back',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['conv-front'] = {
    id: 'conv-front',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'move_converge')
  assert.ok(planOrder(state, 0, cardId, { tile: { q: 4, r: 2 } }))
  readyAndResolve(state)

  assert.deepEqual(state.units['conv-back']?.pos, { q: 2, r: 2 })
  assert.deepEqual(state.units['conv-front']?.pos, { q: 3, r: 2 })
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
  const leader = state.units['leader-0']
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

  assert.deepEqual(state.units['leader-0']?.pos, expected)
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

  const leader = state.units['leader-0']
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

  const enemyLeader = state.units['leader-1']
  assert.ok(enemyLeader)
  assert.equal(enemyLeader.kind, 'leader')
  assert.ok(enemyLeader.modifiers.some((modifier) => modifier.type === 'spellResistance'))
  const startStrength = enemyLeader.strength

  const meteorCardId = findCardId(state, 0, 'spell_meteor')
  const planned = planOrder(state, 0, meteorCardId, { tile: { ...enemyLeader.pos } })
  assert.ok(planned)

  readyAndResolve(state)

  const leaderAfter = state.units['leader-1']
  assert.ok(leaderAfter)
  assert.equal(leaderAfter.strength, startStrength - 2)
})

test('meteor deals 2 splash damage to adjacent units and is a slow card', () => {
  assert.ok(CARD_DEFS.spell_meteor.keywords?.includes('Slow'))

  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_meteor'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  const center = { q: 3, r: 2 }
  state.units['meteor-center'] = {
    id: 'meteor-center',
    owner: 1,
    kind: 'unit',
    strength: 8,
    pos: center,
    facing: 3,
    modifiers: [],
  }
  state.units['meteor-adj-a'] = {
    id: 'meteor-adj-a',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: neighbor(center, 1),
    facing: 3,
    modifiers: [],
  }
  state.units['meteor-adj-b'] = {
    id: 'meteor-adj-b',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: neighbor(center, 5),
    facing: 3,
    modifiers: [],
  }
  state.units['meteor-far'] = {
    id: 'meteor-far',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 0, r: 0 },
    facing: 3,
    modifiers: [],
  }

  const meteorCardId = findCardId(state, 0, 'spell_meteor')
  assert.ok(planOrder(state, 0, meteorCardId, { tile: center }))
  readyAndResolve(state)

  assert.equal(state.units['meteor-center']?.strength, 3)
  assert.equal(state.units['meteor-adj-a']?.strength, 2)
  assert.equal(state.units['meteor-adj-b']?.strength, 2)
  assert.equal(state.units['meteor-far']?.strength, 4)
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

test('bear trap triggers on movement, deals 2 damage, snares, and stops movement', () => {
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

test('bear trap triggers on friendly movement by default', () => {
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

test('bear trap kill still records move destination in the log', () => {
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
  assert.ok(state.log.some((entry) => entry === 'Unit kill-target triggers a bear trap at 3,2.'))
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
  assert.ok(state.log.some((entry) => entry.includes('triggers a bear trap at 3,2.')))
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
  assert.equal(state.units['cl-a']?.strength, 1)
  assert.equal(state.units['cl-b']?.strength, 1)
  assert.equal(state.units['cl-c']?.strength, 1)
})

test('chain lightning does not jump onto slimes spawned earlier in the same resolution', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'slimes' as const,
    roguelikeMatchNumber: 8,
  }
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
  state.units['split-target'] = {
    id: 'split-target',
    owner: 1,
    kind: 'unit',
    strength: 2,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'slime_mid',
  }

  const cardId = findCardId(state, 0, 'attack_chain_lightning')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'cl-user' }))
  readyAndResolve(state)

  const children = Object.values(state.units).filter((unit) => unit.owner === 1 && unit.roguelikeRole === 'slime_small')
  assert.equal(children.length, 2)
  children.forEach((child) => {
    assert.equal(child.strength, 1 + Math.floor(settings.roguelikeMatchNumber! / 8))
  })
})

test('archmage card renames and flame thrower range updates apply', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_line'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  assert.equal(CARD_DEFS.attack_line.name, 'Flame Thrower')
  assert.equal(CARD_DEFS.spell_lightning.name, 'Lightning Strike')

  clearNonLeaderUnits(state)
  state.units['flame-user'] = {
    id: 'flame-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['flame-a'] = {
    id: 'flame-a',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['flame-b'] = {
    id: 'flame-b',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['flame-c'] = {
    id: 'flame-c',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 5, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_line')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'flame-user' }))
  readyAndResolve(state)

  assert.equal(state.units['flame-a']?.strength, 2)
  assert.equal(state.units['flame-b']?.strength, 2)
  assert.equal(state.units['flame-c']?.strength, 4)
})

test('petrify stuns a unit for 2 turns and blocks its actions', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_petrify'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_any'),
  })

  clearNonLeaderUnits(state)
  state.units['pet-target'] = {
    id: 'pet-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const petrifyId = findCardId(state, 0, 'spell_petrify')
  const moveIdTurnOne = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 0, petrifyId, { unitId: 'pet-target' }))
  assert.ok(planOrder(state, 1, moveIdTurnOne, { unitId: 'pet-target', direction: 3, distance: 1 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['pet-target']?.pos, { q: 3, r: 2 })
  assert.equal(state.units['pet-target']?.modifiers.some((modifier) => modifier.type === 'stunned'), true)

  const moveIdTurnTwo = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 1, moveIdTurnTwo, { unitId: 'pet-target', direction: 3, distance: 1 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['pet-target']?.pos, { q: 3, r: 2 })
  assert.equal(state.units['pet-target']?.modifiers.some((modifier) => modifier.type === 'stunned'), false)
})

test('lightning barrier damages adjacent enemies at the end of each turn', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_lightning_barrier'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['barrier-user'] = {
    id: 'barrier-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['barrier-a'] = {
    id: 'barrier-a',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: neighbor({ q: 2, r: 2 }, 0),
    facing: 3,
    modifiers: [],
  }
  state.units['barrier-b'] = {
    id: 'barrier-b',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: neighbor({ q: 2, r: 2 }, 1),
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'reinforce_lightning_barrier')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'barrier-user' }))
  readyAndResolve(state)

  assert.equal(state.units['barrier-a']?.strength, 2)
  assert.equal(state.units['barrier-b']?.strength, 2)
  assert.ok(state.units['barrier-user']?.modifiers.some((modifier) => modifier.type === 'lightningBarrier'))

  readyAndResolve(state)

  assert.equal(state.units['barrier-a']?.strength, 1)
  assert.equal(state.units['barrier-b']?.strength, 1)
})

test('lightning barrier logs a fizzle when no adjacent enemies are present', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_lightning_barrier'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['barrier-user'] = {
    id: 'barrier-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'reinforce_lightning_barrier')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'barrier-user' }))
  readyAndResolve(state)

  assert.ok(state.log.some((entry) => entry === 'Lightning barrier on unit barrier-user crackles but finds no adjacent targets.'))
})

test('brain freeze makes opponent cards slow next turn and cancels priority on affected cards', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 8, drawPerTurn: 8 }
  const state = createGameState(settings, {
    p1: ['spell_brain_freeze', 'move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: ['attack_jab', 'move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
  })

  clearNonLeaderUnits(state)
  state.units['bf-p1'] = {
    id: 'bf-p1',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['bf-p2'] = {
    id: 'bf-p2',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const brainFreezeId = findCardId(state, 0, 'spell_brain_freeze')
  assert.ok(planOrder(state, 0, brainFreezeId, {}))
  readyAndResolve(state)

  assert.ok(state.players[1].modifiers.some((modifier) => modifier.type === 'brainFreeze'))

  state.activePlayer = 0
  const p1Move = findCardId(state, 0, 'move_any')
  const p2Jab = findCardId(state, 1, 'attack_jab')
  const p2Move = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 0, p1Move, { unitId: 'bf-p1', direction: 0, distance: 1 }))
  assert.ok(planOrder(state, 1, p2Jab, { unitId: 'bf-p2', direction: 3 }))
  assert.ok(planOrder(state, 1, p2Move, { unitId: 'bf-p2', direction: 3, distance: 1 }))

  state.ready = [true, true]
  startActionPhase(state)

  assert.deepEqual(
    state.actionQueue.map((order) => `${order.player}:${order.defId}`),
    ['0:move_any', '1:attack_jab', '1:move_any']
  )
  assert.equal(state.players[1].modifiers.some((modifier) => modifier.type === 'brainFreeze'), false)
})

test('ice bolt deals damage and limits movement with Slow for 2 turns', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_ice_bolt'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_any'),
  })

  clearNonLeaderUnits(state)
  state.units['ice-user'] = {
    id: 'ice-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['ice-target'] = {
    id: 'ice-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const iceBoltId = findCardId(state, 0, 'attack_ice_bolt')
  assert.ok(planOrder(state, 0, iceBoltId, { unitId: 'ice-user', direction: 0 }))
  readyAndResolve(state)

  assert.equal(state.units['ice-target']?.strength, 2)
  assert.equal(state.units['ice-target']?.modifiers.some((modifier) => modifier.type === 'slow'), true)

  const moveId = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 1, moveId, { unitId: 'ice-target', direction: 0, distance: 3 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['ice-target']?.pos, { q: 4, r: 2 })
})

test('fireball damages the first unit in line and adjacent tiles around it', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_fireball'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['fireball-user'] = {
    id: 'fireball-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 0, r: 2 },
    facing: 0,
    modifiers: [],
  }
  const center = { q: 2, r: 2 }
  state.units['fireball-center'] = {
    id: 'fireball-center',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: center,
    facing: 3,
    modifiers: [],
  }
  state.units['fireball-adj-a'] = {
    id: 'fireball-adj-a',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: neighbor(center, 1),
    facing: 3,
    modifiers: [],
  }
  state.units['fireball-adj-b'] = {
    id: 'fireball-adj-b',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: neighbor(center, 5),
    facing: 3,
    modifiers: [],
  }
  state.units['fireball-far'] = {
    id: 'fireball-far',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 5, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_fireball')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'fireball-user', direction: 0 }))
  readyAndResolve(state)

  assert.equal(state.units['fireball-center']?.strength, 2)
  assert.equal(state.units['fireball-adj-a']?.strength, 2)
  assert.equal(state.units['fireball-adj-b']?.strength, 2)
  assert.equal(state.units['fireball-far']?.strength, 4)
})

test('blizzard damages and slows all units within a 2 tile radius', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_blizzard'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['bliz-a'] = {
    id: 'bliz-a',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['bliz-b'] = {
    id: 'bliz-b',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['bliz-outside'] = {
    id: 'bliz-outside',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 5, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'spell_blizzard')
  assert.ok(planOrder(state, 0, cardId, { tile: { q: 2, r: 2 } }))
  readyAndResolve(state)

  assert.equal(state.units['bliz-a']?.strength, 3)
  assert.equal(state.units['bliz-b']?.strength, 3)
  assert.equal(state.units['bliz-outside']?.strength, 5)
  assert.equal(state.units['bliz-a']?.modifiers.some((modifier) => modifier.type === 'slow'), true)
  assert.equal(state.units['bliz-b']?.modifiers.some((modifier) => modifier.type === 'slow'), true)
  assert.equal(state.units['bliz-outside']?.modifiers.some((modifier) => modifier.type === 'slow'), false)
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
  const leaderBefore = state.units['leader-0']?.strength ?? 0

  const cardId = findCardId(state, 0, 'reinforce_mass_boost')
  assert.ok(planOrder(state, 0, cardId, {}))
  readyAndResolve(state)

  assert.equal(state.units['mb-a']?.strength, 4)
  assert.equal(state.units['mb-b']?.strength, 5)
  assert.equal(state.units['leader-0']?.strength, leaderBefore + 1)
})

test('train on a leader is halved and rounded down', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_boost_spawn'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const leaderBefore = state.units['leader-0']?.strength ?? 0
  const cardId = findCardId(state, 0, 'reinforce_boost_spawn')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'leader-0' }))

  readyAndResolve(state)

  assert.equal(state.units['leader-0']?.strength, leaderBefore + 1)
})

test('legacy stronghold leader ids still resolve for leader-targeting cards', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_boost_spawn'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  const leaderBefore = state.units['leader-0']?.strength ?? 0
  const cardId = findCardId(state, 0, 'reinforce_boost_spawn')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'stronghold-0' }))

  readyAndResolve(state)

  assert.equal(state.units['leader-0']?.strength, leaderBefore + 1)
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

test('coordinated attack uses each attacker modifier individually', () => {
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
    modifiers: [{ type: 'strong', turnsRemaining: 1 }],
  }
  state.units['co-b'] = {
    id: 'co-b',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 3 },
    facing: 0,
    modifiers: [{ type: 'disarmed', turnsRemaining: 1 }],
  }
  state.units['co-target-a'] = {
    id: 'co-target-a',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['co-target-b'] = {
    id: 'co-target-b',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 3 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_coordinated')
  assert.ok(planOrder(state, 0, cardId, {}))
  readyAndResolve(state)

  assert.equal(state.units['co-target-a']?.strength, 2)
  assert.equal(state.units['co-target-b']?.strength, 4)
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
  const leader = state.units['leader-0']
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
  assert.ok(planOrder(state, 0, cardId, { unitId: 'leader-0', direction: 0, distance: 3 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['leader-0']?.pos, { q: 3, r: 2 })
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

test('bash deals damage and prevents the target from acting later that turn', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_bash'),
    p2: ['move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
  })

  clearNonLeaderUnits(state)
  state.units['bash-user'] = {
    id: 'bash-user',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['bash-target'] = {
    id: 'bash-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const bashCardId = findCardId(state, 0, 'attack_bash')
  const moveCardId = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 0, bashCardId, { unitId: 'bash-user', direction: 0 }))
  assert.ok(planOrder(state, 1, moveCardId, { unitId: 'bash-target', direction: 0, distance: 1 }))

  state.activePlayer = 1
  readyAndResolve(state)

  const targetAfter = state.units['bash-target']
  assert.ok(targetAfter)
  assert.equal(targetAfter.strength, 2)
  assert.deepEqual(targetAfter.pos, { q: 3, r: 2 })
  assert.ok(state.log.some((entry) => entry === 'Unit bash-target is stunned and cannot act this turn.'))
})

test('shrug off removes debuffs and prevents damage and new debuffs this turn', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_shrug_off'),
    p2: Array.from({ length: settings.deckSize }, () => 'attack_bleed'),
  })

  clearNonLeaderUnits(state)
  state.units['shrug-target'] = {
    id: 'shrug-target',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [
      { type: 'cannotMove', turnsRemaining: 2 },
      { type: 'burn', turnsRemaining: 'indefinite' },
    ],
  }
  state.units['shrug-attacker'] = {
    id: 'shrug-attacker',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const shrugCardId = findCardId(state, 0, 'reinforce_shrug_off')
  const bleedCardId = findCardId(state, 1, 'attack_bleed')
  assert.ok(planOrder(state, 0, shrugCardId, { unitId: 'shrug-target' }))
  assert.ok(planOrder(state, 1, bleedCardId, { unitId: 'shrug-attacker', direction: 0 }))
  readyAndResolve(state)

  const targetAfter = state.units['shrug-target']
  assert.ok(targetAfter)
  assert.equal(targetAfter.strength, 5)
  assert.deepEqual(targetAfter.modifiers, [])
  assert.ok(state.log.some((entry) => entry === 'Unit shrug-target is protected by Undying.'))
})

test('spikes reflects damage back to the attacker for 2 turns', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'reinforce_spikes'),
    p2: Array.from({ length: settings.deckSize }, () => 'attack_bleed'),
  })

  clearNonLeaderUnits(state)
  state.units['spike-target'] = {
    id: 'spike-target',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['spike-attacker'] = {
    id: 'spike-attacker',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const spikesCardId = findCardId(state, 0, 'reinforce_spikes')
  const bleedCardId = findCardId(state, 1, 'attack_bleed')
  assert.ok(planOrder(state, 0, spikesCardId, { unitId: 'spike-target' }))
  assert.ok(planOrder(state, 1, bleedCardId, { unitId: 'spike-attacker', direction: 0 }))
  readyAndResolve(state)

  const targetAfter = state.units['spike-target']
  const attackerAfter = state.units['spike-attacker']
  assert.ok(targetAfter)
  assert.ok(attackerAfter)
  assert.equal(targetAfter.strength, 4)
  assert.equal(attackerAfter.strength, 3)
  assert.ok(targetAfter.modifiers.some((modifier) => modifier.type === 'spikes' && modifier.turnsRemaining === 1))
  assert.ok(state.log.some((entry) => entry === 'Spikes reflect 1 damage to unit spike-attacker.'))
})

test('berserk grants strong for the turn and destroys the unit at turn end', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: ['reinforce_berserk', 'attack_jab', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['berserk-user'] = {
    id: 'berserk-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['berserk-target'] = {
    id: 'berserk-target',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const berserkCardId = findCardId(state, 0, 'reinforce_berserk')
  const jabCardId = findCardId(state, 0, 'attack_jab')
  assert.ok(planOrder(state, 0, berserkCardId, { unitId: 'berserk-user' }))
  assert.ok(planOrder(state, 0, jabCardId, { unitId: 'berserk-user', direction: 0 }))
  readyAndResolve(state)

  assert.equal(state.units['berserk-user'], undefined)
  assert.equal(state.units['berserk-target']?.strength, 2)
})

test('roundhouse kick pushes the target back up to 3 tiles before dealing damage', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_roundhouse_kick'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['roundhouse-user'] = {
    id: 'roundhouse-user',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['roundhouse-target'] = {
    id: 'roundhouse-target',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_roundhouse_kick')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'roundhouse-user', direction: 0 }))
  readyAndResolve(state)

  const targetAfter = state.units['roundhouse-target']
  assert.ok(targetAfter)
  assert.equal(targetAfter.strength, 2)
  assert.deepEqual(targetAfter.pos, { q: 5, r: 2 })
})

test('roundhouse kick still pushes before lethal damage is applied', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_roundhouse_kick'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['roundhouse-user'] = {
    id: 'roundhouse-user',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['roundhouse-target'] = {
    id: 'roundhouse-target',
    owner: 1,
    kind: 'unit',
    strength: 2,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_roundhouse_kick')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'roundhouse-user', direction: 0 }))
  readyAndResolve(state)

  assert.equal(state.units['roundhouse-target'], undefined)
  const pushLogIndex = state.log.findIndex((entry) => entry === 'Unit roundhouse-target is pushed to 5,2.')
  const destroyedLogIndex = state.log.findIndex((entry) => entry === 'Unit roundhouse-target is destroyed.')
  assert.notEqual(pushLogIndex, -1)
  assert.notEqual(destroyedLogIndex, -1)
  assert.ok(pushLogIndex < destroyedLogIndex)
})

test('roundhouse kick deals collision damage after a partial push into a blocker', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_roundhouse_kick'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['roundhouse-user'] = {
    id: 'roundhouse-user',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: { q: 0, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['roundhouse-target'] = {
    id: 'roundhouse-target',
    owner: 1,
    kind: 'unit',
    strength: 8,
    pos: { q: 1, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['roundhouse-blocker'] = {
    id: 'roundhouse-blocker',
    owner: 1,
    kind: 'unit',
    strength: 7,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_roundhouse_kick')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'roundhouse-user', direction: 0 }))
  readyAndResolve(state)

  const targetAfter = state.units['roundhouse-target']
  const blockerAfter = state.units['roundhouse-blocker']
  assert.ok(targetAfter)
  assert.ok(blockerAfter)
  assert.equal(targetAfter.strength, 3)
  assert.equal(blockerAfter.strength, 4)
  assert.deepEqual(targetAfter.pos, { q: 3, r: 2 })
  assert.deepEqual(blockerAfter.pos, { q: 4, r: 2 })
})

test('dash moves forward up to 2 tiles and costs 0 AP', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6, actionBudgetP1: 0 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_dash'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['dash-user'] = {
    id: 'dash-user',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'move_dash')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'dash-user', distance: 2 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['dash-user']?.pos, { q: 3, r: 2 })
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

test('pivot now resolves with priority', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: ['move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
    p2: ['move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
  })

  const p1Unit = Object.values(state.units).find((unit) => unit.owner === 0 && unit.kind === 'unit')
  const p2Unit = Object.values(state.units).find((unit) => unit.owner === 1 && unit.kind === 'unit')
  assert.ok(p1Unit)
  assert.ok(p2Unit)

  const pivotId = findCardId(state, 0, 'move_pivot')
  const moveId = findCardId(state, 1, 'move_any')
  assert.ok(planOrder(state, 0, pivotId, { unitId: p1Unit.id, direction: 1 }))
  assert.ok(planOrder(state, 1, moveId, { unitId: p2Unit.id, direction: 3, distance: 1 }))

  state.activePlayer = 1
  state.ready = [true, true]
  startActionPhase(state)

  assert.deepEqual(
    state.actionQueue.map((order) => `${order.player}:${order.defId}`),
    ['0:move_pivot', '1:move_any']
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
  const leader = state.units['leader-1']
  assert.ok(leader && leader.kind === 'leader')
  leader.pos = { q: 3, r: 2 }
  const startStrength = leader.strength

  const cardId = findCardId(state, 0, 'attack_execute')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'exec-user' }))
  readyAndResolve(state)

  const leaderAfter = state.units['leader-1']
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
  const enemyLeader = state.units['leader-1']
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

  state.units['ww-actor-leader'] = {
    id: 'ww-actor-leader',
    owner: 0,
    kind: 'unit',
    strength: 5,
    pos: setup.actorTile,
    facing: 0,
    modifiers: [],
  }

  const cardId = findCardId(state, 0, 'attack_whirlwind')
  const planned = planOrder(state, 0, cardId, { unitId: 'ww-actor-leader' })
  assert.ok(planned)

  readyAndResolve(state)

  const leaderAfter = state.units['leader-1']
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
  assert.ok(state.units['leader-1'])
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
    assert.equal(child.strength, 3 + Math.floor(matchNumber / 4))
  })
  assert.equal(
    state.log.filter((entry) => entry.startsWith('Slime split: slime-grand lobs from ')).length,
    2
  )
  assert.equal(state.winner, null)
})

test('slime split spawn tiles stay deterministic across repeated identical resolutions', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'slimes' as const,
    roguelikeMatchNumber: 9,
  }
  const baseState = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_execute'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(baseState)
  baseState.units['split-user'] = {
    id: 'split-user',
    owner: 0,
    kind: 'unit',
    strength: 6,
    pos: { q: 2, r: 3 },
    facing: 0,
    modifiers: [],
  }
  baseState.units['slime-grand'] = {
    id: 'slime-grand',
    owner: 1,
    kind: 'unit',
    strength: 1,
    pos: { q: 3, r: 3 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'slime_grand',
  }

  const outcomes = new Set<string>()
  for (let i = 0; i < 10; i += 1) {
    const state = JSON.parse(JSON.stringify(baseState)) as GameState
    const cardId = findCardId(state, 0, 'attack_execute')
    assert.ok(planOrder(state, 0, cardId, { unitId: 'split-user' }))
    readyAndResolve(state)

    const childTiles = Object.values(state.units)
      .filter((unit) => unit.owner === 1 && unit.roguelikeRole === 'slime_mid')
      .map((unit) => `${unit.pos.q},${unit.pos.r}`)
      .sort()
    assert.equal(childTiles.length, 2)
    outcomes.add(childTiles.join('|'))
  }

  assert.equal(outcomes.size, 1)
})

test('multiple slimes killed by the same attack all split before elimination victory is checked', () => {
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
    p1: Array.from({ length: settings.deckSize }, () => 'attack_whirlwind'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['whirl-user'] = {
    id: 'whirl-user',
    owner: 0,
    kind: 'unit',
    strength: 6,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['slime-a'] = {
    id: 'slime-a',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'slime_mid',
  }
  state.units['slime-b'] = {
    id: 'slime-b',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 2, r: 1 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'slime_mid',
  }

  const cardId = findCardId(state, 0, 'attack_whirlwind')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'whirl-user' }))
  readyAndResolve(state)

  const children = Object.values(state.units).filter((unit) => unit.owner === 1 && unit.roguelikeRole === 'slime_small')
  assert.equal(children.length, 4)
  assert.equal(state.winner, null)
})

test('roguelike elimination victory ignores enemy minions', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'necromancer' as const,
    roguelikeMatchNumber: 6,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['hero'] = {
    id: 'hero',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 4 },
    facing: 0,
    modifiers: [],
  }
  state.units['only-minion'] = {
    id: 'only-minion',
    owner: 1,
    kind: 'unit',
    strength: 2,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'skeleton_soldier',
    isMinion: true,
  }

  const cardId = findCardId(state, 0, 'move_pivot')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'hero', direction: 1 }))
  readyAndResolve(state)

  assert.equal(state.winner, 0)
  assert.ok(state.units['only-minion'])
  assert.ok(state.log.some((entry) => entry === 'Player 1 wins by eliminating all enemy units.'))
})

test('roguelike split keeps the original unit as the objective target and marks the clone as a minion', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'fire_spirits' as const,
    roguelikeMatchNumber: 6,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'reinforce_roguelike_split'),
  })

  clearNonLeaderUnits(state)
  state.units['fire-spirit'] = {
    id: 'fire-spirit',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'fire_spirit',
  }

  const cardId = findCardId(state, 1, 'reinforce_roguelike_split')
  assert.ok(planOrder(state, 1, cardId, { unitId: 'fire-spirit' }))
  readyAndResolve(state)

  const spirits = Object.values(state.units).filter((unit) => unit.owner === 1 && unit.roguelikeRole === 'fire_spirit')
  assert.equal(spirits.length, 2)
  assert.equal(spirits.filter((unit) => unit.isMinion).length, 1)
  assert.equal(spirits.filter((unit) => !unit.isMinion).length, 1)
  spirits.forEach((unit) => {
    assert.equal(unit.strength, 2)
  })
  assert.equal(state.winner, null)
})

test('ice spirits chill player units and freeze ones that are already slowed', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'ice_spirits' as const,
    roguelikeMatchNumber: 6,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_forward'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['ice-hero'] = {
    id: 'ice-hero',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 3 },
    facing: 0,
    modifiers: [{ type: 'slow', turnsRemaining: 2 }],
  }
  state.units['ice-spirit'] = {
    id: 'ice-spirit',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 4, r: 1 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'ice_spirit',
  }

  const cardId = findCardId(state, 0, 'move_forward')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'ice-hero', direction: 0, distance: 1 }))
  readyAndResolve(state)

  assert.deepEqual(state.units['ice-hero']?.pos, { q: 2, r: 3 })
  assert.ok(state.units['ice-hero']?.modifiers.some((modifier) => modifier.type === 'chilled'))
  assert.ok(state.units['ice-hero']?.modifiers.some((modifier) => modifier.type === 'frozen'))
  assert.ok(state.log.some((entry) => entry === 'Unit ice-hero cannot move this turn.'))
})

test('fire spirit attacks inflict burn through scalding', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'fire_spirits' as const,
    roguelikeMatchNumber: 6,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'attack_roguelike_basic'),
  })

  clearNonLeaderUnits(state)
  state.units['fire-spirit'] = {
    id: 'fire-spirit',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'fire_spirit',
  }
  state.units['burn-target'] = {
    id: 'burn-target',
    owner: 0,
    kind: 'unit',
    strength: 6,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 1, 'attack_roguelike_basic')
  assert.ok(planOrder(state, 1, cardId, { unitId: 'fire-spirit', direction: 0 }))
  readyAndResolve(state)

  assert.ok(state.units['burn-target']?.modifiers.some((modifier) => modifier.type === 'burn'))
})

test('lightning spirits are immune to friendly chain lightning damage but still conduct it', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'lightning_spirits' as const,
    roguelikeMatchNumber: 6,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'attack_chain_lightning'),
  })

  clearNonLeaderUnits(state)
  state.units['storm-origin'] = {
    id: 'storm-origin',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'lightning_spirit',
  }
  state.units['storm-conductor'] = {
    id: 'storm-conductor',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'lightning_spirit',
  }
  state.units['storm-target'] = {
    id: 'storm-target',
    owner: 0,
    kind: 'unit',
    strength: 6,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 1, 'attack_chain_lightning')
  assert.ok(planOrder(state, 1, cardId, { unitId: 'storm-origin' }))
  readyAndResolve(state)

  assert.equal(state.units['storm-conductor']?.strength, 4)
  assert.equal(state.units['storm-target']?.strength, 2)
})

test('killing the necromancer wins even if skeleton minions remain', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'necromancer' as const,
    roguelikeMatchNumber: 6,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'attack_execute'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['necro-hunter'] = {
    id: 'necro-hunter',
    owner: 0,
    kind: 'unit',
    strength: 6,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['boss-necro'] = {
    id: 'boss-necro',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'necromancer',
  }
  state.units['leftover-skeleton'] = {
    id: 'leftover-skeleton',
    owner: 1,
    kind: 'unit',
    strength: 2,
    pos: { q: 4, r: 1 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'skeleton_soldier',
    isMinion: true,
  }

  const cardId = findCardId(state, 0, 'attack_execute')
  assert.ok(planOrder(state, 0, cardId, { unitId: 'necro-hunter' }))
  readyAndResolve(state)

  assert.equal(state.winner, 0)
  assert.ok(state.units['leftover-skeleton'])
  assert.equal(state.units['boss-necro'], undefined)
})

test('necromancer raises a matching skeleton when a player unit is killed', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    victoryCondition: 'eliminate_units' as const,
    roguelikeEncounterId: 'necromancer' as const,
    roguelikeMatchNumber: 6,
  }
  const state = createGameState(
    settings,
    {
      p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
      p2: Array.from({ length: settings.deckSize }, () => 'attack_execute'),
    },
    { p1: 'archmage', p2: null }
  )

  clearNonLeaderUnits(state)
  state.units['fallen-mage'] = {
    id: 'fallen-mage',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['boss-necro'] = {
    id: 'boss-necro',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'necromancer',
  }
  state.units['escort-skeleton'] = {
    id: 'escort-skeleton',
    owner: 1,
    kind: 'unit',
    strength: 2,
    pos: { q: 4, r: 1 },
    facing: 3,
    modifiers: [],
    roguelikeRole: 'skeleton_soldier',
    isMinion: true,
  }

  const cardId = findCardId(state, 1, 'attack_execute')
  assert.ok(planOrder(state, 1, cardId, { unitId: 'boss-necro' }))
  readyAndResolve(state)

  const raisedSkeleton = Object.values(state.units).find(
    (unit) => unit.owner === 1 && unit.pos.q === 3 && unit.pos.r === 2 && unit.roguelikeRole === 'skeleton_mage'
  )
  assert.ok(raisedSkeleton)
  assert.equal(raisedSkeleton.isMinion, true)
  assert.ok(state.log.some((entry) => entry === `Necromancy raises ${raisedSkeleton.id} from fallen-mage's remains.`))
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
    roguelikeEncounterId: 'wolf_pack' as const,
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
  assert.equal(state.units['pack-prey']?.strength, 11)
})

test('pack hunt can only be planned by alpha wolves', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'attack_roguelike_pack_hunt'),
  })

  clearNonLeaderUnits(state)
  state.units['alpha'] = {
    id: 'alpha',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'alpha_wolf',
  }
  state.units['wolf'] = {
    id: 'wolf',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'wolf',
  }

  const cardId = findCardId(state, 1, 'attack_roguelike_pack_hunt')
  assert.ok(planOrder(state, 1, cardId, { unitId: 'alpha', direction: 0 }))
  assert.equal(planOrder(state, 1, cardId, { unitId: 'wolf', direction: 0 }), null)
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

test('mark resolves movement simultaneously so trailing allies can move into vacated tiles', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'spell_roguelike_mark'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
  })

  clearNonLeaderUnits(state)
  state.units['mark-back'] = {
    id: 'mark-back',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['mark-front'] = {
    id: 'mark-front',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
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
  assert.ok(planOrder(state, 0, cardId, { unitId: 'mark-target' }))
  readyAndResolve(state)

  assert.deepEqual(state.units['mark-back']?.pos, { q: 2, r: 2 })
  assert.deepEqual(state.units['mark-front']?.pos, { q: 3, r: 2 })
})

test('monster roguelike basic attack uses the global roguelike damage modifier', () => {
  const matchNumber = 11
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    roguelikeEncounterId: 'slimes' as const,
    roguelikeMatchNumber: matchNumber,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'attack_roguelike_basic'),
  })

  clearNonLeaderUnits(state)
  state.units['scaled-user'] = {
    id: 'scaled-user',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'slime_small',
  }
  state.units['scaled-target'] = {
    id: 'scaled-target',
    owner: 0,
    kind: 'unit',
    strength: 7,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 1, 'attack_roguelike_basic')
  assert.ok(planOrder(state, 1, cardId, { unitId: 'scaled-user', direction: 0 }))
  readyAndResolve(state)

  assert.equal(state.units['scaled-target']?.strength, 5)
})

test('monster-owned non-roguelike damage cards also use the roguelike damage modifier', () => {
  const matchNumber = 10
  const settings = {
    ...DEFAULT_SETTINGS,
    deckSize: 6,
    drawPerTurn: 6,
    roguelikeEncounterId: 'fire_spirits' as const,
    roguelikeMatchNumber: matchNumber,
  }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'attack_fireball'),
  })

  clearNonLeaderUnits(state)
  state.units['fire-caster'] = {
    id: 'fire-caster',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'fire_spirit',
  }
  state.units['fire-target'] = {
    id: 'fire-target',
    owner: 0,
    kind: 'unit',
    strength: 8,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }

  const cardId = findCardId(state, 1, 'attack_fireball')
  assert.ok(planOrder(state, 1, cardId, { unitId: 'fire-caster', direction: 0 }))
  readyAndResolve(state)

  assert.equal(state.units['fire-target']?.strength, 3)
})
