import { CARD_DEFS } from './cards'
import { getSpawnTiles, planOrder, simulatePlannedState } from './game'
import { neighbor, offsetToAxial } from './hex'
import type { CardDefId, Direction, GameState, Hex, Order, OrderParams, PlayerId, Unit } from './types'

export type BotPlannerOptions = {
  thinkTimeMs: number
  beamWidth: number
  maxCandidatesPerCard: number
}

export type BotPlannedOrder = {
  cardId: string
  params: OrderParams
}

export type BotPlanResult = {
  orders: BotPlannedOrder[]
  elapsedMs: number
}

type Candidate = {
  cardId: string
  params: OrderParams
  score: number
  signature: string
}

type BeamNode = {
  state: GameState
  score: number
  signature: string
}

type UnitRef = {
  refId: string
  snapshot: Unit
}

const DEFAULT_OPTIONS: BotPlannerOptions = {
  thinkTimeMs: 50,
  beamWidth: 10,
  maxCandidatesPerCard: 12,
}

export const BOT_HEURISTICS = {
  scoring: {
    winValue: 1_000_000,
    strongholdDeltaWeight: 500,
    unitStrengthDeltaWeight: 45,
    unitCountDeltaWeight: 22,
    pressureDeltaWeight: 8,
    tacticalDeltaWeight: 10,
    opponentHistoryRiskWeight: -14,
  },
  pressure: {
    distancePressureWindow: 10,
  },
  tactical: {
    adjacentEnemyWeight: 2,
    facingRayThreatWeight: 3,
  },
  history: {
    fragileUnitThreshold: 2,
    priors: {
      attack_arrow: 0.18,
      attack_line: 0.16,
      attack_fwd_lr: 0.16,
      spell_lightning: 0.12,
      spell_meteor: 0.08,
    },
    arrowStrongholdRayScale: 1.1,
    lineRayScale: 0.75,
    cleaveAdjacencyScale: 0.45,
    lightningFragileScale: 0.35,
    meteorClusterScale: 0.32,
    meteorStrongholdRayScale: 0.18,
  },
} as const

const DIRECTIONS: Direction[] = [0, 1, 2, 3, 4, 5]

export function buildBotPlan(
  inputState: GameState,
  player: PlayerId,
  options: Partial<BotPlannerOptions> = {}
): BotPlanResult {
  const opts = normalizeOptions(options)
  const start = nowMs()
  const deadline = start + opts.thinkTimeMs
  const evaluationCache = new Map<string, number>()

  const rootState = buildFairPlanningSnapshot(inputState, player)
  const depthLimit = Math.max(1, rootState.players[player].hand.length)
  const rootNode: BeamNode = {
    state: rootState,
    score: evaluatePlanningState(rootState, player, evaluationCache),
    signature: buildOrderSignature(rootState, player),
  }

  let bestNode = rootNode
  let beam: BeamNode[] = [rootNode]

  for (let depth = 0; depth < depthLimit; depth += 1) {
    if (nowMs() >= deadline) break
    const nextBeam: BeamNode[] = []
    for (const node of beam) {
      if (nowMs() >= deadline) break

      // Terminal "stop planning" option.
      if (isBetterTerminal(node, bestNode)) {
        bestNode = node
      }

      const candidates = generateRankedCandidates(node.state, player, opts, deadline, evaluationCache)
      for (const candidate of candidates) {
        if (nowMs() >= deadline) break
        const nextState = cloneGameState(node.state)
        const planned = planOrder(nextState, player, candidate.cardId, candidate.params)
        if (!planned) continue

        const score = evaluatePlanningState(nextState, player, evaluationCache)
        const signature = buildOrderSignature(nextState, player)
        const nextNode: BeamNode = { state: nextState, score, signature }
        nextBeam.push(nextNode)

        if (isBetterTerminal(nextNode, bestNode)) {
          bestNode = nextNode
        }
      }
    }

    if (nextBeam.length === 0) break
    beam = pruneBeam(nextBeam, opts.beamWidth)
  }

  const elapsedMs = nowMs() - start
  const orders = bestNode.state.players[player].orders.map((order) => ({
    cardId: order.cardId,
    params: cloneParams(order.params),
  }))

  return { orders, elapsedMs }
}

