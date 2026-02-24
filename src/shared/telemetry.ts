import type { CardDefId, GameSettings, PlayerId } from '../engine/types'

export type MatchTelemetryMode = 'online' | 'local' | 'bot'

export type MatchTelemetryPlayer = {
  seat: PlayerId
  decklist: CardDefId[]
  cardsPlayed: CardDefId[]
  cardsInHandNotPlayed: CardDefId[]
}

export type MatchTelemetrySubmission = {
  schemaVersion: 1
  matchId: string
  mode: MatchTelemetryMode
  roomCode?: string
  startedAt: number
  endedAt: number
  winner: PlayerId | null
  endReason: string
  settings: GameSettings
  players: [MatchTelemetryPlayer, MatchTelemetryPlayer]
}

export type MatchTelemetrySource = 'server_online' | 'client_report'

export type MatchTelemetryRecord = MatchTelemetrySubmission & {
  source: MatchTelemetrySource
  receivedAt: number
}

export type CardBalanceMetric = {
  appearances: number
  wins: number
  winRate: number | null
  copyTotal: number
}

export type CardBalanceScore = {
  cardId: CardDefId
  score: number
  confidence: number
  deck: CardBalanceMetric
  played: CardBalanceMetric
  handNotPlayed: CardBalanceMetric
}

export type CardBalanceSummary = {
  generatedAt: number
  totalMatches: number
  resolvedPlayerSamples: number
  baselineWinRate: number
  cards: CardBalanceScore[]
}
