import { readFileSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import {
  buildBotPlan,
  resolveBotPlannerConfig,
  type BotPlannerConfig,
  type BotPlannerOverrides,
} from '../../src/engine/bot'
import { generateClusteredBotDeck } from '../../src/engine/botDeck'
import { DEFAULT_SETTINGS, createGameState, planOrder, resolveAllActions, startActionPhase } from '../../src/engine/game'
import type { CardDefId, GameSettings, PlayerId, VictoryCondition } from '../../src/engine/types'

type TuningOptions = {
  generations: number
  population: number
  survivors: number
  roundsPerPair: number
  progressEvery: number
  maxTurns: number
  thinkTimeMs: number
  mutationRate: number
  mutationScale: number
  freshCandidates: number
  printTop: number
  seed: string
  outPath?: string
  seedConfigPath?: string
  deckSize: number
  maxCopies: number
  drawPerTurn: number
  actionBudgetP1: number
  actionBudgetP2: number
  boardRows: number
  boardCols: number
  leaderStrength: number
  victoryCondition?: VictoryCondition
}

type CandidateRecord = {
  id: string
  config: BotPlannerConfig
  summary?: CandidateSummary
}

type CandidateSummary = {
  points: number
  wins: number
  losses: number
  draws: number
  games: number
}

type Scenario = {
  deckP1: CardDefId[]
  deckP2: CardDefId[]
  matchSeed: number
}

type HeadToHeadSummary = CandidateSummary

type SimulatedMatch = {
  winner: PlayerId | null
  endReason: string
}

type ProgressTracker = {
  generation: number
  totalGenerations: number
  totalMatchups: number
  totalGames: number
  completedMatchups: number
  completedGames: number
  progressEvery: number
  startedAtMs: number
  lastPrintedGames: number
  lastMessageLength: number
}

type TunableParameter = {
  key: string
  kind: 'int' | 'float'
  min: number
  max: number
  step: number
}

const TUNING_SPACE: TunableParameter[] = [
  { key: 'beamWidth', kind: 'int', min: 4, max: 18, step: 2 },
  { key: 'maxCandidatesPerCard', kind: 'int', min: 6, max: 24, step: 3 },
  { key: 'heuristics.scoring.leaderStrengthDeltaWeight', kind: 'float', min: 150, max: 900, step: 60 },
  { key: 'heuristics.scoring.unitStrengthDeltaWeight', kind: 'float', min: 10, max: 90, step: 8 },
  { key: 'heuristics.scoring.unitCountDeltaWeight', kind: 'float', min: 0, max: 50, step: 5 },
  { key: 'heuristics.scoring.pressureDeltaWeight', kind: 'float', min: -5, max: 25, step: 2.5 },
  { key: 'heuristics.scoring.tacticalDeltaWeight', kind: 'float', min: -5, max: 25, step: 2.5 },
  { key: 'heuristics.scoring.opponentHistoryRiskWeight', kind: 'float', min: -40, max: 20, step: 4 },
  { key: 'heuristics.scoring.chainLightningOpportunityWeight', kind: 'float', min: 0, max: 40, step: 4 },
  { key: 'heuristics.scoring.queueTimingRiskWeight', kind: 'float', min: -40, max: 5, step: 4 },
  { key: 'heuristics.pressure.distancePressureWindow', kind: 'int', min: 4, max: 16, step: 1 },
  { key: 'heuristics.tactical.adjacentEnemyWeight', kind: 'float', min: 0, max: 8, step: 0.6 },
  { key: 'heuristics.tactical.facingRayThreatWeight', kind: 'float', min: 0, max: 8, step: 0.6 },
  { key: 'heuristics.history.fragileUnitThreshold', kind: 'int', min: 1, max: 4, step: 1 },
  { key: 'heuristics.history.arrowLeaderRayScale', kind: 'float', min: 0, max: 2, step: 0.15 },
  { key: 'heuristics.history.lineRayScale', kind: 'float', min: 0, max: 1.5, step: 0.12 },
  { key: 'heuristics.history.cleaveAdjacencyScale', kind: 'float', min: 0, max: 1.2, step: 0.1 },
  { key: 'heuristics.history.lightningFragileScale', kind: 'float', min: 0, max: 1.2, step: 0.1 },
  { key: 'heuristics.history.meteorClusterScale', kind: 'float', min: 0, max: 1.2, step: 0.1 },
  { key: 'heuristics.history.meteorLeaderRayScale', kind: 'float', min: 0, max: 1, step: 0.08 },
  { key: 'heuristics.chainLightning.basePlayChance', kind: 'float', min: 0, max: 0.6, step: 0.04 },
  { key: 'heuristics.chainLightning.adjacentTargetChance', kind: 'float', min: 0, max: 0.25, step: 0.02 },
  { key: 'heuristics.chainLightning.reachableTargetChance', kind: 'float', min: 0, max: 0.25, step: 0.02 },
  { key: 'heuristics.chainLightning.fragileTargetChance', kind: 'float', min: 0, max: 0.35, step: 0.03 },
  { key: 'heuristics.chainLightning.leaderTargetChance', kind: 'float', min: 0, max: 0.35, step: 0.03 },
  { key: 'heuristics.chainLightning.isolatedDurableChanceScale', kind: 'float', min: 0, max: 1, step: 0.08 },
  { key: 'heuristics.chainLightning.guaranteedReachableTargets', kind: 'int', min: 2, max: 6, step: 1 },
  { key: 'heuristics.chainLightning.guaranteedFragileTargets', kind: 'int', min: 1, max: 4, step: 1 },
  { key: 'heuristics.timing.lateOrderIndexRisk', kind: 'float', min: 0, max: 0.5, step: 0.04 },
  { key: 'heuristics.timing.slowTailExtraRisk', kind: 'float', min: 0, max: 2, step: 0.12 },
  { key: 'heuristics.timing.priorityRiskScale', kind: 'float', min: 0.2, max: 1.2, step: 0.08 },
]

const options = parseOptions(process.argv.slice(2))
const settings = buildSettings(options)
const seedConfig = loadSeedConfig(options.seedConfigPath)
const baseConfig = resolveBotPlannerConfig({
  ...seedConfig,
  thinkTimeMs: options.thinkTimeMs,
})
const rng = createRng(hashString(options.seed))

let population = buildInitialPopulation(baseConfig, options, rng)
let bestOverall: CandidateRecord = {
  id: 'baseline',
  config: baseConfig,
  summary: { points: 0, wins: 0, losses: 0, draws: 0, games: 0 },
}

for (let generation = 0; generation < options.generations; generation += 1) {
  const scenarios = buildScenarios(settings, options, generation)
  population = evaluatePopulation(population, settings, scenarios, options, generation + 1)

  const generationBest = population[0]
  if (compareCandidates(generationBest, bestOverall) < 0) {
    bestOverall = cloneCandidate(generationBest)
  }

  printGenerationSummary(generation + 1, options.generations, population, options.printTop)
  if (generation === options.generations - 1) break
  population = breedNextGeneration(population, baseConfig, options, rng, generation + 1)
}

process.stdout.write('\nBest overall candidate:\n')
process.stdout.write(`${formatCandidateLine(bestOverall)}\n`)
process.stdout.write(`${formatConfigHighlights(bestOverall.config)}\n`)

if (options.outPath) {
  const outputPath = resolvePath(process.cwd(), options.outPath)
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        seed: options.seed,
        options: {
          generations: options.generations,
          population: options.population,
          survivors: options.survivors,
          roundsPerPair: options.roundsPerPair,
          mutationRate: options.mutationRate,
          mutationScale: options.mutationScale,
          freshCandidates: options.freshCandidates,
          maxTurns: options.maxTurns,
          thinkTimeMs: options.thinkTimeMs,
          settings,
        },
        best: {
          id: bestOverall.id,
          summary: bestOverall.summary,
          config: bestOverall.config,
        },
      },
      null,
      2
    ),
    'utf8'
  )
  process.stdout.write(`Saved best config to ${outputPath}\n`)
}

