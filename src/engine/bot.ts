import { CARD_DEFS } from './cards'
import { canCardTargetUnit, getBarricadeSpawnTiles, getSpawnTiles, planOrder, simulatePlannedState } from './game'
import { neighbor, offsetToAxial } from './hex'
import type { CardDefId, Direction, GameState, Hex, Order, OrderParams, PlayerClassId, PlayerId, Unit } from './types'

export type BotPlannerOptions = {
  thinkTimeMs: number
  beamWidth: number
  maxCandidatesPerCard: number
}

export type BotScoringHeuristics = {
  winValue: number
  leaderStrengthDeltaWeight: number
  unitStrengthDeltaWeight: number
  unitCountDeltaWeight: number
  pressureDeltaWeight: number
  tacticalDeltaWeight: number
  opponentHistoryRiskWeight: number
  chainLightningOpportunityWeight: number
  queueTimingRiskWeight: number
}

export type BotPressureHeuristics = {
  distancePressureWindow: number
}

export type BotTacticalHeuristics = {
  adjacentEnemyWeight: number
  facingRayThreatWeight: number
}

export type BotHistoryPriorsHeuristics = {
  attack_arrow: number
  attack_line: number
  attack_fwd_lr: number
  spell_lightning: number
  spell_meteor: number
}

export type BotHistoryHeuristics = {
  fragileUnitThreshold: number
  priors: BotHistoryPriorsHeuristics
  arrowLeaderRayScale: number
  lineRayScale: number
  cleaveAdjacencyScale: number
  lightningFragileScale: number
  meteorClusterScale: number
  meteorLeaderRayScale: number
}

export type BotChainLightningHeuristics = {
  basePlayChance: number
  adjacentTargetChance: number
  reachableTargetChance: number
  fragileTargetChance: number
  leaderTargetChance: number
  minPlayChance: number
  maxPlayChance: number
  guaranteedReachableTargets: number
  guaranteedFragileTargets: number
  isolatedDurableChanceScale: number
}

export type BotTimingHeuristics = {
  lateOrderIndexRisk: number
  slowTailExtraRisk: number
  priorityRiskScale: number
}

