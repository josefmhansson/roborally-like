import { randomBytes } from 'node:crypto'
import { buildBotPlan } from '../../src/engine/bot'
import { generateClusteredBotDeck } from '../../src/engine/botDeck'
import { createGameState, DEFAULT_SETTINGS, planOrder, resolveAllActions, startActionPhase } from '../../src/engine/game'
import type { CardDefId, GameSettings, PlayerId } from '../../src/engine/types'
import type { MatchTelemetrySubmission } from '../../src/shared/telemetry'
import { TelemetryStore } from '../telemetryStore'

type SimulatorOptions = {
  matches: number
  maxTurns: number
  thinkTimeMs: number
  beamWidth: number
  maxCandidatesPerCard: number
  deckSize: number
  maxCopies: number
  drawPerTurn: number
  actionBudgetP1: number
  actionBudgetP2: number
  boardRows: number
  boardCols: number
  strongholdStrength: number
  printEvery: number
  dryRun: boolean
  logPath?: string
}

type SimulatedMatch = {
  winner: PlayerId | null
  endReason: string
  playedCards: [CardDefId[], CardDefId[]]
  unplayedHandCards: [CardDefId[], CardDefId[]]
}

const options = parseOptions(process.argv.slice(2))
const telemetryStore = new TelemetryStore(options.logPath)
const simStart = Date.now()

let p1Wins = 0
let p2Wins = 0
let draws = 0

for (let index = 0; index < options.matches; index += 1) {
  const settings = buildSettings(options)
  const deckP1 = generateClusteredBotDeck(settings)
  const deckP2 = generateClusteredBotDeck(settings)
  const startedAt = Date.now()
  const result = runOneMatch(settings, deckP1, deckP2, options)
  const endedAt = Date.now()

  if (result.winner === 0) p1Wins += 1
  else if (result.winner === 1) p2Wins += 1
  else draws += 1

  const submission: MatchTelemetrySubmission = {
    schemaVersion: 1,
    matchId: createSimulationMatchId(),
    mode: 'bot',
    startedAt,
    endedAt,
    winner: result.winner,
    endReason: result.endReason,
    settings: { ...settings },
    players: [
      {
        seat: 0,
        decklist: deckP1,
        cardsPlayed: result.playedCards[0],
        cardsInHandNotPlayed: result.unplayedHandCards[0],
      },
      {
        seat: 1,
        decklist: deckP2,
        cardsPlayed: result.playedCards[1],
        cardsInHandNotPlayed: result.unplayedHandCards[1],
      },
    ],
  }

  if (!options.dryRun) {
    telemetryStore.ingestSubmission(submission, 'client_report')
  }

  if ((index + 1) % options.printEvery === 0 || index + 1 === options.matches) {
    process.stdout.write(
      `Progress: ${index + 1}/${options.matches} | P1 ${p1Wins} | P2 ${p2Wins} | Draw ${draws}\n`
    )
  }
}

const elapsedMs = Date.now() - simStart
const matchesPerSecond = options.matches > 0 ? options.matches / Math.max(1, elapsedMs / 1000) : 0

process.stdout.write('\nSimulation complete.\n')
process.stdout.write(`Matches: ${options.matches}\n`)
process.stdout.write(`P1 wins: ${p1Wins}\n`)
process.stdout.write(`P2 wins: ${p2Wins}\n`)
process.stdout.write(`Draws: ${draws}\n`)
process.stdout.write(`Elapsed: ${(elapsedMs / 1000).toFixed(2)}s (${matchesPerSecond.toFixed(2)} matches/s)\n`)
if (options.dryRun) {
  process.stdout.write('Dry run: telemetry was not written.\n')
} else {
  process.stdout.write(`Telemetry appended to: ${options.logPath ?? 'server/data/match-logs.ndjson'}\n`)
}

function runOneMatch(
  settings: GameSettings,
  deckP1: CardDefId[],
  deckP2: CardDefId[],
  options: SimulatorOptions
): SimulatedMatch {
  const state = createGameState(settings, { p1: deckP1, p2: deckP2 })
  const playedCards: [CardDefId[], CardDefId[]] = [[], []]
  const unplayedHandCards: [CardDefId[], CardDefId[]] = [[], []]

  while (state.winner === null && state.turn <= options.maxTurns) {
    if (state.phase !== 'planning') {
      resolveAllActions(state)
      continue
    }

    runPlanningForSeat(state, 0, options)
    runPlanningForSeat(state, 1, options)

    // Capture unplayed hand cards before planning hands are discarded.
    unplayedHandCards[0].push(...state.players[0].hand.map((card) => card.defId))
    unplayedHandCards[1].push(...state.players[1].hand.map((card) => card.defId))

    state.ready = [true, true]
    startActionPhase(state)
    state.actionQueue.forEach((order) => {
      playedCards[order.player].push(order.defId)
    })
    resolveAllActions(state)
  }

  return {
    winner: state.winner,
    endReason: state.winner === null ? 'turn_limit' : 'victory',
    playedCards,
    unplayedHandCards,
  }
}