function buildInitialPopulation(
  baseConfig: BotPlannerConfig,
  options: TuningOptions,
  rng: () => number
): CandidateRecord[] {
  const population: CandidateRecord[] = []
  const seen = new Set<string>()
  let attempts = 0
  addCandidate(population, seen, {
    id: 'g0-c0',
    config: cloneConfig(baseConfig),
  })

  while (population.length < options.population && attempts < options.population * 200) {
    attempts += 1
    const candidate: CandidateRecord = {
      id: `g0-c${population.length}`,
      config: mutateConfig(baseConfig, options, rng),
    }
    addCandidate(population, seen, candidate)
  }

  if (population.length < options.population) {
    throw new Error('Failed to generate a unique initial tuning population.')
  }

  return population
}

function evaluatePopulation(
  population: CandidateRecord[],
  settings: GameSettings,
  scenarios: Scenario[],
  options: TuningOptions,
  generation: number
): CandidateRecord[] {
  const totals = new Map<string, CandidateSummary>()
  population.forEach((candidate) => {
    totals.set(candidate.id, { points: 0, wins: 0, losses: 0, draws: 0, games: 0 })
  })

  const tracker = createProgressTracker(generation, options.generations, population.length, scenarios.length, options.progressEvery)
  printEvaluationStart(tracker)

  for (let first = 0; first < population.length; first += 1) {
    for (let second = first + 1; second < population.length; second += 1) {
      const left = population[first]
      const right = population[second]
      const summary = runHeadToHead(left.config, right.config, settings, scenarios, options.maxTurns, () => {
        tracker.completedGames += 1
        printEvaluationProgress(tracker)
      })
      mergeSummary(totals.get(left.id), summary)
      mergeSummary(totals.get(right.id), invertSummary(summary))
      tracker.completedMatchups += 1
      printEvaluationProgress(tracker, true)
    }
  }

  finishEvaluationProgress(tracker)

  const ranked = population.map((candidate) => ({
    ...candidate,
    summary: totals.get(candidate.id) ?? { points: 0, wins: 0, losses: 0, draws: 0, games: 0 },
  }))
  ranked.sort(compareCandidates)
  return ranked
}

