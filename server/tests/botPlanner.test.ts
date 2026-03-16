import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_DEFS } from '../../src/engine/cards'
import { BOT_HEURISTICS, buildBotPlan, resolveBotPlannerConfig } from '../../src/engine/bot'
import { DEFAULT_SETTINGS, createGameState, getSpawnTiles, planOrder } from '../../src/engine/game'
import { neighbor } from '../../src/engine/hex'
import type { GameState } from '../../src/engine/types'

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function setupBotPlanningState(): GameState {
  const state = createGameState()
  state.phase = 'planning'
  state.winner = null
  state.ready = [false, false]
  state.players[0].orders = []
  state.players[1].orders = []
  state.players[1].deck = []
  state.players[1].discard = []
  return state
}

function clearNonLeaderUnits(state: GameState): void {
  Object.keys(state.units).forEach((unitId) => {
    if (!unitId.startsWith('leader-')) {
      delete state.units[unitId]
    }
  })
}

function countApUsed(state: GameState, player: 0 | 1): number {
  return state.players[player].orders.reduce((sum, order) => sum + (CARD_DEFS[order.defId].actionCost ?? 1), 0)
}

function serializePlan(plan: ReturnType<typeof buildBotPlan>['orders']): string {
  return plan
    .map((order) => `${order.cardId}:${JSON.stringify(order.params)}`)
    .join('|')
}

test('bot planner returns legal orders and stays within AP budget', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 3]
  state.players[1].hand = [
    { id: 'bot-lightning', defId: 'spell_lightning' },
    { id: 'bot-pivot', defId: 'move_pivot' },
    { id: 'bot-move', defId: 'move_any' },
  ]

  const result = buildBotPlan(state, 1)
  const replay = cloneState(state)
  result.orders.forEach((planned) => {
    const queued = planOrder(replay, 1, planned.cardId, planned.params)
    assert.ok(queued, `bot planned illegal order for card ${planned.cardId}`)
  })

  const apUsed = countApUsed(replay, 1)
  assert.ok(apUsed <= replay.actionBudgets[1], `bot exceeded AP budget (${apUsed} > ${replay.actionBudgets[1]})`)
})

test('bot planner with tiny budget returns quickly and still plans legally', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 3]
  state.players[1].hand = [
    { id: 'bot-lightning', defId: 'spell_lightning' },
    { id: 'bot-pivot', defId: 'move_pivot' },
    { id: 'bot-move', defId: 'move_any' },
  ]

  const result = buildBotPlan(state, 1, { thinkTimeMs: 1 })
  assert.ok(result.elapsedMs >= 0)
  assert.ok(result.elapsedMs < 500)

  const replay = cloneState(state)
  result.orders.forEach((planned) => {
    const queued = planOrder(replay, 1, planned.cardId, planned.params)
    assert.ok(queued)
  })
})

test('bot prefers a finishing damage play when available', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [
    { id: 'bot-lightning', defId: 'spell_lightning' },
    { id: 'bot-pivot', defId: 'move_pivot' },
  ]

  const enemyFrontline = Object.values(state.units).find((unit) => unit.owner === 0 && unit.kind === 'unit')
  assert.ok(enemyFrontline)
  if (enemyFrontline) {
    enemyFrontline.strength = 1
  }

  const result = buildBotPlan(state, 1)
  const plannedIds = new Set(result.orders.map((order) => order.cardId))
  assert.ok(plannedIds.has('bot-lightning'), 'expected bot to include a lethal lightning play')
})

test('bot planning is fair and ignores hidden opponent planning info', () => {
  const base = setupBotPlanningState()
  base.actionBudgets = [3, 2]
  base.players[1].hand = [
    { id: 'bot-lightning', defId: 'spell_lightning' },
    { id: 'bot-pivot', defId: 'move_pivot' },
  ]

  const withHiddenOrders = cloneState(base)
  withHiddenOrders.players[0].hand = [{ id: 'human-secret-a', defId: 'spell_meteor' }]
  withHiddenOrders.players[0].orders = [
    {
      id: 'hidden-order-a',
      player: 0,
      cardId: 'human-secret-a',
      defId: 'spell_meteor',
      params: { tile: { q: 1, r: 1 } },
    },
  ]

  const withDifferentHiddenOrders = cloneState(base)
  withDifferentHiddenOrders.players[0].hand = [{ id: 'human-secret-b', defId: 'attack_fwd' }]
  withDifferentHiddenOrders.players[0].orders = [
    {
      id: 'hidden-order-b',
      player: 0,
      cardId: 'human-secret-b',
      defId: 'attack_fwd',
      params: { unitId: 'u0-1', direction: 3 },
    },
  ]

  const resultA = buildBotPlan(withHiddenOrders, 1, { thinkTimeMs: 200 })
  const resultB = buildBotPlan(withDifferentHiddenOrders, 1, { thinkTimeMs: 200 })
  assert.equal(serializePlan(resultA.orders), serializePlan(resultB.orders))
})