function normalizeOptions(input: Partial<BotPlannerOptions>): BotPlannerOptions {
  return {
    thinkTimeMs: clamp(Math.floor(input.thinkTimeMs ?? DEFAULT_OPTIONS.thinkTimeMs), 1, 500),
    beamWidth: clamp(Math.floor(input.beamWidth ?? DEFAULT_OPTIONS.beamWidth), 1, 32),
    maxCandidatesPerCard: clamp(
      Math.floor(input.maxCandidatesPerCard ?? DEFAULT_OPTIONS.maxCandidatesPerCard),
      1,
      40
    ),
  }
}

function generateRankedCandidates(
  state: GameState,
  player: PlayerId,
  options: BotPlannerOptions,
  deadline: number,
  evaluationCache: Map<string, number>
): Candidate[] {
  const playerHand = state.players[player].hand
  if (playerHand.length === 0) return []

  const projected = simulatePlannedState(state, player)
  const allCandidates: Candidate[] = []
  const maxTotal = Math.max(24, options.beamWidth * 5)

  for (const card of playerHand) {
    if (nowMs() >= deadline) break
    const paramsList = generateCardParams(state, projected, player, card.defId)
    if (paramsList.length === 0) continue

    const scored: Candidate[] = []
    const seen = new Set<string>()
    for (const params of paramsList) {
      if (nowMs() >= deadline) break
      const signature = `${card.id}|${serializeParams(params)}`
      if (seen.has(signature)) continue
      seen.add(signature)

      const nextState = cloneGameState(state)
      const planned = planOrder(nextState, player, card.id, params)
      if (!planned) continue

      scored.push({
        cardId: card.id,
        params: cloneParams(params),
        score: evaluatePlanningState(nextState, player, evaluationCache),
        signature,
      })
    }

    if (scored.length === 0) continue
    scored.sort(compareCandidateScore)
    allCandidates.push(...scored.slice(0, options.maxCandidatesPerCard))
  }

  if (allCandidates.length === 0) return []
  allCandidates.sort(compareCandidateScore)
  return allCandidates.slice(0, maxTotal)
}

function compareCandidateScore(a: Candidate, b: Candidate): number {
  if (b.score !== a.score) return b.score - a.score
  return a.signature.localeCompare(b.signature)
}

function generateCardParams(state: GameState, projected: GameState, player: PlayerId, defId: CardDefId): OrderParams[] {
  const def = CARD_DEFS[defId]
  if (def.type === 'reinforcement') {
    return generateReinforcementParams(state, projected, player, defId)
  }
  if (def.type === 'movement') {
    return generateMovementParams(state, projected, player, defId)
  }
  if (def.type === 'attack') {
    return generateAttackParams(state, projected, player, defId)
  }
  return generateSpellParams(state, projected, player, defId)
}

function generateReinforcementParams(state: GameState, projected: GameState, player: PlayerId, defId: CardDefId): OrderParams[] {
  if (defId === 'reinforce_spawn') {
    const params: OrderParams[] = []
    const spawnTiles = getSpawnTiles(projected, player).filter((tile) => getUnitAt(projected, tile) === null)
    for (const tile of spawnTiles) {
      for (const direction of DIRECTIONS) {
        params.push({ tile: { ...tile }, direction })
      }
    }
    return params
  }

  if (defId === 'reinforce_boost') {
    const refs = getFriendlyUnitRefs(state, projected, player)
    const params: OrderParams[] = []
    for (const first of refs) {
      params.push({ unitId: first.refId })
      for (const second of refs) {
        if (first.refId === second.refId) continue
        params.push({ unitId: first.refId, unitId2: second.refId })
      }
    }
    return params
  }

  if (defId === 'reinforce_boost_spawn') {
    const refs = getFriendlyUnitRefs(state, projected, player)
      .filter((ref) => isSpawnTile(projected, player, ref.snapshot.pos))
      .map((ref) => ref.refId)
    return refs.map((unitId) => ({ unitId }))
  }

  return [{}]
}