function runHeadToHead(
  configA: BotPlannerConfig,
  configB: BotPlannerConfig,
  settings: GameSettings,
  scenarios: Scenario[],
  maxTurns: number,
  onGameComplete?: () => void
): HeadToHeadSummary {
  const summary: HeadToHeadSummary = { points: 0, wins: 0, losses: 0, draws: 0, games: 0 }

  scenarios.forEach((scenario, index) => {
    const forward = runBotMatch(settings, scenario.deckP1, scenario.deckP2, configA, configB, maxTurns, scenario.matchSeed)
    applyMatchResult(summary, forward.winner, 0)
    onGameComplete?.()

    const reverse = runBotMatch(
      settings,
      scenario.deckP2,
      scenario.deckP1,
      configB,
      configA,
      maxTurns,
      scenario.matchSeed + index + 1
    )
    applyMatchResult(summary, reverse.winner, 1)
    onGameComplete?.()
  })

  return summary
}

function runBotMatch(
  settings: GameSettings,
  deckP1: CardDefId[],
  deckP2: CardDefId[],
  botP1: BotPlannerConfig,
  botP2: BotPlannerConfig,
  maxTurns: number,
  seed: number
): SimulatedMatch {
  return withSeededRandom(seed, () => {
    const state = createGameState(settings, { p1: deckP1, p2: deckP2 })

    while (state.winner === null && state.turn <= maxTurns) {
      if (state.phase !== 'planning') {
        resolveAllActions(state)
        continue
      }

      runPlanningForSeat(state, 0, botP1)
      runPlanningForSeat(state, 1, botP2)

      state.ready = [true, true]
      startActionPhase(state)
      resolveAllActions(state)
    }

    return {
      winner: state.winner,
      endReason: state.winner === null ? 'turn_limit' : 'victory',
    }
  })
}

function runPlanningForSeat(state: ReturnType<typeof createGameState>, seat: PlayerId, config: BotPlannerConfig): void {
  const plan = buildBotPlan(state, seat, config)
  for (const order of plan.orders) {
    const queued = planOrder(state, seat, order.cardId, order.params)
    if (!queued) break
  }
}

