import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { CARD_DEFS } from '../src/engine/cards'
import type { CardDefId, GameSettings, PlayerId } from '../src/engine/types'
import type {
  CardBalanceMetric,
  CardBalanceScore,
  CardBalanceSummary,
  MatchTelemetryMode,
  MatchTelemetryPlayer,
  MatchTelemetryRecord,
  MatchTelemetrySource,
  MatchTelemetrySubmission,
} from '../src/shared/telemetry'

const DEFAULT_LOG_PATH = resolve(process.cwd(), 'server/data/match-logs.ndjson')
const MAX_RECENT_MATCHES = 1_000

type IngestFailure = {
  ok: false
  errorCode: string
  message: string
}

type IngestSuccess = {
  ok: true
  record: MatchTelemetryRecord
}

export type IngestResult = IngestFailure | IngestSuccess

type MetricAccumulator = {
  appearances: number
  wins: number
  copyTotal: number
}

export class TelemetryStore {
  private readonly logPath: string
  private loaded = false
  private readonly records: MatchTelemetryRecord[] = []

  constructor(logPath = process.env.MATCH_TELEMETRY_LOG_PATH ?? DEFAULT_LOG_PATH) {
    this.logPath = logPath
  }

  ingest(payload: unknown, source: MatchTelemetrySource, receivedAt = Date.now()): IngestResult {
    const submission = normalizeMatchTelemetrySubmission(payload)
    if (!submission) {
      return {
        ok: false,
        errorCode: 'invalid_payload',
        message: 'Telemetry payload does not match schema.',
      }
    }
    const record: MatchTelemetryRecord = {
      ...submission,
      source,
      receivedAt,
    }
    this.ensureLoaded()
    this.records.push(record)
    this.appendRecord(record)
    return { ok: true, record }
  }

  ingestSubmission(submission: MatchTelemetrySubmission, source: MatchTelemetrySource, receivedAt = Date.now()): MatchTelemetryRecord {
    const record: MatchTelemetryRecord = {
      ...submission,
      source,
      receivedAt,
    }
    this.ensureLoaded()
    this.records.push(record)
    this.appendRecord(record)
    return record
  }

  getCardBalanceSummary(now = Date.now()): CardBalanceSummary {
    this.ensureLoaded()
    return buildCardBalanceSummary(this.records, now)
  }

  listRecentMatches(limit = 50): MatchTelemetryRecord[] {
    this.ensureLoaded()
    const safeLimit = clamp(Math.floor(limit), 1, MAX_RECENT_MATCHES)
    return this.records.slice(-safeLimit).map(cloneTelemetryRecord)
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.logPath)) return
    const raw = readFileSync(this.logPath, 'utf8')
    raw
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line) => {
        try {
          const parsed = JSON.parse(line) as unknown
          const normalized = normalizeTelemetryRecord(parsed)
          if (normalized) {
            this.records.push(normalized)
          }
        } catch {
          // Ignore malformed line and continue.
        }
      })
  }

  private appendRecord(record: MatchTelemetryRecord): void {
    mkdirSync(dirname(this.logPath), { recursive: true })
    appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, 'utf8')
  }
}

function cloneTelemetryRecord(source: MatchTelemetryRecord): MatchTelemetryRecord {
  return {
    ...source,
    settings: { ...source.settings },
    players: [clonePlayer(source.players[0]), clonePlayer(source.players[1])],
  }
}

function clonePlayer(player: MatchTelemetryPlayer): MatchTelemetryPlayer {
  return {
    seat: player.seat,
    decklist: [...player.decklist],
    cardsPlayed: [...player.cardsPlayed],
    cardsInHandNotPlayed: [...player.cardsInHandNotPlayed],
  }
}

function normalizeTelemetryRecord(input: unknown): MatchTelemetryRecord | null {
  if (!isObject(input)) return null
  const source = parseMatchTelemetrySource(input.source)
  if (!source) return null
  const receivedAt = parseTimestamp(input.receivedAt)
  if (receivedAt === null) return null
  const submission = normalizeMatchTelemetrySubmission(input)
  if (!submission) return null
  return {
    ...submission,
    source,
    receivedAt,
  }
}