function generateMovementParams(state: GameState, projected: GameState, player: PlayerId, defId: CardDefId): OrderParams[] {
  const refs = getFriendlyUnitRefs(state, projected, player)
  if (refs.length === 0) return []

  if (defId === 'move_pivot') {
    const params: OrderParams[] = []
    refs.forEach((ref) => {
      DIRECTIONS.forEach((direction) => {
        if (direction === ref.snapshot.facing) return
        params.push({ unitId: ref.refId, direction })
      })
    })
    return params
  }

  if (defId === 'move_forward' || defId === 'move_any') {
    const distances = CARD_DEFS[defId].requires.distanceOptions ?? []
    const params: OrderParams[] = []
    refs.forEach((ref) => {
      DIRECTIONS.forEach((direction) => {
        distances.forEach((distance) => {
          const end = projectMoveEnd(projected, ref.snapshot, direction, distance)
          const moved = end.q !== ref.snapshot.pos.q || end.r !== ref.snapshot.pos.r
          if (!moved && direction === ref.snapshot.facing) return
          if (!moved && defId === 'move_any') return
          params.push({
            unitId: ref.refId,
            direction,
            distance,
          })
        })
      })
    })
    return params
  }

  if (defId === 'move_forward_face') {
    const params: OrderParams[] = []
    refs.forEach((ref) => {
      DIRECTIONS.forEach((moveDirection) => {
        const end = projectMoveEnd(projected, ref.snapshot, moveDirection, 1)
        const moved = end.q !== ref.snapshot.pos.q || end.r !== ref.snapshot.pos.r
        DIRECTIONS.forEach((faceDirection) => {
          if (!moved && faceDirection === ref.snapshot.facing) return
          params.push({
            unitId: ref.refId,
            moveDirection,
            faceDirection,
          })
        })
      })
    })
    return params
  }

  return []
}

function generateAttackParams(state: GameState, projected: GameState, player: PlayerId, defId: CardDefId): OrderParams[] {
  const refs = getFriendlyUnitRefs(state, projected, player)
  if (refs.length === 0) return []
  const params: OrderParams[] = []
  if (defId === 'attack_fwd') {
    refs.forEach((ref) => {
      DIRECTIONS.forEach((direction) => {
        params.push({ unitId: ref.refId, direction })
      })
    })
    return params
  }

  refs.forEach((ref) => {
    params.push({ unitId: ref.refId })
  })
  return params
}

function generateSpellParams(state: GameState, projected: GameState, player: PlayerId, defId: CardDefId): OrderParams[] {
  if (defId === 'spell_invest') return [{}]

  if (defId === 'spell_lightning') {
    const enemyUnits = Object.values(state.units).filter((unit) => unit.kind === 'unit' && unit.owner !== player)
    if (enemyUnits.length > 0) {
      return enemyUnits.map((unit) => ({ unitId: unit.id }))
    }
    const anyUnits = Object.values(state.units).filter((unit) => unit.kind === 'unit')
    return anyUnits.map((unit) => ({ unitId: unit.id }))
  }

  if (defId === 'spell_meteor') {
    const candidates = new Map<string, Hex>()
    const enemyUnits = Object.values(projected.units).filter((unit) => unit.kind === 'unit' && unit.owner !== player)
    enemyUnits.forEach((unit) => {
      addHexCandidate(candidates, unit.pos)
      DIRECTIONS.forEach((direction) => {
        addHexCandidate(candidates, neighbor(unit.pos, direction))
      })
    })

    if (candidates.size === 0) {
      const center = {
        q: Math.floor(projected.boardCols / 2),
        r: Math.floor(projected.boardRows / 2),
      }
      addHexCandidate(candidates, center)
      DIRECTIONS.forEach((direction) => addHexCandidate(candidates, neighbor(center, direction)))
    }

    return [...candidates.values()]
      .filter((hex) => inBounds(projected, hex))
      .filter((hex) => getUnitAt(projected, hex)?.kind !== 'stronghold')
      .map((tile) => ({ tile: { ...tile } }))
  }

  return [{}]
}