function breedNextGeneration(
  ranked: CandidateRecord[],
  baseConfig: BotPlannerConfig,
  options: TuningOptions,
  rng: () => number,
  generation: number
): CandidateRecord[] {
  const next: CandidateRecord[] = []
  const seen = new Set<string>()
  const survivors = ranked.slice(0, options.survivors)
  let attempts = 0

  survivors.forEach((candidate, index) => {
    addCandidate(next, seen, {
      id: `g${generation}-elite${index}`,
      config: cloneConfig(candidate.config),
    })
  })

  const freshCount = Math.min(options.freshCandidates, Math.max(0, options.population - next.length))
  while (next.length < options.population && attempts < options.population * 200) {
    attempts += 1
    const shouldUseBaseline = next.length < survivors.length + freshCount
    const parentConfig = shouldUseBaseline ? baseConfig : pickParent(survivors, rng).config
    addCandidate(next, seen, {
      id: `g${generation}-c${next.length}`,
      config: mutateConfig(parentConfig, options, rng),
    })
  }

  if (next.length < options.population) {
    throw new Error('Failed to generate a unique next tuning generation.')
  }

  return next
}

function buildScenarios(settings: GameSettings, options: TuningOptions, generation: number): Scenario[] {
  const scenarios: Scenario[] = []
  for (let round = 0; round < options.roundsPerPair; round += 1) {
    const scenarioSeed = hashString(`${options.seed}|${generation}|${round}`)
    scenarios.push({
      deckP1: withSeededRandom(scenarioSeed ^ 0x9e3779b9, () => generateClusteredBotDeck(settings)),
      deckP2: withSeededRandom(scenarioSeed ^ 0x85ebca6b, () => generateClusteredBotDeck(settings)),
      matchSeed: scenarioSeed ^ 0xc2b2ae35,
    })
  }
  return scenarios
}

function buildSettings(options: TuningOptions): GameSettings {
  return {
    boardRows: options.boardRows,
    boardCols: options.boardCols,
    leaderStrength: options.leaderStrength,
    deckSize: options.deckSize,
    drawPerTurn: options.drawPerTurn,
    maxCopies: options.maxCopies,
    actionBudgetP1: options.actionBudgetP1,
    actionBudgetP2: options.actionBudgetP2,
    victoryCondition: options.victoryCondition,
  }
}

function mutateConfig(base: BotPlannerConfig, options: TuningOptions, rng: () => number): BotPlannerConfig {
  const draft = cloneConfig(base)
  let changed = 0

  TUNING_SPACE.forEach((parameter) => {
    if (rng() > options.mutationRate) return
    mutateParameter(draft, parameter, options.mutationScale, rng)
    changed += 1
  })

  if (changed === 0) {
    const parameter = TUNING_SPACE[Math.floor(rng() * TUNING_SPACE.length)]
    mutateParameter(draft, parameter, options.mutationScale, rng)
  }

  return resolveBotPlannerConfig(draft)
}

function mutateParameter(
  config: BotPlannerConfig,
  parameter: TunableParameter,
  mutationScale: number,
  rng: () => number
): void {
  const current = getNumericValue(config, parameter.key)
  const centered = (rng() + rng() + rng()) / 3 - 0.5
  let next = current + centered * 2 * parameter.step * mutationScale
  if (parameter.kind === 'int') {
    next = Math.round(next)
  }
  next = clamp(next, parameter.min, parameter.max)
  setNumericValue(config, parameter.key, next)
}

function pickParent(candidates: CandidateRecord[], rng: () => number): CandidateRecord {
  if (candidates.length === 1) return candidates[0]
  const totalWeight = candidates.reduce((sum, _candidate, index) => sum + (candidates.length - index), 0)
  let roll = rng() * totalWeight
  for (let index = 0; index < candidates.length; index += 1) {
    roll -= candidates.length - index
    if (roll <= 0) return candidates[index]
  }
  return candidates[candidates.length - 1]
}