function runPlanningForSeat(state: ReturnType<typeof createGameState>, seat: PlayerId, options: SimulatorOptions): void {
  const plan = buildBotPlan(state, seat, {
    thinkTimeMs: options.thinkTimeMs,
    beamWidth: options.beamWidth,
    maxCandidatesPerCard: options.maxCandidatesPerCard,
  })

  for (const order of plan.orders) {
    const queued = planOrder(state, seat, order.cardId, order.params)
    if (!queued) break
  }
}

function buildSettings(options: SimulatorOptions): GameSettings {
  return {
    boardRows: options.boardRows,
    boardCols: options.boardCols,
    strongholdStrength: options.strongholdStrength,
    deckSize: options.deckSize,
    drawPerTurn: options.drawPerTurn,
    maxCopies: options.maxCopies,
    actionBudgetP1: options.actionBudgetP1,
    actionBudgetP2: options.actionBudgetP2,
  }
}

function createSimulationMatchId(): string {
  return `sim_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`
}

function parseOptions(args: string[]): SimulatorOptions {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  const matches = readInt(args, '--matches', 100)
  const maxTurns = readInt(args, '--max-turns', 60)
  const thinkTimeMs = readInt(args, '--think-ms', 8)
  const beamWidth = readInt(args, '--beam-width', 8)
  const maxCandidatesPerCard = readInt(args, '--max-candidates', 10)
  const deckSize = readInt(args, '--deck-size', DEFAULT_SETTINGS.deckSize)
  const maxCopies = readInt(args, '--max-copies', DEFAULT_SETTINGS.maxCopies)
  const drawPerTurn = readInt(args, '--draw-per-turn', DEFAULT_SETTINGS.drawPerTurn)
  const actionBudgetP1 = readInt(args, '--action-budget-p1', DEFAULT_SETTINGS.actionBudgetP1)
  const actionBudgetP2 = readInt(args, '--action-budget-p2', DEFAULT_SETTINGS.actionBudgetP2)
  const boardRows = readInt(args, '--board-rows', DEFAULT_SETTINGS.boardRows)
  const boardCols = readInt(args, '--board-cols', DEFAULT_SETTINGS.boardCols)
  const strongholdStrength = readInt(args, '--stronghold-strength', DEFAULT_SETTINGS.strongholdStrength)
  const printEvery = readInt(args, '--print-every', Math.max(1, Math.floor(matches / 10)))
  const dryRun = hasFlag(args, '--dry-run')
  const logPath = readString(args, '--log-path')

  return {
    matches: clamp(matches, 1, 50_000),
    maxTurns: clamp(maxTurns, 1, 2_000),
    thinkTimeMs: clamp(thinkTimeMs, 1, 500),
    beamWidth: clamp(beamWidth, 1, 64),
    maxCandidatesPerCard: clamp(maxCandidatesPerCard, 1, 64),
    deckSize: clamp(deckSize, 5, 80),
    maxCopies: clamp(maxCopies, 1, 10),
    drawPerTurn: clamp(drawPerTurn, 1, 20),
    actionBudgetP1: clamp(actionBudgetP1, 1, 10),
    actionBudgetP2: clamp(actionBudgetP2, 1, 10),
    boardRows: clamp(boardRows, 4, 20),
    boardCols: clamp(boardCols, 4, 20),
    strongholdStrength: clamp(strongholdStrength, 1, 50),
    printEvery: clamp(printEvery, 1, 10_000),
    dryRun,
    logPath,
  }
}

function printHelp(): void {
  process.stdout.write('Usage: npm run telemetry:simulate -- [options]\n')
  process.stdout.write('\n')
  process.stdout.write('Options:\n')
  process.stdout.write('  --matches N              Number of simulated matches (default: 100)\n')
  process.stdout.write('  --max-turns N            Turn cap per match before draw (default: 60)\n')
  process.stdout.write('  --think-ms N             Bot think time per planning call (default: 8)\n')
  process.stdout.write('  --beam-width N           Bot beam width (default: 8)\n')
  process.stdout.write('  --max-candidates N       Bot candidates per card (default: 10)\n')
  process.stdout.write('  --deck-size N            Deck size for both bots (default: current game default)\n')
  process.stdout.write('  --max-copies N           Max copies per card in random decks\n')
  process.stdout.write('  --draw-per-turn N        Draw count per turn\n')
  process.stdout.write('  --action-budget-p1 N     Action budget for seat 0\n')
  process.stdout.write('  --action-budget-p2 N     Action budget for seat 1\n')
  process.stdout.write('  --board-rows N           Board rows\n')
  process.stdout.write('  --board-cols N           Board cols\n')
  process.stdout.write('  --stronghold-strength N  Stronghold strength\n')
  process.stdout.write('  --print-every N          Progress print interval (matches)\n')
  process.stdout.write('  --log-path PATH          Telemetry file path override\n')
  process.stdout.write('  --dry-run                Do not write telemetry entries\n')
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