test('bot planning ignores hidden opponent traps', () => {
  const base = setupBotPlanningState()
  base.actionBudgets = [3, 2]
  base.players[1].hand = [
    { id: 'bot-move1', defId: 'move_any' },
    { id: 'bot-move2', defId: 'move_forward' },
  ]

  const withoutHiddenTrap = cloneState(base)
  const withHiddenTrap = cloneState(base)
  withHiddenTrap.traps = [
    {
      id: 'hidden-pitfall',
      owner: 0,
      kind: 'pitfall',
      pos: { q: 3, r: 2 },
    },
  ]

  const resultA = buildBotPlan(withoutHiddenTrap, 1, { thinkTimeMs: 400 })
  const resultB = buildBotPlan(withHiddenTrap, 1, { thinkTimeMs: 400 })
  assert.equal(serializePlan(resultA.orders), serializePlan(resultB.orders))
})

test('bot avoids spawning onto its own visible trap', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-spawn', defId: 'reinforce_spawn' }]

  const trappedSpawnTile = getSpawnTiles(state, 1)[0]
  assert.ok(trappedSpawnTile)
  state.traps = [
    {
      id: 'bot-own-trap',
      owner: 1,
      kind: 'pitfall',
      pos: { ...trappedSpawnTile },
    },
  ]

  const result = buildBotPlan(state, 1, { thinkTimeMs: 200 })
  assert.equal(result.orders.length, 1)
  assert.equal(result.orders[0]?.cardId, 'bot-spawn')
  assert.notDeepEqual(result.orders[0]?.params.tile, trappedSpawnTile)
})

test('bot avoids movement paths that step onto its own trap', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-move', defId: 'move_any' }]

  clearNonLeaderUnits(state)
  state.units['bot-runner'] = {
    id: 'bot-runner',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['enemy-front'] = {
    id: 'enemy-front',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 4, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.traps = [
    {
      id: 'bot-own-trap',
      owner: 1,
      kind: 'pitfall',
      pos: { q: 2, r: 2 },
    },
  ]

  const result = buildBotPlan(state, 1, { thinkTimeMs: 250 })
  assert.equal(result.orders.length, 1)
  assert.equal(result.orders[0]?.cardId, 'bot-move')
  assert.notEqual(result.orders[0]?.params.direction, 0)
})

test('bot avoids spending AP on no-impact orders', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 3]
  state.players[1].hand = [{ id: 'bot-invest', defId: 'spell_invest' }]
  state.players[1].orders = []

  const result = buildBotPlan(state, 1, { thinkTimeMs: 200 })
  assert.equal(result.orders.length, 0)
})

test('bot can skip low-opportunity chain lightning', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-chain-low', defId: 'attack_chain_lightning' }]
  clearNonLeaderUnits(state)
  state.units['bot-caster-low'] = {
    id: 'bot-caster-low',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['enemy-durable-low'] = {
    id: 'enemy-durable-low',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, { thinkTimeMs: 250 })
  assert.equal(result.orders.length, 0)
})

test('bot planner resolves nested heuristic overrides without mutating defaults', () => {
  const resolved = resolveBotPlannerConfig({
    thinkTimeMs: 999,
    beamWidth: 0,
    maxCandidatesPerCard: 999,
    heuristics: {
      scoring: {
        pressureDeltaWeight: 17,
      },
      chainLightning: {
        basePlayChance: 2,
        guaranteedReachableTargets: 0,
      },
      history: {
        priors: {
          spell_meteor: 0.4,
        },
      },
      timing: {
        priorityRiskScale: -1,
      },
    },
  })

  assert.equal(resolved.thinkTimeMs, 500)
  assert.equal(resolved.beamWidth, 1)
  assert.equal(resolved.maxCandidatesPerCard, 40)
  assert.equal(resolved.heuristics.scoring.pressureDeltaWeight, 17)
  assert.equal(resolved.heuristics.scoring.unitStrengthDeltaWeight, BOT_HEURISTICS.scoring.unitStrengthDeltaWeight)
  assert.equal(resolved.heuristics.chainLightning.basePlayChance, 1)
  assert.equal(resolved.heuristics.chainLightning.guaranteedReachableTargets, 1)
  assert.equal(resolved.heuristics.history.priors.spell_meteor, 0.4)
  assert.equal(resolved.heuristics.history.priors.attack_arrow, BOT_HEURISTICS.history.priors.attack_arrow)
  assert.equal(resolved.heuristics.timing.priorityRiskScale, 0)
  assert.equal(BOT_HEURISTICS.chainLightning.basePlayChance, 0.22)
})

