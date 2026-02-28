import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_DEFS } from '../../src/engine/cards'
import { buildBotPlan } from '../../src/engine/bot'
import { createGameState, planOrder } from '../../src/engine/game'
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

test('bot avoids spending AP on no-impact orders', () => {
  const state = setupBotPlanningState()
  state.actionBudgets = [3, 3]
  state.players[1].hand = [{ id: 'bot-invest', defId: 'spell_invest' }]
  state.players[1].orders = []

  const result = buildBotPlan(state, 1, { thinkTimeMs: 200 })
  assert.equal(result.orders.length, 0)
})