function addHexCandidate(map: Map<string, Hex>, hex: Hex): void {
  map.set(hexKey(hex), { ...hex })
}

function getFriendlyUnitRefs(state: GameState, projected: GameState, player: PlayerId): UnitRef[] {
  const refs: UnitRef[] = []

  Object.values(state.units)
    .filter((unit) => unit.owner === player && unit.kind === 'unit')
    .forEach((unit) => {
      const projectedUnit = projected.units[unit.id]
      if (!projectedUnit || projectedUnit.kind !== 'unit') return
      refs.push({ refId: unit.id, snapshot: projectedUnit })
    })

  state.players[player].orders.forEach((order) => {
    if (order.defId !== 'reinforce_spawn') return
    const refId = `planned:${order.id}`
    const resolvedId = projected.spawnedByOrder[order.id]
    if (!resolvedId) return
    const projectedUnit = projected.units[resolvedId]
    if (!projectedUnit || projectedUnit.kind !== 'unit') return
    refs.push({ refId, snapshot: projectedUnit })
  })

  return refs
}

function evaluatePlanningState(state: GameState, player: PlayerId, evaluationCache?: Map<string, number>): number {
  const cacheKey = `${player}|${state.turn}|${buildOrderSignature(state, player)}`
  const cached = evaluationCache?.get(cacheKey)
  if (cached !== undefined) return cached

  const projected = simulatePlannedState(state, player)
  const opponent: PlayerId = player === 0 ? 1 : 0
  if (projected.winner === player) {
    const winningScore = BOT_HEURISTICS.scoring.winValue + deterministicJitter(state, player)
    evaluationCache?.set(cacheKey, winningScore)
    return winningScore
  }
  if (projected.winner === opponent) {
    const losingScore = -BOT_HEURISTICS.scoring.winValue + deterministicJitter(state, player)
    evaluationCache?.set(cacheKey, losingScore)
    return losingScore
  }

  const ownStronghold = projected.units[`stronghold-${player}`]
  const enemyStronghold = projected.units[`stronghold-${opponent}`]
  const ownStrongholdStrength = ownStronghold?.strength ?? 0
  const enemyStrongholdStrength = enemyStronghold?.strength ?? 0

  const ownUnits = Object.values(projected.units).filter((unit) => unit.owner === player && unit.kind === 'unit')
  const enemyUnits = Object.values(projected.units).filter((unit) => unit.owner === opponent && unit.kind === 'unit')
  const ownStrength = ownUnits.reduce((sum, unit) => sum + unit.strength, 0)
  const enemyStrength = enemyUnits.reduce((sum, unit) => sum + unit.strength, 0)

  const strongholdDelta = ownStrongholdStrength - enemyStrongholdStrength
  const unitStrengthDelta = ownStrength - enemyStrength
  const unitCountDelta = ownUnits.length - enemyUnits.length
  const pressureDelta = computePressureDelta(projected, player, ownUnits, enemyUnits)
  const tacticalDelta = computeImmediateTacticalDelta(projected, player, ownUnits, enemyUnits)
  const opponentHistoryRisk = computeOpponentHistoryRisk(projected, player, ownUnits, enemyUnits)

  const score =
    strongholdDelta * BOT_HEURISTICS.scoring.strongholdDeltaWeight +
    unitStrengthDelta * BOT_HEURISTICS.scoring.unitStrengthDeltaWeight +
    unitCountDelta * BOT_HEURISTICS.scoring.unitCountDeltaWeight +
    pressureDelta * BOT_HEURISTICS.scoring.pressureDeltaWeight +
    tacticalDelta * BOT_HEURISTICS.scoring.tacticalDeltaWeight +
    opponentHistoryRisk * BOT_HEURISTICS.scoring.opponentHistoryRiskWeight +
    deterministicJitter(state, player)

  evaluationCache?.set(cacheKey, score)
  return score
}