function normalizeMatchTelemetrySubmission(input: unknown): MatchTelemetrySubmission | null {
  if (!isObject(input)) return null

  if (input.schemaVersion !== 1) return null
  if (typeof input.matchId !== 'string' || input.matchId.trim().length === 0) return null
  const mode = parseMatchTelemetryMode(input.mode)
  if (!mode) return null
  const roomCode = parseOptionalString(input.roomCode)
  const startedAt = parseTimestamp(input.startedAt)
  const endedAt = parseTimestamp(input.endedAt)
  if (startedAt === null || endedAt === null || endedAt < startedAt) return null
  const winner = parseWinner(input.winner)
  if (winner === null && input.winner !== null) return null
  if (typeof input.endReason !== 'string' || input.endReason.trim().length === 0) return null
  const settings = parseSettings(input.settings)
  if (!settings) return null
  const players = parsePlayers(input.players)
  if (!players) return null

  return {
    schemaVersion: 1,
    matchId: input.matchId.trim(),
    mode,
    roomCode,
    startedAt,
    endedAt,
    winner,
    endReason: input.endReason.trim(),
    settings,
    players,
  }
}

function parsePlayers(input: unknown): [MatchTelemetryPlayer, MatchTelemetryPlayer] | null {
  if (!Array.isArray(input) || input.length !== 2) return null
  const bySeat: Partial<Record<PlayerId, MatchTelemetryPlayer>> = {}
  for (const value of input) {
    const player = parsePlayer(value)
    if (!player) return null
    if (bySeat[player.seat]) return null
    bySeat[player.seat] = player
  }
  if (!bySeat[0] || !bySeat[1]) return null
  return [bySeat[0], bySeat[1]]
}

function parsePlayer(input: unknown): MatchTelemetryPlayer | null {
  if (!isObject(input)) return null
  const seat = parsePlayerId(input.seat)
  if (seat === null) return null
  const decklist = parseCardDefArray(input.decklist)
  const cardsPlayed = parseCardDefArray(input.cardsPlayed)
  const cardsInHandNotPlayed = parseCardDefArray(input.cardsInHandNotPlayed)
  if (!decklist || !cardsPlayed || !cardsInHandNotPlayed) return null
  return {
    seat,
    decklist,
    cardsPlayed,
    cardsInHandNotPlayed,
  }
}

function parseCardDefArray(input: unknown): CardDefId[] | null {
  if (!Array.isArray(input)) return null
  const values: CardDefId[] = []
  for (const value of input) {
    if (typeof value !== 'string' || !(value in CARD_DEFS)) return null
    values.push(value as CardDefId)
  }
  return values
}

function parseSettings(input: unknown): GameSettings | null {
  if (!isObject(input)) return null
  const boardRows = parseFiniteNumber(input.boardRows)
  const boardCols = parseFiniteNumber(input.boardCols)
  const strongholdStrength = parseFiniteNumber(input.strongholdStrength)
  const deckSize = parseFiniteNumber(input.deckSize)
  const drawPerTurn = parseFiniteNumber(input.drawPerTurn)
  const maxCopies = parseFiniteNumber(input.maxCopies)
  const actionBudgetP1 = parseFiniteNumber(input.actionBudgetP1)
  const actionBudgetP2 = parseFiniteNumber(input.actionBudgetP2)
  if (
    boardRows === null ||
    boardCols === null ||
    strongholdStrength === null ||
    deckSize === null ||
    drawPerTurn === null ||
    maxCopies === null ||
    actionBudgetP1 === null ||
    actionBudgetP2 === null
  ) {
    return null
  }
  return {
    boardRows,
    boardCols,
    strongholdStrength,
    deckSize,
    drawPerTurn,
    maxCopies,
    actionBudgetP1,
    actionBudgetP2,
  }
}

function parseMatchTelemetryMode(value: unknown): MatchTelemetryMode | null {
  if (value === 'online' || value === 'local' || value === 'bot') return value
  return null
}

function parseMatchTelemetrySource(value: unknown): MatchTelemetrySource | null {
  if (value === 'server_online' || value === 'client_report') return value
  return null
}

function parseWinner(input: unknown): PlayerId | null {
  if (input === null) return null
  return parsePlayerId(input)
}