test('bot heuristics override can force low-opportunity chain lightning evaluation upward', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-chain-low', defId: 'attack_chain_lightning' }]
  clearNonLeaderUnits(state)
  state.units['bot-caster-low'] = {
    id: 'bot-caster-low',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['enemy-durable-low'] = {
    id: 'enemy-durable-low',
    owner: 0,
    kind: 'unit',
    strength: 4,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, {
    thinkTimeMs: 250,
    heuristics: {
      scoring: {
        chainLightningOpportunityWeight: 60,
      },
      chainLightning: {
        basePlayChance: 1,
        minPlayChance: 1,
        maxPlayChance: 1,
        isolatedDurableChanceScale: 1,
      },
    },
  })

  assert.deepEqual(result.orders.map((order) => order.cardId), ['bot-chain-low'])
})

test('bot uses chain lightning when clustered 2-hp targets make it high value', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-chain-high', defId: 'attack_chain_lightning' }]
  clearNonLeaderUnits(state)
  state.units['bot-caster-high'] = {
    id: 'bot-caster-high',
    owner: 1,
    kind: 'unit',
    strength: 4,
    pos: { q: 2, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['enemy-fragile-a'] = {
    id: 'enemy-fragile-a',
    owner: 0,
    kind: 'unit',
    strength: 2,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['enemy-fragile-b'] = {
    id: 'enemy-fragile-b',
    owner: 0,
    kind: 'unit',
    strength: 2,
    pos: { q: 3, r: 1 },
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, { thinkTimeMs: 250 })
  assert.deepEqual(result.orders.map((order) => order.cardId), ['bot-chain-high'])
})

test('bot advances toward enemy units in eliminate-units mode', () => {
  const settings = { ...DEFAULT_SETTINGS, victoryCondition: 'eliminate_units' as const, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_any'),
  })

  state.phase = 'planning'
  state.winner = null
  state.ready = [false, false]
  state.players[0].orders = []
  state.players[1].orders = []
  state.players[1].deck = []
  state.players[1].discard = []
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-move', defId: 'move_any' }]

  clearNonLeaderUnits(state)
  state.units['bot-runner'] = {
    id: 'bot-runner',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['enemy-front'] = {
    id: 'enemy-front',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 4, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, { thinkTimeMs: 300 })
  assert.equal(result.orders.length, 1)
  assert.equal(result.orders[0]?.cardId, 'bot-move')
  assert.equal(state.units[result.orders[0]?.params.unitId ?? '']?.owner, 1)
  assert.equal(result.orders[0]?.params.direction, 0)
})

test('bot prefers immediate attack over movement in eliminate-units mode', () => {
  const settings = { ...DEFAULT_SETTINGS, victoryCondition: 'eliminate_units' as const, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: ['attack_jab', 'move_any', 'move_pivot', 'move_pivot', 'move_pivot', 'move_pivot'],
  })

  state.phase = 'planning'
  state.winner = null
  state.ready = [false, false]
  state.players[0].orders = []
  state.players[1].orders = []
  state.players[1].deck = []
  state.players[1].discard = []
  state.actionBudgets = [3, 1]
  state.players[1].hand = [
    { id: 'bot-attack', defId: 'attack_jab' },
    { id: 'bot-move', defId: 'move_any' },
  ]

  clearNonLeaderUnits(state)
  state.units['bot-attacker'] = {
    id: 'bot-attacker',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['enemy-target'] = {
    id: 'enemy-target',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 4, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, { thinkTimeMs: 300 })
  assert.equal(result.orders.length, 1)
  assert.equal(result.orders[0]?.cardId, 'bot-attack')
  assert.equal(result.orders[0]?.params.unitId, 'bot-attacker')
  assert.equal(result.orders[0]?.params.direction, 0)
})

test('bot points directional attacks at an enemy when one is available', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-jab', defId: 'attack_jab' }]

  clearNonLeaderUnits(state)
  state.units['bot-attacker'] = {
    id: 'bot-attacker',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
  }
  state.units['enemy-target'] = {
    id: 'enemy-target',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, { thinkTimeMs: 200 })
  assert.equal(result.orders.length, 1)
  assert.equal(result.orders[0]?.cardId, 'bot-jab')
  assert.equal(result.orders[0]?.params.unitId, 'bot-attacker')
  assert.equal(result.orders[0]?.params.direction, 3)
})

test('bot advances toward enemy units in standard mode when the board is sparse', () => {
  const settings = { ...DEFAULT_SETTINGS, deckSize: 6, drawPerTurn: 6 }
  const state = createGameState(settings, {
    p1: Array.from({ length: settings.deckSize }, () => 'move_pivot'),
    p2: Array.from({ length: settings.deckSize }, () => 'move_any'),
  })

  state.phase = 'planning'
  state.winner = null
  state.ready = [false, false]
  state.players[0].orders = []
  state.players[1].orders = []
  state.players[1].deck = []
  state.players[1].discard = []
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-move', defId: 'move_any' }]

  clearNonLeaderUnits(state)
  state.units['bot-runner'] = {
    id: 'bot-runner',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['enemy-front'] = {
    id: 'enemy-front',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 4, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, { thinkTimeMs: 300 })
  assert.equal(result.orders.length, 1)
  assert.equal(result.orders[0]?.cardId, 'bot-move')
  assert.equal(result.orders[0]?.params.direction, 0)
})

test('bot falls back to a meaningful order instead of returning an empty impactful hand', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-move', defId: 'move_any' }]

  clearNonLeaderUnits(state)
  state.units['bot-runner'] = {
    id: 'bot-runner',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 1, r: 2 },
    facing: 3,
    modifiers: [],
  }
  state.units['enemy-front'] = {
    id: 'enemy-front',
    owner: 0,
    kind: 'unit',
    strength: 3,
    pos: { q: 4, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, {
    thinkTimeMs: 200,
    heuristics: {
      scoring: {
        leaderStrengthDeltaWeight: 0,
        unitStrengthDeltaWeight: 0,
        unitCountDeltaWeight: 0,
        pressureDeltaWeight: 0,
        tacticalDeltaWeight: 0,
        opponentHistoryRiskWeight: 0,
        chainLightningOpportunityWeight: 0,
        queueTimingRiskWeight: -1000,
      },
    },
  })

  assert.equal(result.orders.length, 1)
  assert.equal(result.orders[0]?.cardId, 'bot-move')
})

test('slime bot prefers enemy target over adjacent ally for roguelike slow attack', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-slow', defId: 'attack_roguelike_slow' }]

  clearNonLeaderUnits(state)
  state.units['bot-slime'] = {
    id: 'bot-slime',
    owner: 1,
    kind: 'unit',
    strength: 6,
    pos: { q: 2, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'slime_grand',
  }
  state.units['ally-front'] = {
    id: 'ally-front',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: { q: 3, r: 2 },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'slime_mid',
  }
  state.units['enemy-back'] = {
    id: 'enemy-back',
    owner: 0,
    kind: 'unit',
    strength: 2,
    pos: { q: 1, r: 2 },
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, { thinkTimeMs: 300 })
  assert.equal(result.orders.length, 1)
  assert.equal(result.orders[0]?.cardId, 'bot-slow')
  assert.equal(result.orders[0]?.params.unitId, 'bot-slime')
  assert.equal(result.orders[0]?.params.direction, 3)
})

test('wolf bot avoids deliberate ally hit with alpha pack hunt', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 1]
  state.players[1].hand = [{ id: 'bot-pack', defId: 'attack_roguelike_pack_hunt' }]

  clearNonLeaderUnits(state)
  const allyTargetTile = { q: 3, r: 2 }
  state.units['bot-pack-hunter'] = {
    id: 'bot-pack-hunter',
    owner: 1,
    kind: 'unit',
    strength: 5,
    pos: neighbor(allyTargetTile, 3),
    facing: 0,
    modifiers: [],
    roguelikeRole: 'alpha_wolf',
  }
  state.units['ally-pack-target'] = {
    id: 'ally-pack-target',
    owner: 1,
    kind: 'unit',
    strength: 6,
    pos: { ...allyTargetTile },
    facing: 0,
    modifiers: [],
    roguelikeRole: 'wolf',
  }
  state.units['ally-pack-a'] = {
    id: 'ally-pack-a',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: neighbor(allyTargetTile, 1),
    facing: 0,
    modifiers: [],
  }
  state.units['ally-pack-b'] = {
    id: 'ally-pack-b',
    owner: 1,
    kind: 'unit',
    strength: 3,
    pos: neighbor(allyTargetTile, 5),
    facing: 0,
    modifiers: [],
  }

  const result = buildBotPlan(state, 1, { thinkTimeMs: 300 })
  if (result.orders.length === 0) {
    assert.equal(result.orders.length, 0)
    return
  }
  assert.equal(result.orders[0]?.cardId, 'bot-pack')
  assert.notEqual(result.orders[0]?.params.direction, 0)
})