function computePressureDelta(
  state: GameState,
  player: PlayerId,
  ownUnits: Unit[],
  enemyUnits: Unit[]
): number {
  const opponent: PlayerId = player === 0 ? 1 : 0
  const ownStronghold = state.units[`stronghold-${player}`]
  const enemyStronghold = state.units[`stronghold-${opponent}`]
  if (!ownStronghold || !enemyStronghold) return 0

  const ownPressure = ownUnits.reduce((sum, unit) => {
    const dist = hexDistance(unit.pos, enemyStronghold.pos)
    return sum + Math.max(0, BOT_HEURISTICS.pressure.distancePressureWindow - dist)
  }, 0)
  const enemyPressure = enemyUnits.reduce((sum, unit) => {
    const dist = hexDistance(unit.pos, ownStronghold.pos)
    return sum + Math.max(0, BOT_HEURISTICS.pressure.distancePressureWindow - dist)
  }, 0)
  return ownPressure - enemyPressure
}

function computeImmediateTacticalDelta(
  state: GameState,
  player: PlayerId,
  ownUnits: Unit[],
  enemyUnits: Unit[]
): number {
  const opponent: PlayerId = player === 0 ? 1 : 0
  let ownTactical = 0
  let enemyTactical = 0

  ownUnits.forEach((unit) => {
    ownTactical += countAdjacentEnemies(state, unit.pos, opponent) * BOT_HEURISTICS.tactical.adjacentEnemyWeight
    if (hasEnemyInFacingRay(state, unit, opponent)) ownTactical += BOT_HEURISTICS.tactical.facingRayThreatWeight
  })

  enemyUnits.forEach((unit) => {
    enemyTactical += countAdjacentEnemies(state, unit.pos, player) * BOT_HEURISTICS.tactical.adjacentEnemyWeight
    if (hasEnemyInFacingRay(state, unit, player)) enemyTactical += BOT_HEURISTICS.tactical.facingRayThreatWeight
  })

  return ownTactical - enemyTactical
}

function computeOpponentHistoryRisk(
  state: GameState,
  player: PlayerId,
  ownUnits: Unit[],
  enemyUnits: Unit[]
): number {
  if (ownUnits.length === 0 || enemyUnits.length === 0) return 0
  const opponent: PlayerId = player === 0 ? 1 : 0
  const revealed = state.players[opponent].discard
  const revealedCount = revealed.length
  const counts = new Map<CardDefId, number>()
  revealed.forEach((card) => {
    counts.set(card.defId, (counts.get(card.defId) ?? 0) + 1)
  })

  const rayExposure = enemyUnits.reduce((sum, unit) => {
    const first = firstUnitInFacingRay(state, unit)
    if (!first || first.owner !== player || first.kind !== 'unit') return sum
    return sum + 1
  }, 0)

  const ownStronghold = state.units[`stronghold-${player}`]
  const strongholdRayExposure = ownStronghold
    ? enemyUnits.reduce((sum, unit) => {
        return sum + (isHexInFacingRay(state, unit.pos, unit.facing, ownStronghold.pos) ? 1 : 0)
      }, 0)
    : 0

  const adjacencyExposure = ownUnits.reduce((sum, unit) => {
    return sum + countAdjacentEnemies(state, unit.pos, opponent)
  }, 0)

  const clusterExposure = ownUnits.reduce((sum, unit) => {
    return sum + countAdjacentFriendlies(state, unit.pos, player)
  }, 0)

  const fragileUnits = ownUnits.reduce(
    (sum, unit) => sum + (unit.strength <= BOT_HEURISTICS.history.fragileUnitThreshold ? 1 : 0),
    0
  )

  const arrowLikelihood = cardHistoryLikelihood(
    counts,
    revealedCount,
    'attack_arrow',
    BOT_HEURISTICS.history.priors.attack_arrow
  )
  const lineLikelihood = cardHistoryLikelihood(
    counts,
    revealedCount,
    'attack_line',
    BOT_HEURISTICS.history.priors.attack_line
  )
  const cleaveLikelihood = cardHistoryLikelihood(
    counts,
    revealedCount,
    'attack_fwd_lr',
    BOT_HEURISTICS.history.priors.attack_fwd_lr
  )
  const lightningLikelihood = cardHistoryLikelihood(
    counts,
    revealedCount,
    'spell_lightning',
    BOT_HEURISTICS.history.priors.spell_lightning
  )
  const meteorLikelihood = cardHistoryLikelihood(
    counts,
    revealedCount,
    'spell_meteor',
    BOT_HEURISTICS.history.priors.spell_meteor
  )

  return (
    arrowLikelihood * (rayExposure + strongholdRayExposure * BOT_HEURISTICS.history.arrowStrongholdRayScale) +
    lineLikelihood * (rayExposure * BOT_HEURISTICS.history.lineRayScale + strongholdRayExposure) +
    cleaveLikelihood * adjacencyExposure * BOT_HEURISTICS.history.cleaveAdjacencyScale +
    lightningLikelihood * fragileUnits * BOT_HEURISTICS.history.lightningFragileScale +
    meteorLikelihood *
      (clusterExposure * BOT_HEURISTICS.history.meteorClusterScale +
        strongholdRayExposure * BOT_HEURISTICS.history.meteorStrongholdRayScale)
  )
}