function getNumericValue(config: BotPlannerConfig, key: string): number {
  const value = key.split('.').reduce<unknown>((current, segment) => {
    if (!isObject(current)) {
      throw new Error(`Cannot read numeric tuning key: ${key}`)
    }
    return current[segment]
  }, config)
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Tuning key ${key} is not numeric.`)
  }
  return value
}

function setNumericValue(config: BotPlannerConfig, key: string, value: number): void {
  const segments = key.split('.')
  const lastSegment = segments.pop()
  if (!lastSegment) return

  let current: Record<string, unknown> = config as unknown as Record<string, unknown>
  segments.forEach((segment) => {
    const next = current[segment]
    if (!isObject(next)) {
      throw new Error(`Cannot set numeric tuning key: ${key}`)
    }
    current = next
  })
  current[lastSegment] = value
}

function applyMatchResult(summary: CandidateSummary, winner: PlayerId | null, seatOfCandidate: PlayerId): void {
  summary.games += 1
  if (winner === null) {
    summary.draws += 1
    summary.points += 0.5
    return
  }
  if (winner === seatOfCandidate) {
    summary.wins += 1
    summary.points += 1
    return
  }
  summary.losses += 1
}

function invertSummary(summary: CandidateSummary): CandidateSummary {
  return {
    points: summary.games - summary.points,
    wins: summary.losses,
    losses: summary.wins,
    draws: summary.draws,
    games: summary.games,
  }
}

function mergeSummary(target: CandidateSummary | undefined, source: CandidateSummary): void {
  if (!target) return
  target.points += source.points
  target.wins += source.wins
  target.losses += source.losses
  target.draws += source.draws
  target.games += source.games
}

function compareCandidates(left: CandidateRecord, right: CandidateRecord): number {
  const leftSummary = left.summary ?? { points: 0, wins: 0, losses: 0, draws: 0, games: 0 }
  const rightSummary = right.summary ?? { points: 0, wins: 0, losses: 0, draws: 0, games: 0 }

  if (rightSummary.points !== leftSummary.points) return rightSummary.points - leftSummary.points
  if (rightSummary.wins !== leftSummary.wins) return rightSummary.wins - leftSummary.wins
  if (leftSummary.losses !== rightSummary.losses) return leftSummary.losses - rightSummary.losses
  return left.id.localeCompare(right.id)
}

function addCandidate(population: CandidateRecord[], seen: Set<string>, candidate: CandidateRecord): void {
  const signature = JSON.stringify(candidate.config)
  if (seen.has(signature)) return
  seen.add(signature)
  population.push(candidate)
}

function cloneCandidate(candidate: CandidateRecord): CandidateRecord {
  return {
    id: candidate.id,
    config: cloneConfig(candidate.config),
    summary: candidate.summary ? { ...candidate.summary } : undefined,
  }
}

function cloneConfig(config: BotPlannerConfig): BotPlannerConfig {
  return JSON.parse(JSON.stringify(config)) as BotPlannerConfig
}

function formatCandidateLine(candidate: CandidateRecord): string {
  const summary = candidate.summary ?? { points: 0, wins: 0, losses: 0, draws: 0, games: 0 }
  const rate = summary.games > 0 ? ((summary.points / summary.games) * 100).toFixed(1) : '0.0'
  return `${candidate.id} | ${summary.points.toFixed(1)} pts | ${summary.wins}-${summary.losses}-${summary.draws} | ${rate}%`
}

function formatConfigHighlights(config: BotPlannerConfig): string {
  return [
    `beam=${config.beamWidth}`,
    `candidates=${config.maxCandidatesPerCard}`,
    `leader=${config.heuristics.scoring.leaderStrengthDeltaWeight.toFixed(1)}`,
    `unitStrength=${config.heuristics.scoring.unitStrengthDeltaWeight.toFixed(1)}`,
    `pressure=${config.heuristics.scoring.pressureDeltaWeight.toFixed(1)}`,
    `tactical=${config.heuristics.scoring.tacticalDeltaWeight.toFixed(1)}`,
    `history=${config.heuristics.scoring.opponentHistoryRiskWeight.toFixed(1)}`,
    `timing=${config.heuristics.scoring.queueTimingRiskWeight.toFixed(1)}`,
  ].join(' | ')
}

function createProgressTracker(
  generation: number,
  totalGenerations: number,
  populationSize: number,
  scenariosPerPair: number,
  progressEvery: number
): ProgressTracker {
  const totalMatchups = Math.max(0, (populationSize * (populationSize - 1)) / 2)
  return {
    generation,
    totalGenerations,
    totalMatchups,
    totalGames: totalMatchups * scenariosPerPair * 2,
    completedMatchups: 0,
    completedGames: 0,
    progressEvery: Math.max(1, progressEvery),
    startedAtMs: Date.now(),
    lastPrintedGames: 0,
    lastMessageLength: 0,
  }
}

function printEvaluationStart(tracker: ProgressTracker): void {
  process.stdout.write(
    `\nEvaluating generation ${tracker.generation}/${tracker.totalGenerations} | ` +
      `${tracker.totalMatchups} matchups | ${tracker.totalGames} games\n`
  )
}

function printEvaluationProgress(tracker: ProgressTracker, force = false): void {
  if (tracker.totalGames <= 0) return
  if (!process.stdout.isTTY) {
    if (!force && tracker.completedGames - tracker.lastPrintedGames < tracker.progressEvery) return
    if (force && tracker.completedGames === tracker.lastPrintedGames && tracker.completedGames < tracker.totalGames) return
  }

  const elapsedSeconds = Math.max(0.001, (Date.now() - tracker.startedAtMs) / 1000)
  const gamesPerSecond = tracker.completedGames / elapsedSeconds
  const percent = ((tracker.completedGames / tracker.totalGames) * 100).toFixed(1)
  const message =
    `Progress ${tracker.generation}/${tracker.totalGenerations} | ` +
    `matchups ${tracker.completedMatchups}/${tracker.totalMatchups} | ` +
    `games ${tracker.completedGames}/${tracker.totalGames} | ` +
    `${percent}% | ${gamesPerSecond.toFixed(2)} games/s`

  if (process.stdout.isTTY) {
    const padded = message.padEnd(tracker.lastMessageLength, ' ')
    tracker.lastMessageLength = padded.length
    process.stdout.write(`\r${padded}`)
  } else {
    tracker.lastPrintedGames = tracker.completedGames
    process.stdout.write(`${message}\n`)
  }
}

function finishEvaluationProgress(tracker: ProgressTracker): void {
  if (tracker.totalGames <= 0) return
  if (process.stdout.isTTY || tracker.completedGames !== tracker.lastPrintedGames) {
    printEvaluationProgress(tracker, true)
  }
  if (process.stdout.isTTY) {
    process.stdout.write('\n')
  }
}

function printGenerationSummary(
  generation: number,
  totalGenerations: number,
  ranked: CandidateRecord[],
  printTop: number
): void {
  process.stdout.write(`\nGeneration ${generation}/${totalGenerations}\n`)
  ranked.slice(0, printTop).forEach((candidate, index) => {
    process.stdout.write(`${index + 1}. ${formatCandidateLine(candidate)}\n`)
    process.stdout.write(`   ${formatConfigHighlights(candidate.config)}\n`)
  })
}

function loadSeedConfig(path: string | undefined): BotPlannerOverrides | undefined {
  if (!path) return undefined
  const absolutePath = resolvePath(process.cwd(), path)
  const raw = readFileSync(absolutePath, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (isObject(parsed) && isObject(parsed.best) && isObject(parsed.best.config)) {
    return parsed.best.config as BotPlannerOverrides
  }
  return parsed as BotPlannerOverrides
}

function withSeededRandom<T>(seed: number, action: () => T): T {
  const previousRandom = Math.random
  const seededRandom = createRng(seed)
  Math.random = seededRandom
  try {
    return action()
  } finally {
    Math.random = previousRandom
  }
}

function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function parseOptions(args: string[]): TuningOptions {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  const population = clamp(readInt(args, '--population', 10), 2, 24)
  const survivors = clamp(readInt(args, '--survivors', Math.max(2, Math.floor(population / 3))), 1, population - 1)

  return {
    generations: clamp(readInt(args, '--generations', 6), 1, 50),
    population,
    survivors,
    roundsPerPair: clamp(readInt(args, '--rounds-per-pair', 1), 1, 10),
    progressEvery: clamp(readInt(args, '--progress-every', 10), 1, 10_000),
    maxTurns: clamp(readInt(args, '--max-turns', 60), 1, 500),
    thinkTimeMs: clamp(readInt(args, '--think-ms', 12), 1, 500),
    mutationRate: clamp(readFloat(args, '--mutation-rate', 0.18), 0.01, 1),
    mutationScale: clamp(readFloat(args, '--mutation-scale', 1), 0.1, 5),
    freshCandidates: clamp(readInt(args, '--fresh-candidates', 1), 0, population - survivors),
    printTop: clamp(readInt(args, '--print-top', Math.min(5, population)), 1, population),
    seed: readString(args, '--seed') ?? 'bot-self-play',
    outPath: readString(args, '--out'),
    seedConfigPath: readString(args, '--seed-config'),
    deckSize: clamp(readInt(args, '--deck-size', DEFAULT_SETTINGS.deckSize), 5, 80),
    maxCopies: clamp(readInt(args, '--max-copies', DEFAULT_SETTINGS.maxCopies), 1, 10),
    drawPerTurn: clamp(readInt(args, '--draw-per-turn', DEFAULT_SETTINGS.drawPerTurn), 1, 20),
    actionBudgetP1: clamp(readInt(args, '--action-budget-p1', DEFAULT_SETTINGS.actionBudgetP1), 1, 10),
    actionBudgetP2: clamp(readInt(args, '--action-budget-p2', DEFAULT_SETTINGS.actionBudgetP2), 1, 10),
    boardRows: clamp(readInt(args, '--board-rows', DEFAULT_SETTINGS.boardRows), 4, 20),
    boardCols: clamp(readInt(args, '--board-cols', DEFAULT_SETTINGS.boardCols), 4, 20),
    leaderStrength: clamp(
      readInt(args, '--leader-strength', readInt(args, '--stronghold-strength', DEFAULT_SETTINGS.leaderStrength)),
      1,
      50
    ),
    victoryCondition: readVictoryCondition(args, '--victory-condition'),
  }
}

function printHelp(): void {
  process.stdout.write('Usage: npm run bot:tune -- [options]\n\n')
  process.stdout.write('Runs a seeded self-play tuning loop over bot planner parameters.\n\n')
  process.stdout.write('Options:\n')
  process.stdout.write('  --generations N          Number of evolutionary generations (default: 6)\n')
  process.stdout.write('  --population N           Candidates per generation (default: 10)\n')
  process.stdout.write('  --survivors N            Elites carried into the next generation\n')
  process.stdout.write('  --rounds-per-pair N      Mirrored scenario pairs per matchup (default: 1)\n')
  process.stdout.write('  --progress-every N       Non-interactive progress print interval in games (default: 10)\n')
  process.stdout.write('  --max-turns N            Turn cap before a draw (default: 60)\n')
  process.stdout.write('  --think-ms N             Shared think budget for every bot (default: 12)\n')
  process.stdout.write('  --mutation-rate F        Per-parameter mutation chance (default: 0.18)\n')
  process.stdout.write('  --mutation-scale F       Mutation step multiplier (default: 1.0)\n')
  process.stdout.write('  --fresh-candidates N     Fresh mutations from the seed config each generation\n')
  process.stdout.write('  --seed TEXT              Deterministic seed label\n')
  process.stdout.write('  --seed-config PATH       Start from a prior config JSON\n')
  process.stdout.write('  --out PATH               Write best config JSON to a file\n')
  process.stdout.write('  --victory-condition ID   leader | eliminate_units\n')
  process.stdout.write('  --deck-size N            Deck size for simulated matches\n')
  process.stdout.write('  --max-copies N           Max copies per card in generated decks\n')
  process.stdout.write('  --draw-per-turn N        Draw count per turn\n')
  process.stdout.write('  --action-budget-p1 N     Action budget for seat 0\n')
  process.stdout.write('  --action-budget-p2 N     Action budget for seat 1\n')
  process.stdout.write('  --board-rows N           Board rows\n')
  process.stdout.write('  --board-cols N           Board cols\n')
  process.stdout.write('  --leader-strength N     Leader strength\n')
}

function readVictoryCondition(args: string[], key: string): VictoryCondition | undefined {
  const raw = readString(args, key)
  if (raw === 'leader' || raw === 'eliminate_units') return raw
  return undefined
}

function readString(args: string[], key: string): string | undefined {
  const prefixed = `${key}=`
  const inline = args.find((arg) => arg.startsWith(prefixed))
  if (inline) return inline.slice(prefixed.length)
  const index = args.indexOf(key)
  if (index >= 0 && index + 1 < args.length) return args[index + 1]
  return undefined
}

function readInt(args: string[], key: string, fallback: number): number {
  const raw = readString(args, key)
  if (raw === undefined) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return fallback
  return value
}

function readFloat(args: string[], key: string, fallback: number): number {
  const raw = readString(args, key)
  if (raw === undefined) return fallback
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return fallback
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}