function parsePlayerId(input: unknown): PlayerId | null {
  if (input === 0 || input === 1) return input
  return null
}

function parseOptionalString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseTimestamp(input: unknown): number | null {
  const parsed = parseFiniteNumber(input)
  if (parsed === null || parsed < 0) return null
  return parsed
}

function parseFiniteNumber(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  return input
}

function buildCardBalanceSummary(records: MatchTelemetryRecord[], now = Date.now()): CardBalanceSummary {
  const cardIds = Object.keys(CARD_DEFS) as CardDefId[]
  const deckMetrics = buildEmptyMetricMap(cardIds)
  const playedMetrics = buildEmptyMetricMap(cardIds)
  const handMetrics = buildEmptyMetricMap(cardIds)

  let resolvedSamples = 0
  let totalWins = 0

  records.forEach((record) => {
    ;([0, 1] as PlayerId[]).forEach((seat) => {
      const player = record.players[seat]
      if (record.winner === null) return
      resolvedSamples += 1
      const won = record.winner === seat
      if (won) totalWins += 1

      accumulateMetric(deckMetrics, player.decklist, won)
      accumulateMetric(playedMetrics, player.cardsPlayed, won)
      accumulateMetric(handMetrics, player.cardsInHandNotPlayed, won)
    })
  })

  const baselineWinRate = resolvedSamples > 0 ? totalWins / resolvedSamples : 0.5
  const cards: CardBalanceScore[] = cardIds.map((cardId) => {
    const deck = finalizeMetric(deckMetrics.get(cardId)!)
    const played = finalizeMetric(playedMetrics.get(cardId)!)
    const handNotPlayed = finalizeMetric(handMetrics.get(cardId)!)

    const deckDelta = (deck.winRate ?? baselineWinRate) - baselineWinRate
    const playedDelta = (played.winRate ?? baselineWinRate) - baselineWinRate
    const handPenalty = baselineWinRate - (handNotPlayed.winRate ?? baselineWinRate)
    const confidence = Math.min(1, Math.sqrt(played.appearances / 24))
    const rawScore = (playedDelta * 0.6 + deckDelta * 0.3 + handPenalty * 0.1) * 100
    const score = roundTo(rawScore * confidence, 3)

    return {
      cardId,
      score,
      confidence: roundTo(confidence, 3),
      deck,
      played,
      handNotPlayed,
    }
  })

  cards.sort((a, b) => {
    const magnitude = Math.abs(b.score) - Math.abs(a.score)
    if (magnitude !== 0) return magnitude
    if (b.played.appearances !== a.played.appearances) return b.played.appearances - a.played.appearances
    return a.cardId.localeCompare(b.cardId)
  })

  return {
    generatedAt: now,
    totalMatches: records.length,
    resolvedPlayerSamples: resolvedSamples,
    baselineWinRate: roundTo(baselineWinRate, 4),
    cards,
  }
}

function buildEmptyMetricMap(cardIds: CardDefId[]): Map<CardDefId, MetricAccumulator> {
  const map = new Map<CardDefId, MetricAccumulator>()
  cardIds.forEach((cardId) => {
    map.set(cardId, { appearances: 0, wins: 0, copyTotal: 0 })
  })
  return map
}

function accumulateMetric(metrics: Map<CardDefId, MetricAccumulator>, cards: CardDefId[], won: boolean): void {
  const counts = countCardCopies(cards)
  counts.forEach((copies, cardId) => {
    const metric = metrics.get(cardId)
    if (!metric) return
    metric.appearances += 1
    metric.copyTotal += copies
    if (won) metric.wins += 1
  })
}

function countCardCopies(cards: CardDefId[]): Map<CardDefId, number> {
  const counts = new Map<CardDefId, number>()
  cards.forEach((cardId) => {
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1)
  })
  return counts
}

function finalizeMetric(metric: MetricAccumulator): CardBalanceMetric {
  return {
    appearances: metric.appearances,
    wins: metric.wins,
    winRate: metric.appearances > 0 ? roundTo(metric.wins / metric.appearances, 4) : null,
    copyTotal: metric.copyTotal,
  }
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}