function cardHistoryLikelihood(
  counts: Map<CardDefId, number>,
  total: number,
  defId: CardDefId,
  prior: number
): number {
  const seen = counts.get(defId) ?? 0
  return (seen + prior) / (total + 1)
}

function countAdjacentEnemies(state: GameState, origin: Hex, enemy: PlayerId): number {
  let count = 0
  DIRECTIONS.forEach((direction) => {
    const target = getUnitAt(state, neighbor(origin, direction))
    if (!target || target.owner !== enemy || target.kind !== 'unit') return
    count += 1
  })
  return count
}

function hasEnemyInFacingRay(state: GameState, unit: Unit, enemy: PlayerId): boolean {
  let cursor = { ...unit.pos }
  for (;;) {
    cursor = neighbor(cursor, unit.facing)
    if (!inBounds(state, cursor)) return false
    const target = getUnitAt(state, cursor)
    if (!target) continue
    return target.owner === enemy
  }
}

function firstUnitInFacingRay(state: GameState, unit: Unit): Unit | null {
  let cursor = { ...unit.pos }
  for (;;) {
    cursor = neighbor(cursor, unit.facing)
    if (!inBounds(state, cursor)) return null
    const target = getUnitAt(state, cursor)
    if (target) return target
  }
}

function isHexInFacingRay(state: GameState, origin: Hex, direction: Direction, target: Hex): boolean {
  let cursor = { ...origin }
  for (;;) {
    cursor = neighbor(cursor, direction)
    if (!inBounds(state, cursor)) return false
    if (cursor.q === target.q && cursor.r === target.r) return true
    if (getUnitAt(state, cursor)) return false
  }
}

function countAdjacentFriendlies(state: GameState, origin: Hex, owner: PlayerId): number {
  let count = 0
  DIRECTIONS.forEach((direction) => {
    const target = getUnitAt(state, neighbor(origin, direction))
    if (!target || target.owner !== owner || target.kind !== 'unit') return
    count += 1
  })
  return count
}

function deterministicJitter(state: GameState, player: PlayerId): number {
  const text = buildOrderSignature(state, player)
  const hash = hashString(`${state.turn}|${player}|${text}`)
  return (hash % 1000) / 1_000_000
}

function buildOrderSignature(state: GameState, player: PlayerId): string {
  const parts = state.players[player].orders.map((order) => {
    return `${order.cardId}:${order.defId}:${serializeParams(order.params)}`
  })
  return parts.join('|')
}

function serializeParams(params: OrderParams): string {
  return [
    params.unitId ?? '',
    params.unitId2 ?? '',
    params.tile ? `${params.tile.q},${params.tile.r}` : '',
    params.direction === undefined ? '' : String(params.direction),
    params.moveDirection === undefined ? '' : String(params.moveDirection),
    params.faceDirection === undefined ? '' : String(params.faceDirection),
    params.distance === undefined ? '' : String(params.distance),
  ].join(';')
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function pruneBeam(nodes: BeamNode[], width: number): BeamNode[] {
  const seen = new Set<string>()
  const sorted = nodes.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.signature.localeCompare(b.signature)
  })
  const out: BeamNode[] = []
  for (const node of sorted) {
    if (seen.has(node.signature)) continue
    seen.add(node.signature)
    out.push(node)
    if (out.length >= width) break
  }
  return out
}