export type BotHeuristics = {
  scoring: BotScoringHeuristics
  pressure: BotPressureHeuristics
  tactical: BotTacticalHeuristics
  history: BotHistoryHeuristics
  chainLightning: BotChainLightningHeuristics
  timing: BotTimingHeuristics
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type BotHeuristicOverrides = DeepPartial<BotHeuristics>
export type BotPlannerConfig = BotPlannerOptions & {
  heuristics: BotHeuristics
}
export type BotPlannerOverrides = Partial<BotPlannerOptions> & {
  heuristics?: BotHeuristicOverrides
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

export const DEFAULT_BOT_PLANNER_OPTIONS: BotPlannerOptions = {
  thinkTimeMs: 50,
  beamWidth: 10,
  maxCandidatesPerCard: 12,
}

export const BOT_HEURISTICS: BotHeuristics = {
  scoring: {
    winValue: 1_000_000,
    leaderStrengthDeltaWeight: 500,
    unitStrengthDeltaWeight: 45,
    unitCountDeltaWeight: 22,
    pressureDeltaWeight: 8,
    tacticalDeltaWeight: 10,
    opponentHistoryRiskWeight: -14,
    chainLightningOpportunityWeight: 12,
    queueTimingRiskWeight: -18,
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
    arrowLeaderRayScale: 1.1,
    lineRayScale: 0.75,
    cleaveAdjacencyScale: 0.45,
    lightningFragileScale: 0.35,
    meteorClusterScale: 0.32,
    meteorLeaderRayScale: 0.18,
  },
  chainLightning: {
    basePlayChance: 0.22,
    adjacentTargetChance: 0.08,
    reachableTargetChance: 0.14,
    fragileTargetChance: 0.18,
    leaderTargetChance: 0.12,
    minPlayChance: 0.05,
    maxPlayChance: 0.95,
    guaranteedReachableTargets: 4,
    guaranteedFragileTargets: 2,
    isolatedDurableChanceScale: 0.35,
  },
  timing: {
    lateOrderIndexRisk: 0.18,
    slowTailExtraRisk: 0.95,
    priorityRiskScale: 0.7,
  },
}

const DIRECTIONS: Direction[] = [0, 1, 2, 3, 4, 5]

export function buildBotPlan(
  inputState: GameState,
  player: PlayerId,
  options: BotPlannerOverrides = {}
): BotPlanResult {
  const config = resolveBotPlannerConfig(options)
  const start = nowMs()
  const deadline = start + config.thinkTimeMs
  const evaluationCache = new Map<string, number>()

  const rootState = buildFairPlanningSnapshot(inputState, player)
  const depthLimit = Math.max(1, rootState.players[player].hand.length)
  const rootNode: BeamNode = {
    state: rootState,
    score: evaluatePlanningState(rootState, player, config.heuristics, evaluationCache),
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

      const candidates = generateRankedCandidates(node.state, player, config, deadline, evaluationCache)
      for (const candidate of candidates) {
        if (nowMs() >= deadline) break
        const nextState = cloneGameState(node.state)
        const planned = planOrder(nextState, player, candidate.cardId, candidate.params)
        if (!planned) continue

        const score = evaluatePlanningState(nextState, player, config.heuristics, evaluationCache)
        const signature = buildOrderSignature(nextState, player)
        const nextNode: BeamNode = { state: nextState, score, signature }
        nextBeam.push(nextNode)

        if (isBetterTerminal(nextNode, bestNode)) {
          bestNode = nextNode
        }
      }
    }

    if (nextBeam.length === 0) break
    beam = pruneBeam(nextBeam, config.beamWidth)
  }

  const elapsedMs = nowMs() - start
  const orders = bestNode.state.players[player].orders.map((order) => ({
    cardId: order.cardId,
    params: cloneParams(order.params),
  }))

  return { orders, elapsedMs }
}

export function resolveBotPlannerConfig(input: BotPlannerOverrides = {}): BotPlannerConfig {
  return {
    ...normalizeOptions(input),
    heuristics: normalizeHeuristics(input.heuristics),
  }
}

function normalizeOptions(input: Partial<BotPlannerOptions>): BotPlannerOptions {
  return {
    thinkTimeMs: clamp(Math.floor(input.thinkTimeMs ?? DEFAULT_BOT_PLANNER_OPTIONS.thinkTimeMs), 1, 500),
    beamWidth: clamp(Math.floor(input.beamWidth ?? DEFAULT_BOT_PLANNER_OPTIONS.beamWidth), 1, 32),
    maxCandidatesPerCard: clamp(
      Math.floor(input.maxCandidatesPerCard ?? DEFAULT_BOT_PLANNER_OPTIONS.maxCandidatesPerCard),
      1,
      40
    ),
  }
}

function normalizeHeuristics(overrides: BotHeuristicOverrides | undefined): BotHeuristics {
  return {
    scoring: {
      winValue: readNumber(overrides?.scoring?.winValue, BOT_HEURISTICS.scoring.winValue, 1),
      leaderStrengthDeltaWeight: readNumber(
        overrides?.scoring?.leaderStrengthDeltaWeight,
        BOT_HEURISTICS.scoring.leaderStrengthDeltaWeight
      ),
      unitStrengthDeltaWeight: readNumber(
        overrides?.scoring?.unitStrengthDeltaWeight,
        BOT_HEURISTICS.scoring.unitStrengthDeltaWeight
      ),
      unitCountDeltaWeight: readNumber(overrides?.scoring?.unitCountDeltaWeight, BOT_HEURISTICS.scoring.unitCountDeltaWeight),
      pressureDeltaWeight: readNumber(overrides?.scoring?.pressureDeltaWeight, BOT_HEURISTICS.scoring.pressureDeltaWeight),
      tacticalDeltaWeight: readNumber(overrides?.scoring?.tacticalDeltaWeight, BOT_HEURISTICS.scoring.tacticalDeltaWeight),
      opponentHistoryRiskWeight: readNumber(
        overrides?.scoring?.opponentHistoryRiskWeight,
        BOT_HEURISTICS.scoring.opponentHistoryRiskWeight
      ),
      chainLightningOpportunityWeight: readNumber(
        overrides?.scoring?.chainLightningOpportunityWeight,
        BOT_HEURISTICS.scoring.chainLightningOpportunityWeight
      ),
      queueTimingRiskWeight: readNumber(
        overrides?.scoring?.queueTimingRiskWeight,
        BOT_HEURISTICS.scoring.queueTimingRiskWeight
      ),
    },
    pressure: {
      distancePressureWindow: readInt(
        overrides?.pressure?.distancePressureWindow,
        BOT_HEURISTICS.pressure.distancePressureWindow,
        1,
        50
      ),
    },
    tactical: {
      adjacentEnemyWeight: readNumber(
        overrides?.tactical?.adjacentEnemyWeight,
        BOT_HEURISTICS.tactical.adjacentEnemyWeight
      ),
      facingRayThreatWeight: readNumber(
        overrides?.tactical?.facingRayThreatWeight,
        BOT_HEURISTICS.tactical.facingRayThreatWeight
      ),
    },
    history: {
      fragileUnitThreshold: readInt(
        overrides?.history?.fragileUnitThreshold,
        BOT_HEURISTICS.history.fragileUnitThreshold,
        0,
        20
      ),
      priors: {
        attack_arrow: readRatio(overrides?.history?.priors?.attack_arrow, BOT_HEURISTICS.history.priors.attack_arrow),
        attack_line: readRatio(overrides?.history?.priors?.attack_line, BOT_HEURISTICS.history.priors.attack_line),
        attack_fwd_lr: readRatio(overrides?.history?.priors?.attack_fwd_lr, BOT_HEURISTICS.history.priors.attack_fwd_lr),
        spell_lightning: readRatio(
          overrides?.history?.priors?.spell_lightning,
          BOT_HEURISTICS.history.priors.spell_lightning
        ),
        spell_meteor: readRatio(overrides?.history?.priors?.spell_meteor, BOT_HEURISTICS.history.priors.spell_meteor),
      },
      arrowLeaderRayScale: readNumber(
        overrides?.history?.arrowLeaderRayScale,
        BOT_HEURISTICS.history.arrowLeaderRayScale,
        0
      ),
      lineRayScale: readNumber(overrides?.history?.lineRayScale, BOT_HEURISTICS.history.lineRayScale, 0),
      cleaveAdjacencyScale: readNumber(
        overrides?.history?.cleaveAdjacencyScale,
        BOT_HEURISTICS.history.cleaveAdjacencyScale,
        0
      ),
      lightningFragileScale: readNumber(
        overrides?.history?.lightningFragileScale,
        BOT_HEURISTICS.history.lightningFragileScale,
        0
      ),
      meteorClusterScale: readNumber(overrides?.history?.meteorClusterScale, BOT_HEURISTICS.history.meteorClusterScale, 0),
      meteorLeaderRayScale: readNumber(
        overrides?.history?.meteorLeaderRayScale,
        BOT_HEURISTICS.history.meteorLeaderRayScale,
        0
      ),
    },
    chainLightning: {
      basePlayChance: readRatio(
        overrides?.chainLightning?.basePlayChance,
        BOT_HEURISTICS.chainLightning.basePlayChance
      ),
      adjacentTargetChance: readRatio(
        overrides?.chainLightning?.adjacentTargetChance,
        BOT_HEURISTICS.chainLightning.adjacentTargetChance
      ),
      reachableTargetChance: readRatio(
        overrides?.chainLightning?.reachableTargetChance,
        BOT_HEURISTICS.chainLightning.reachableTargetChance
      ),
      fragileTargetChance: readRatio(
        overrides?.chainLightning?.fragileTargetChance,
        BOT_HEURISTICS.chainLightning.fragileTargetChance
      ),
      leaderTargetChance: readRatio(
        overrides?.chainLightning?.leaderTargetChance,
        BOT_HEURISTICS.chainLightning.leaderTargetChance
      ),
      minPlayChance: readRatio(overrides?.chainLightning?.minPlayChance, BOT_HEURISTICS.chainLightning.minPlayChance),
      maxPlayChance: readRatio(overrides?.chainLightning?.maxPlayChance, BOT_HEURISTICS.chainLightning.maxPlayChance),
      guaranteedReachableTargets: readInt(
        overrides?.chainLightning?.guaranteedReachableTargets,
        BOT_HEURISTICS.chainLightning.guaranteedReachableTargets,
        1,
        20
      ),
      guaranteedFragileTargets: readInt(
        overrides?.chainLightning?.guaranteedFragileTargets,
        BOT_HEURISTICS.chainLightning.guaranteedFragileTargets,
        1,
        20
      ),
      isolatedDurableChanceScale: readRatio(
        overrides?.chainLightning?.isolatedDurableChanceScale,
        BOT_HEURISTICS.chainLightning.isolatedDurableChanceScale
      ),
    },
    timing: {
      lateOrderIndexRisk: readNumber(overrides?.timing?.lateOrderIndexRisk, BOT_HEURISTICS.timing.lateOrderIndexRisk, 0),
      slowTailExtraRisk: readNumber(overrides?.timing?.slowTailExtraRisk, BOT_HEURISTICS.timing.slowTailExtraRisk, 0),
      priorityRiskScale: readNumber(overrides?.timing?.priorityRiskScale, BOT_HEURISTICS.timing.priorityRiskScale, 0, 2),
    },
  }
}

function readNumber(raw: number | undefined, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return clamp(raw, min, max)
}

function readInt(raw: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return clamp(Math.floor(raw), min, max)
}

function readRatio(raw: number | undefined, fallback: number): number {
  return readNumber(raw, fallback, 0, 1)
}

function generateRankedCandidates(
  state: GameState,
  player: PlayerId,
  config: BotPlannerConfig,
  deadline: number,
  evaluationCache: Map<string, number>
): Candidate[] {
  const playerHand = state.players[player].hand
  if (playerHand.length === 0) return []

  const projected = simulatePlannedState(state, player)
  const allCandidates: Candidate[] = []
  const maxTotal = Math.max(24, config.beamWidth * 5)

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
        score: evaluatePlanningState(nextState, player, config.heuristics, evaluationCache),
        signature,
      })
    }

    if (scored.length === 0) continue
    scored.sort(compareCandidateScore)
    allCandidates.push(...scored.slice(0, config.maxCandidatesPerCard))
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
    const refs = getFriendlyUnitRefs(state, projected, player, true)
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
    const refs = getFriendlyUnitRefs(state, projected, player, true)
      .filter((ref) => isSpawnTile(projected, player, ref.snapshot.pos))
      .map((ref) => ref.refId)
    return refs.map((unitId) => ({ unitId }))
  }

  if (defId === 'reinforce_quick_boost') {
    return getFriendlyUnitRefs(state, projected, player, true).map((ref) => ({ unitId: ref.refId }))
  }

  if (
    defId === 'reinforce_rage' ||
    defId === 'reinforce_bolster' ||
    defId === 'reinforce_shrug_off' ||
    defId === 'reinforce_spikes' ||
    defId === 'reinforce_berserk' ||
    defId === 'reinforce_lightning_barrier'
  ) {
    return getFriendlyUnitRefs(state, projected, player).map((ref) => ({ unitId: ref.refId }))
  }

  if (defId === 'reinforce_barricade') {
    const candidates = getBarricadeSpawnTiles(projected, player)
    const params: OrderParams[] = []
    for (let first = 0; first < candidates.length; first += 1) {
      for (let second = first + 1; second < candidates.length; second += 1) {
        params.push({
          tile: { ...candidates[first] },
          tile2: { ...candidates[second] },
        })
      }
    }
    return params
  }

  if (defId === 'reinforce_battlefield_recruitment') {
    return getBarricadeSpawnTiles(projected, player).map((tile) => ({ tile: { ...tile } }))
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
      DIRECTIONS.forEach((direction) => {
        const destination = neighbor(ref.snapshot.pos, direction)
        if (!inBounds(projected, destination)) return
        DIRECTIONS.forEach((faceDirection) => {
          params.push({
            unitId: ref.refId,
            tile: { ...destination },
            moveDirection: direction,
            direction: faceDirection,
          })
        })
      })
    })
    return params
  }

  if (defId === 'move_quickstep') {
    return refs.map((ref) => ({ unitId: ref.refId }))
  }

  if (defId === 'move_dash') {
    const params: OrderParams[] = []
    refs.forEach((ref) => {
      ;[1, 2].forEach((distance) => {
        params.push({ unitId: ref.refId, distance })
      })
    })
    return params
  }

  if (defId === 'move_tandem') {
    const distances = CARD_DEFS[defId].requires.distanceOptions ?? [1, 2, 3]
    const params: OrderParams[] = []
    refs.forEach((ref) => {
      DIRECTIONS.forEach((direction) => {
        distances.forEach((distance) => {
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

  if (defId === 'move_double_steps') {
    const params: OrderParams[] = []
    for (let firstIndex = 0; firstIndex < refs.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < refs.length; secondIndex += 1) {
        const first = refs[firstIndex]
        const second = refs[secondIndex]
        const firstTargets = getAdjacentOpenTiles(projected, first.snapshot.pos)
        const secondTargets = getAdjacentOpenTiles(projected, second.snapshot.pos)
        firstTargets.forEach((tile) => {
          secondTargets.forEach((tile2) => {
            if (tile.q === tile2.q && tile.r === tile2.r) return
            params.push({
              unitId: first.refId,
              unitId2: second.refId,
              tile: { ...tile },
              tile2: { ...tile2 },
            })
          })
        })
      }
    }
    return params
  }

  if (defId === 'move_converge') {
    const candidates = new Map<string, Hex>()
    const enemyUnits = Object.values(projected.units).filter((unit) => unit.owner !== player)
    enemyUnits.forEach((unit) => {
      addHexCandidate(candidates, unit.pos)
      DIRECTIONS.forEach((direction) => addHexCandidate(candidates, neighbor(unit.pos, direction)))
    })
    if (candidates.size === 0) {
      addHexCandidate(candidates, {
        q: Math.floor(projected.boardCols / 2),
        r: Math.floor(projected.boardRows / 2),
      })
    }
    return [...candidates.values()]
      .filter((hex) => inBounds(projected, hex))
      .map((tile) => ({ tile: { ...tile } }))
  }

  if (defId === 'move_teleport') {
    const params: OrderParams[] = []
    refs.forEach((ref) => {
      projected.tiles.forEach((tile) => {
        if (tile.q === ref.snapshot.pos.q && tile.r === ref.snapshot.pos.r) return
        if (hexDistance(ref.snapshot.pos, tile) > 3) return
        if (getUnitAt(projected, tile)) return
        params.push({
          unitId: ref.refId,
          tile: { q: tile.q, r: tile.r },
        })
      })
    })
    return params
  }

  return []
}

function generateAttackParams(state: GameState, projected: GameState, player: PlayerId, defId: CardDefId): OrderParams[] {
  if (defId === 'attack_coordinated' || defId === 'attack_pincer_attack') {
    return [{}]
  }
  const refs = getFriendlyUnitRefs(state, projected, player)
  if (refs.length === 0) return []
  const params: OrderParams[] = []
  if (defId === 'attack_blade_dance') {
    refs.forEach((ref) => {
      DIRECTIONS.forEach((firstDirection) => {
        const first = neighbor(ref.snapshot.pos, firstDirection)
        if (!inBounds(projected, first)) return
        DIRECTIONS.forEach((secondDirection) => {
          const second = neighbor(first, secondDirection)
          if (!inBounds(projected, second)) return
          DIRECTIONS.forEach((thirdDirection) => {
            const third = neighbor(second, thirdDirection)
            if (!inBounds(projected, third)) return
            params.push({
              unitId: ref.refId,
              tile: { ...first },
              tile2: { ...second },
              tile3: { ...third },
              direction: firstDirection,
              moveDirection: secondDirection,
              faceDirection: thirdDirection,
            })
          })
        })
      })
    })
    return params
  }

  if (
    defId === 'attack_roguelike_basic' ||
    defId === 'attack_roguelike_slow' ||
    defId === 'attack_roguelike_pack_hunt'
  ) {
    refs.forEach((ref) => {
      const candidates: { params: OrderParams; hitsEnemy: boolean }[] = []
      DIRECTIONS.forEach((direction) => {
        const target = getDirectionalAttackTarget(projected, ref.snapshot, defId, direction)
        if (target && target.owner === player) return
        candidates.push({
          params: { unitId: ref.refId, direction },
          hitsEnemy: Boolean(target && target.owner !== player),
        })
      })

      if (candidates.length === 0) return
      const preferred = candidates.some((candidate) => candidate.hitsEnemy)
        ? candidates.filter((candidate) => candidate.hitsEnemy)
        : candidates
      preferred.forEach((candidate) => params.push(candidate.params))
    })
    return params
  }

  if (
    defId === 'attack_fwd' ||
    defId === 'attack_jab' ||
    defId === 'attack_bash' ||
    defId === 'attack_ice_bolt' ||
    defId === 'attack_shove' ||
    defId === 'attack_roundhouse_kick' ||
    defId === 'attack_fireball' ||
    defId === 'attack_disarm' ||
    defId === 'attack_bleed'
  ) {
    refs.forEach((ref) => {
      DIRECTIONS.forEach((direction) => {
        params.push({ unitId: ref.refId, direction })
      })
    })
    return params
  }

  if (defId === 'attack_charge') {
    refs.forEach((ref) => {
      DIRECTIONS.forEach((direction) => {
        params.push({ unitId: ref.refId, direction })
      })
    })
    return params
  }

  if (defId === 'attack_joint_attack') {
    refs.forEach((ref) => {
      DIRECTIONS.forEach((direction) => {
        const tile = neighbor(ref.snapshot.pos, direction)
        if (!inBounds(projected, tile)) return
        params.push({ unitId: ref.refId, tile: { ...tile } })
      })
    })
    return params
  }

  if (defId === 'attack_volley') {
    refs.forEach((ref) => {
      const candidates = new Map<string, Hex>()
      Object.values(projected.units)
        .filter((unit) => unit.owner !== player)
        .forEach((unit) => {
          if (hexDistance(ref.snapshot.pos, unit.pos) > 3) return
          addHexCandidate(candidates, unit.pos)
          DIRECTIONS.forEach((direction) => {
            const tile = neighbor(unit.pos, direction)
            if (hexDistance(ref.snapshot.pos, tile) > 3) return
            addHexCandidate(candidates, tile)
          })
        })
      if (candidates.size === 0) {
        projected.tiles.forEach((tile) => {
          const hex = { q: tile.q, r: tile.r }
          if (hexDistance(ref.snapshot.pos, hex) > 3) return
          addHexCandidate(candidates, hex)
        })
      }
      ;[...candidates.values()]
        .filter((tile) => inBounds(projected, tile))
        .forEach((tile) => {
          params.push({ unitId: ref.refId, tile: { ...tile } })
        })
    })
    return params
  }

  refs.forEach((ref) => {
    params.push({ unitId: ref.refId })
  })
  return params
}

function generateSpellParams(_state: GameState, projected: GameState, player: PlayerId, defId: CardDefId): OrderParams[] {
  if (defId === 'spell_invest' || defId === 'spell_divination' || defId === 'spell_brain_freeze') return [{}]

  if (defId === 'spell_pitfall_trap' || defId === 'spell_explosive_trap') {
    return getBarricadeSpawnTiles(projected, player).map((tile) => ({ tile: { ...tile } }))
  }

  if (
    defId === 'spell_lightning' ||
    defId === 'spell_petrify' ||
    defId === 'spell_burn' ||
    defId === 'spell_trip' ||
    defId === 'spell_snare' ||
    defId === 'spell_dispel' ||
    defId === 'spell_roguelike_mark'
  ) {
    const targetableUnits = getTargetableUnitsForCard(projected, defId)
    const enemyUnits = targetableUnits.filter((unit) => unit.owner !== player)
    if (enemyUnits.length > 0) {
      return enemyUnits.map((unit) => ({ unitId: unit.id }))
    }
    return targetableUnits.map((unit) => ({ unitId: unit.id }))
  }

  if (defId === 'spell_meteor') {
    const candidates = new Map<string, Hex>()
    const enemyUnits = Object.values(projected.units).filter((unit) => unit.owner !== player)
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
      .map((tile) => ({ tile: { ...tile } }))
  }

  if (defId === 'spell_blizzard') {
    const candidates = new Map<string, Hex>()
    Object.values(projected.units)
      .filter((unit) => unit.owner !== player)
      .forEach((unit) => {
        addHexCandidate(candidates, unit.pos)
        DIRECTIONS.forEach((direction) => addHexCandidate(candidates, neighbor(unit.pos, direction)))
      })
    if (candidates.size === 0) {
      addHexCandidate(candidates, {
        q: Math.floor(projected.boardCols / 2),
        r: Math.floor(projected.boardRows / 2),
      })
    }
    return [...candidates.values()]
      .filter((hex) => inBounds(projected, hex))
      .map((tile) => ({ tile: { ...tile } }))
  }

  return [{}]
}

function getTargetableUnitsForCard(state: GameState, defId: CardDefId): Unit[] {
  return Object.values(state.units).filter((unit) => canCardTargetUnit(defId, unit))
}

function getDirectionalAttackTarget(state: GameState, unit: Unit, defId: CardDefId, direction: Direction): Unit | null {
  if (defId === 'attack_roguelike_pack_hunt') {
    const moveEnd = projectMoveEnd(state, unit, direction, 1)
    const targetHex = neighbor(moveEnd, direction)
    if (!inBounds(state, targetHex)) return null
    return getUnitAt(state, targetHex)
  }
  const targetHex = neighbor(unit.pos, direction)
  if (!inBounds(state, targetHex)) return null
  return getUnitAt(state, targetHex)
}

function addHexCandidate(map: Map<string, Hex>, hex: Hex): void {
  map.set(hexKey(hex), { ...hex })
}

function getAdjacentOpenTiles(state: GameState, origin: Hex): Hex[] {
  return DIRECTIONS.map((direction) => neighbor(origin, direction))
    .filter((hex) => inBounds(state, hex))
    .filter((hex) => getUnitAt(state, hex) === null)
}

function getFriendlyUnitRefs(
  state: GameState,
  projected: GameState,
  player: PlayerId,
  includeBarricades = false
): UnitRef[] {
  const refs: UnitRef[] = []

  Object.values(state.units)
    .filter(
      (unit) =>
        unit.owner === player &&
        (unit.kind === 'unit' || unit.kind === 'leader' || (includeBarricades && unit.kind === 'barricade'))
    )
    .forEach((unit) => {
      const projectedUnit = projected.units[unit.id]
      if (!projectedUnit) return
      if (
        projectedUnit.kind !== 'unit' &&
        projectedUnit.kind !== 'leader' &&
        !(includeBarricades && projectedUnit.kind === 'barricade')
      ) {
        return
      }
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

function evaluatePlanningState(
  state: GameState,
  player: PlayerId,
  heuristics: BotHeuristics,
  evaluationCache?: Map<string, number>
): number {
  const cacheKey = `${player}|${state.turn}|${buildOrderSignature(state, player)}`
  const cached = evaluationCache?.get(cacheKey)
  if (cached !== undefined) return cached

  const projected = simulatePlannedState(state, player)
  const opponent: PlayerId = player === 0 ? 1 : 0
  if (projected.winner === player) {
    const winningScore = heuristics.scoring.winValue + deterministicJitter(state, player)
    evaluationCache?.set(cacheKey, winningScore)
    return winningScore
  }
  if (projected.winner === opponent) {
    const losingScore = -heuristics.scoring.winValue + deterministicJitter(state, player)
    evaluationCache?.set(cacheKey, losingScore)
    return losingScore
  }

  const ownLeader = projected.units[`leader-${player}`]
  const enemyLeader = projected.units[`leader-${opponent}`]
  const eliminateUnitsMode = projected.settings.victoryCondition === 'eliminate_units'
  const ownLeaderStrength = eliminateUnitsMode ? 0 : ownLeader?.strength ?? 0
  const enemyLeaderStrength = eliminateUnitsMode ? 0 : enemyLeader?.strength ?? 0

  const ownUnits = Object.values(projected.units).filter((unit) => unit.owner === player && unit.kind === 'unit')
  const enemyUnits = Object.values(projected.units).filter((unit) => unit.owner === opponent && unit.kind === 'unit')
  const ownCombatants = Object.values(projected.units).filter((unit) => unit.owner === player && isCombatUnit(unit))
  const enemyCombatants = Object.values(projected.units).filter((unit) => unit.owner === opponent && isCombatUnit(unit))
  const ownStrength = ownUnits.reduce((sum, unit) => sum + unit.strength, 0)
  const enemyStrength = enemyUnits.reduce((sum, unit) => sum + unit.strength, 0)

  const leaderStrengthDelta = ownLeaderStrength - enemyLeaderStrength
  const unitStrengthDelta = ownStrength - enemyStrength
  const unitCountDelta = ownUnits.length - enemyUnits.length
  const pressureDelta = eliminateUnitsMode
    ? computeEliminationPressureDelta(ownUnits, enemyUnits, heuristics)
    : computePressureDelta(projected, player, ownUnits, enemyUnits, heuristics)
  const tacticalDelta = computeImmediateTacticalDelta(projected, player, ownCombatants, enemyCombatants, heuristics)
  const opponentHistoryRisk = computeOpponentHistoryRisk(projected, player, ownCombatants, enemyCombatants, heuristics)
  const chainLightningOpportunity = computeChainLightningPlanningBonus(state, projected, player, heuristics)
  const queueTimingRisk = computeQueueTimingRisk(state, player, heuristics)

  const score =
    leaderStrengthDelta * heuristics.scoring.leaderStrengthDeltaWeight +
    unitStrengthDelta * heuristics.scoring.unitStrengthDeltaWeight +
    unitCountDelta * heuristics.scoring.unitCountDeltaWeight +
    pressureDelta * heuristics.scoring.pressureDeltaWeight +
    tacticalDelta * heuristics.scoring.tacticalDeltaWeight +
    opponentHistoryRisk * heuristics.scoring.opponentHistoryRiskWeight +
    chainLightningOpportunity * heuristics.scoring.chainLightningOpportunityWeight +
    queueTimingRisk * heuristics.scoring.queueTimingRiskWeight +
    deterministicJitter(state, player)

  evaluationCache?.set(cacheKey, score)
  return score
}

function computePressureDelta(
  state: GameState,
  player: PlayerId,
  ownUnits: Unit[],
  enemyUnits: Unit[],
  heuristics: BotHeuristics
): number {
  const opponent: PlayerId = player === 0 ? 1 : 0
  const ownLeader = state.units[`leader-${player}`]
  const enemyLeader = state.units[`leader-${opponent}`]
  if (!ownLeader || !enemyLeader) return 0

  const ownPressure = ownUnits.reduce((sum, unit) => {
    const dist = hexDistance(unit.pos, enemyLeader.pos)
    return sum + Math.max(0, heuristics.pressure.distancePressureWindow - dist)
  }, 0)
  const enemyPressure = enemyUnits.reduce((sum, unit) => {
    const dist = hexDistance(unit.pos, ownLeader.pos)
    return sum + Math.max(0, heuristics.pressure.distancePressureWindow - dist)
  }, 0)
  return ownPressure - enemyPressure
}

function computeEliminationPressureDelta(ownUnits: Unit[], enemyUnits: Unit[], heuristics: BotHeuristics): number {
  if (ownUnits.length === 0 || enemyUnits.length === 0) return 0

  const ownPressure = ownUnits.reduce((sum, unit) => {
    const nearestEnemyDistance = enemyUnits.reduce((nearest, enemy) => {
      return Math.min(nearest, hexDistance(unit.pos, enemy.pos))
    }, Number.MAX_SAFE_INTEGER)
    return sum + Math.max(0, heuristics.pressure.distancePressureWindow - nearestEnemyDistance)
  }, 0)

  const enemyPressure = enemyUnits.reduce((sum, unit) => {
    const nearestOwnDistance = ownUnits.reduce((nearest, own) => {
      return Math.min(nearest, hexDistance(unit.pos, own.pos))
    }, Number.MAX_SAFE_INTEGER)
    return sum + Math.max(0, heuristics.pressure.distancePressureWindow - nearestOwnDistance)
  }, 0)

  return ownPressure - enemyPressure
}

function computeImmediateTacticalDelta(
  state: GameState,
  player: PlayerId,
  ownUnits: Unit[],
  enemyUnits: Unit[],
  heuristics: BotHeuristics
): number {
  const opponent: PlayerId = player === 0 ? 1 : 0
  let ownTactical = 0
  let enemyTactical = 0

  ownUnits.forEach((unit) => {
    ownTactical += countAdjacentEnemies(state, unit.pos, opponent) * heuristics.tactical.adjacentEnemyWeight
    if (hasEnemyInFacingRay(state, unit, opponent)) ownTactical += heuristics.tactical.facingRayThreatWeight
  })

  enemyUnits.forEach((unit) => {
    enemyTactical += countAdjacentEnemies(state, unit.pos, player) * heuristics.tactical.adjacentEnemyWeight
    if (hasEnemyInFacingRay(state, unit, player)) enemyTactical += heuristics.tactical.facingRayThreatWeight
  })

  return ownTactical - enemyTactical
}

function computeOpponentHistoryRisk(
  state: GameState,
  player: PlayerId,
  ownUnits: Unit[],
  enemyUnits: Unit[],
  heuristics: BotHeuristics
): number {
  if (state.settings.victoryCondition === 'eliminate_units') return 0
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
    if (!first || first.owner !== player || !isCombatUnit(first)) return sum
    return sum + 1
  }, 0)

  const ownLeader = state.units[`leader-${player}`]
  const leaderRayExposure = ownLeader
    ? enemyUnits.reduce((sum, unit) => {
        return sum + (isHexInFacingRay(state, unit.pos, unit.facing, ownLeader.pos) ? 1 : 0)
      }, 0)
    : 0

  const adjacencyExposure = ownUnits.reduce((sum, unit) => {
    return sum + countAdjacentEnemies(state, unit.pos, opponent)
  }, 0)

  const clusterExposure = ownUnits.reduce((sum, unit) => {
    return sum + countAdjacentFriendlies(state, unit.pos, player)
  }, 0)

  const fragileUnits = ownUnits.reduce(
    (sum, unit) => sum + (unit.strength <= heuristics.history.fragileUnitThreshold ? 1 : 0),
    0
  )

  const arrowLikelihood = cardHistoryLikelihood(counts, revealedCount, 'attack_arrow', heuristics.history.priors.attack_arrow)
  const lineLikelihood = cardHistoryLikelihood(counts, revealedCount, 'attack_line', heuristics.history.priors.attack_line)
  const cleaveLikelihood = cardHistoryLikelihood(
    counts,
    revealedCount,
    'attack_fwd_lr',
    heuristics.history.priors.attack_fwd_lr
  )
  const lightningLikelihood = cardHistoryLikelihood(
    counts,
    revealedCount,
    'spell_lightning',
    heuristics.history.priors.spell_lightning
  )
  const meteorLikelihood = cardHistoryLikelihood(
    counts,
    revealedCount,
    'spell_meteor',
    heuristics.history.priors.spell_meteor
  )

  return (
    arrowLikelihood * (rayExposure + leaderRayExposure * heuristics.history.arrowLeaderRayScale) +
    lineLikelihood * (rayExposure * heuristics.history.lineRayScale + leaderRayExposure) +
    cleaveLikelihood * adjacencyExposure * heuristics.history.cleaveAdjacencyScale +
    lightningLikelihood * fragileUnits * heuristics.history.lightningFragileScale +
    meteorLikelihood *
      (clusterExposure * heuristics.history.meteorClusterScale +
        leaderRayExposure * heuristics.history.meteorLeaderRayScale)
  )
}

type ChainLightningOpportunity = {
  adjacentTargets: number
  reachableTargets: number
  fragileTargets: number
  leaderTargets: number
}

function computeChainLightningPlanningBonus(
  planningState: GameState,
  projected: GameState,
  player: PlayerId,
  heuristics: BotHeuristics
): number {
  let bonus = 0
  planningState.players[player].orders.forEach((order) => {
    if (order.defId !== 'attack_chain_lightning') return
    const caster = resolveFriendlyUnitByRef(projected, player, order.params.unitId)
    if (!caster) return
    const opportunity = evaluateChainLightningOpportunity(projected, player, caster)
    if (opportunity.reachableTargets <= 0) return
    const playChance = computeChainLightningPlayChance(opportunity, heuristics)
    const roll = deterministicChainLightningRoll(planningState, player, order)
    if (roll > playChance) return
    bonus += computeChainLightningOpportunityValue(opportunity)
  })
  return bonus
}

function resolveFriendlyUnitByRef(
  state: GameState,
  player: PlayerId,
  unitRef: string | undefined
): Unit | null {
  if (!unitRef) return null
  if (!unitRef.startsWith('planned:')) {
    const unit = state.units[unitRef]
    if (!unit || unit.owner !== player) return null
    if (unit.kind !== 'unit' && unit.kind !== 'leader') return null
    return unit
  }

  const rawRef = unitRef.replace('planned:', '')
  const separator = rawRef.indexOf(':')
  const orderId = separator === -1 ? rawRef : rawRef.slice(0, separator)
  const mappedId = state.spawnedByOrder[rawRef] ?? state.spawnedByOrder[orderId]
  if (!mappedId) return null
  const unit = state.units[mappedId]
  if (!unit || unit.owner !== player) return null
  if (unit.kind !== 'unit' && unit.kind !== 'leader') return null
  return unit
}

function evaluateChainLightningOpportunity(
  state: GameState,
  player: PlayerId,
  caster: Unit
): ChainLightningOpportunity {
  const visited = new Set<string>()
  const queue: Unit[] = []
  let queueIndex = 0
  let adjacentTargets = 0

  DIRECTIONS.forEach((direction) => {
    const target = getUnitAt(state, neighbor(caster.pos, direction))
    if (!target || target.owner === player) return
    if (!canCardTargetUnit('attack_chain_lightning', target)) return
    if (visited.has(target.id)) return
    visited.add(target.id)
    queue.push(target)
    adjacentTargets += 1
  })

  while (queueIndex < queue.length) {
    const current = queue[queueIndex]
    queueIndex += 1
    DIRECTIONS.forEach((direction) => {
      const target = getUnitAt(state, neighbor(current.pos, direction))
      if (!target || target.owner === player) return
      if (!canCardTargetUnit('attack_chain_lightning', target)) return
      if (visited.has(target.id)) return
      visited.add(target.id)
      queue.push(target)
    })
  }

  let fragileTargets = 0
  let leaderTargets = 0
  visited.forEach((targetId) => {
    const target = state.units[targetId]
    if (!target) return
    if (target.strength <= 2) fragileTargets += 1
    if (target.kind === 'leader') leaderTargets += 1
  })

  return {
    adjacentTargets,
    reachableTargets: visited.size,
    fragileTargets,
    leaderTargets,
  }
}

function computeChainLightningPlayChance(opportunity: ChainLightningOpportunity, heuristics: BotHeuristics): number {
  const chainLightning = heuristics.chainLightning
  if (opportunity.reachableTargets <= 0) return 0
  if (
    opportunity.reachableTargets >= chainLightning.guaranteedReachableTargets ||
    opportunity.fragileTargets >= chainLightning.guaranteedFragileTargets
  ) {
    return 1
  }

  let chance =
    chainLightning.basePlayChance +
    Math.max(0, opportunity.adjacentTargets - 1) * chainLightning.adjacentTargetChance +
    Math.max(0, opportunity.reachableTargets - 1) * chainLightning.reachableTargetChance +
    opportunity.fragileTargets * chainLightning.fragileTargetChance +
    opportunity.leaderTargets * chainLightning.leaderTargetChance

  if (opportunity.reachableTargets === 1 && opportunity.fragileTargets === 0 && opportunity.leaderTargets === 0) {
    chance *= chainLightning.isolatedDurableChanceScale
  }

  return clamp(chance, chainLightning.minPlayChance, chainLightning.maxPlayChance)
}

function deterministicChainLightningRoll(state: GameState, player: PlayerId, order: Order): number {
  const seed = `${state.turn}|${player}|${order.id}|${order.cardId}|${serializeParams(order.params)}|${buildOrderSignature(state, player)}`
  return (hashString(seed) % 10_000) / 10_000
}

function computeChainLightningOpportunityValue(opportunity: ChainLightningOpportunity): number {
  const extraReach = Math.max(0, opportunity.reachableTargets - 1)
  return (
    opportunity.reachableTargets * 0.7 +
    extraReach * 0.45 +
    opportunity.fragileTargets * 0.9 +
    opportunity.leaderTargets * 1.4
  )
}

function computeQueueTimingRisk(state: GameState, player: PlayerId, heuristics: BotHeuristics): number {
  const orders = state.players[player].orders
  if (orders.length <= 1) return 0
  const slowTailOrderIds = getSlowTailOrderIds(state, orders)
  let risk = 0

  orders.forEach((order, index) => {
    const sensitivity = getOrderTimingSensitivity(order)
    if (sensitivity <= 0) return

    let orderRisk = sensitivity * index * heuristics.timing.lateOrderIndexRisk
    if (slowTailOrderIds.has(order.id)) {
      orderRisk += sensitivity * heuristics.timing.slowTailExtraRisk
    }
    if (isPriorityOrder(state, order)) {
      orderRisk *= heuristics.timing.priorityRiskScale
    }
    risk += orderRisk
  })

  return risk
}

function getOrderTimingSensitivity(order: Order): number {
  const def = CARD_DEFS[order.defId]
  if (order.defId === 'spell_invest' || order.defId === 'spell_divination') return 0.02
  if (def.type === 'reinforcement') return 0.06
  if (def.type === 'movement') return order.defId === 'move_tandem' ? 0.16 : 0.1
  if (order.defId === 'attack_blade_dance') return 0.38
  if (
    order.defId === 'attack_coordinated' ||
    order.defId === 'attack_whirlwind' ||
    order.defId === 'attack_chain_lightning' ||
    order.defId === 'spell_meteor'
  ) {
    return 0.45
  }
  if (def.type === 'spell') return 0.95
  if (def.type === 'attack') return 0.85
  return 0.2
}

function hasActivePlayerModifier(state: GameState, player: PlayerId, modifierType: GameState['players'][number]['modifiers'][number]['type']): boolean {
  return state.players[player].modifiers.some((modifier) => {
    if (modifier.type !== modifierType) return false
    return modifier.turnsRemaining === 'indefinite' || modifier.turnsRemaining > 0
  })
}

function getEffectiveOrderKeywords(state: GameState, order: Order): { priority: boolean; slow: boolean } {
  const baseKeywords = CARD_DEFS[order.defId].keywords ?? []
  const basePriority = baseKeywords.includes('Priority')
  const baseSlow = baseKeywords.includes('Slow')
  const addedSlow = hasActivePlayerModifier(state, order.player, 'brainFreeze')
  const priority = basePriority
  const slow = baseSlow || addedSlow
  if (priority && slow) return { priority: false, slow: false }
  return { priority, slow }
}

function isPriorityOrder(state: GameState, order: Order): boolean {
  return getEffectiveOrderKeywords(state, order).priority
}

function isSlowOrder(state: GameState, order: Order): boolean {
  return getEffectiveOrderKeywords(state, order).slow
}

function getSlowTailOrderIds(state: GameState, orders: Order[]): Set<string> {
  const slowTail = new Set<string>()
  let seenSlow = false
  orders.forEach((order) => {
    if (!seenSlow && isSlowOrder(state, order)) {
      seenSlow = true
    }
    if (seenSlow) {
      slowTail.add(order.id)
    }
  })
  return slowTail
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
    if (!target || target.owner !== enemy || !isCombatUnit(target)) return
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
    if (!target || target.owner !== owner || !isCombatUnit(target)) return
    count += 1
  })
  return count
}

function isCombatUnit(unit: Unit): boolean {
  return unit.kind === 'unit' || unit.kind === 'leader'
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
    params.tile2 ? `${params.tile2.q},${params.tile2.r}` : '',
    params.tile3 ? `${params.tile3.q},${params.tile3.r}` : '',
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
  // Enemy traps are hidden information; bot planning should only see its own traps.
  snapshot.traps = snapshot.traps.filter((trap) => trap.owner === player)
  return snapshot
}

function cloneGameState(source: GameState): GameState {
  const units: GameState['units'] = {}
  Object.entries(source.units).forEach(([unitId, unit]) => {
    units[unitId] = {
      ...unit,
      pos: { ...unit.pos },
      modifiers: unit.modifiers.map((modifier) => ({ ...modifier })),
    }
  })

  const players: GameState['players'] = [
    {
      deck: source.players[0].deck.map((card) => ({ ...card })),
      hand: source.players[0].hand.map((card) => ({ ...card })),
      discard: source.players[0].discard.map((card) => ({ ...card })),
      orders: source.players[0].orders.map(cloneOrder),
      modifiers: source.players[0].modifiers.map((modifier) => ({ ...modifier })),
    },
    {
      deck: source.players[1].deck.map((card) => ({ ...card })),
      hand: source.players[1].hand.map((card) => ({ ...card })),
      discard: source.players[1].discard.map((card) => ({ ...card })),
      orders: source.players[1].orders.map(cloneOrder),
      modifiers: source.players[1].modifiers.map((modifier) => ({ ...modifier })),
    },
  ]

  return {
    boardRows: source.boardRows,
    boardCols: source.boardCols,
    tiles: source.tiles.map((tile) => ({ ...tile })),
    units,
    traps: source.traps.map((trap) => ({ ...trap, pos: { ...trap.pos } })),
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
    playerClasses: source.playerClasses
      ? [...source.playerClasses] as [PlayerClassId | null, PlayerClassId | null]
      : undefined,
    leaderMovedLastTurn: source.leaderMovedLastTurn ? [...source.leaderMovedLastTurn] as [boolean, boolean] : undefined,
    turnStartLeaderPositions: source.turnStartLeaderPositions
      ? [{ ...source.turnStartLeaderPositions[0] }, { ...source.turnStartLeaderPositions[1] }]
      : undefined,
    archmageBonusApplied: source.archmageBonusApplied ? [...source.archmageBonusApplied] as [number, number] : undefined,
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
    tile2: params.tile2 ? { ...params.tile2 } : undefined,
    tile3: params.tile3 ? { ...params.tile3 } : undefined,
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
  if (hasActiveUnitModifier(unit, 'cannotMove')) {
    return { ...unit.pos }
  }
  const maxDistance = hasActiveUnitModifier(unit, 'slow') ? Math.min(distance, 1) : distance
  let current = { ...unit.pos }
  for (let step = 0; step < maxDistance; step += 1) {
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

function hasActiveUnitModifier(unit: Unit, modifierType: Unit['modifiers'][number]['type']): boolean {
  return unit.modifiers.some((modifier) => {
    if (modifier.type !== modifierType) return false
    return modifier.turnsRemaining === 'indefinite' || modifier.turnsRemaining > 0
  })
}
