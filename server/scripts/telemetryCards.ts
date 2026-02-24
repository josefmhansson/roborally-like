import { CARD_DEFS } from '../../src/engine/cards'
import { TelemetryStore } from '../telemetryStore'

type CliOptions = {
  limit: number
  minPlayed: number
  json: boolean
}

const DEFAULT_LIMIT = 30

const options = parseCliOptions(process.argv.slice(2))
const store = new TelemetryStore()
const summary = store.getCardBalanceSummary()
const cards = summary.cards.filter((card) => card.played.appearances >= options.minPlayed).slice(0, options.limit)

if (options.json) {
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: summary.generatedAt,
        totalMatches: summary.totalMatches,
        resolvedPlayerSamples: summary.resolvedPlayerSamples,
        baselineWinRate: summary.baselineWinRate,
        cards,
      },
      null,
      2
    )}\n`
  )
  process.exit(0)
}

process.stdout.write(`Telemetry generated: ${new Date(summary.generatedAt).toISOString()}\n`)
process.stdout.write(`Matches logged: ${summary.totalMatches}\n`)
process.stdout.write(`Resolved player samples: ${summary.resolvedPlayerSamples}\n`)
process.stdout.write(`Baseline win rate: ${(summary.baselineWinRate * 100).toFixed(2)}%\n`)

if (cards.length === 0) {
  process.stdout.write('\nNo card entries match the current filters.\n')
  process.exit(0)
}

const header = [
  pad('Rank', 4),
  pad('Card', 30),
  pad('Score', 8),
  pad('Conf', 6),
  pad('Played WR', 10),
  pad('Played N', 8),
  pad('Deck WR', 9),
  pad('Deck N', 7),
  pad('Hand WR', 9),
  pad('Hand N', 7),
].join(' ')

process.stdout.write(`\n${header}\n`)
process.stdout.write(`${'-'.repeat(header.length)}\n`)

cards.forEach((entry, index) => {
  const name = CARD_DEFS[entry.cardId]?.name ?? entry.cardId
  const line = [
    pad(String(index + 1), 4),
    pad(name, 30),
    pad(signed(entry.score, 3), 8),
    pad(entry.confidence.toFixed(2), 6),
    pad(formatWinRate(entry.played.winRate), 10),
    pad(String(entry.played.appearances), 8),
    pad(formatWinRate(entry.deck.winRate), 9),
    pad(String(entry.deck.appearances), 7),
    pad(formatWinRate(entry.handNotPlayed.winRate), 9),
    pad(String(entry.handNotPlayed.appearances), 7),
  ].join(' ')
  process.stdout.write(`${line}\n`)
})

function parseCliOptions(args: string[]): CliOptions {
  let limit = DEFAULT_LIMIT
  let minPlayed = 0
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--json') {
      json = true
      continue
    }
    if (value === '--help' || value === '-h') {
      printHelpAndExit()
    }
    if (value === '--limit') {
      limit = parsePositiveInt(args[index + 1], DEFAULT_LIMIT)
      index += 1
      continue
    }
    if (value.startsWith('--limit=')) {
      limit = parsePositiveInt(value.slice('--limit='.length), DEFAULT_LIMIT)
      continue
    }
    if (value === '--min-played') {
      minPlayed = parseNonNegativeInt(args[index + 1], 0)
      index += 1
      continue
    }
    if (value.startsWith('--min-played=')) {
      minPlayed = parseNonNegativeInt(value.slice('--min-played='.length), 0)
      continue
    }
  }

  return {
    limit: clamp(limit, 1, 200),
    minPlayed: clamp(minPlayed, 0, 100_000),
    json,
  }
}

function printHelpAndExit(): never {
  process.stdout.write('Usage: npm run telemetry:cards -- [--limit N] [--min-played N] [--json]\n')
  process.exit(0)
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

function formatWinRate(value: number | null): string {
  if (value === null) return '-'
  return `${(value * 100).toFixed(1)}%`
}

function signed(value: number, decimals: number): string {
  const abs = Math.abs(value).toFixed(decimals)
  return value > 0 ? `+${abs}` : value < 0 ? `-${abs}` : ` ${abs}`
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width)
  return value.padEnd(width, ' ')
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