function isBetterTerminal(candidate: BeamNode, currentBest: BeamNode): boolean {
  if (candidate.score !== currentBest.score) return candidate.score > currentBest.score
  return candidate.signature < currentBest.signature
}

function buildFairPlanningSnapshot(source: GameState, player: PlayerId): GameState {
  const opponent: PlayerId = player === 0 ? 1 : 0
  const snapshot = cloneGameState(source)
  snapshot.players[opponent].orders = []
  snapshot.players[opponent].hand = []
  snapshot.ready[opponent] = false
  return snapshot
}

function cloneGameState(source: GameState): GameState {
  const units: GameState['units'] = {}
  Object.entries(source.units).forEach(([unitId, unit]) => {
    units[unitId] = {
      ...unit,
      pos: { ...unit.pos },
    }
  })

  const players: GameState['players'] = [
    {
      deck: source.players[0].deck.map((card) => ({ ...card })),
      hand: source.players[0].hand.map((card) => ({ ...card })),
      discard: source.players[0].discard.map((card) => ({ ...card })),
      orders: source.players[0].orders.map(cloneOrder),
    },
    {
      deck: source.players[1].deck.map((card) => ({ ...card })),
      hand: source.players[1].hand.map((card) => ({ ...card })),
      discard: source.players[1].discard.map((card) => ({ ...card })),
      orders: source.players[1].orders.map(cloneOrder),
    },
  ]

  return {
    boardRows: source.boardRows,
    boardCols: source.boardCols,
    tiles: source.tiles.map((tile) => ({ ...tile })),
    units,
    players,
    ready: [source.ready[0], source.ready[1]],
    actionBudgets: [source.actionBudgets[0], source.actionBudgets[1]],
    activePlayer: source.activePlayer,
    phase: source.phase,
    actionQueue: source.actionQueue.map(cloneOrder),
    actionIndex: source.actionIndex,
    turn: source.turn,
    nextUnitId: source.nextUnitId,
    nextOrderId: source.nextOrderId,
    log: [...source.log],
    winner: source.winner,
    spawnedByOrder: { ...source.spawnedByOrder },
    settings: { ...source.settings },
  }
}

function cloneOrder(order: Order): Order {
  return {
    ...order,
    params: cloneParams(order.params),
  }
}

function cloneParams(params: OrderParams): OrderParams {
  return {
    ...params,
    tile: params.tile ? { ...params.tile } : undefined,
  }
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isSpawnTile(state: GameState, player: PlayerId, hex: Hex): boolean {
  return getSpawnTiles(state, player).some((tile) => tile.q === hex.q && tile.r === hex.r)
}

function getUnitAt(state: GameState, hex: Hex): Unit | null {
  for (const unit of Object.values(state.units)) {
    if (unit.pos.q === hex.q && unit.pos.r === hex.r) return unit
  }
  return null
}

function inBounds(state: GameState, hex: Hex): boolean {
  return hex.q >= 0 && hex.q < state.boardCols && hex.r >= 0 && hex.r < state.boardRows
}

function hexKey(hex: Hex): string {
  return `${hex.q},${hex.r}`
}

function projectMoveEnd(state: GameState, unit: Unit, direction: Direction, distance: number): Hex {
  let current = { ...unit.pos }
  for (let step = 0; step < distance; step += 1) {
    const next = neighbor(current, direction)
    if (!inBounds(state, next)) break
    const occupied = getUnitAt(state, next)
    if (occupied) break
    current = next
  }
  return current
}

function hexDistance(a: Hex, b: Hex): number {
  const aAxial = offsetToAxial(a)
  const bAxial = offsetToAxial(b)
  const dq = aAxial.q - bAxial.q
  const dr = aAxial.r - bAxial.r
  const ds = -aAxial.q - aAxial.r - (-bAxial.q - bAxial.r)
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
}
