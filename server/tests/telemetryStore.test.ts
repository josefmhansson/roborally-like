import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelemetryStore } from '../telemetryStore'
import type { MatchTelemetrySubmission } from '../../src/shared/telemetry'

const BASE_SETTINGS = {
  boardRows: 6,
  boardCols: 6,
  strongholdStrength: 5,
  deckSize: 5,
  drawPerTurn: 3,
  maxCopies: 3,
  actionBudgetP1: 3,
  actionBudgetP2: 3,
}

function createSubmission(
  input: Partial<MatchTelemetrySubmission> & Pick<MatchTelemetrySubmission, 'matchId' | 'winner'>
): MatchTelemetrySubmission {
  return {
    schemaVersion: 1,
    mode: 'local',
    startedAt: 1_000,
    endedAt: 2_000,
    endReason: 'victory',
    settings: { ...BASE_SETTINGS },
    players: [
      {
        seat: 0,
        decklist: ['attack_arrow', 'spell_invest'],
        cardsPlayed: ['attack_arrow'],
        cardsInHandNotPlayed: ['spell_invest'],
      },
      {
        seat: 1,
        decklist: ['spell_invest', 'move_any'],
        cardsPlayed: ['spell_invest'],
        cardsInHandNotPlayed: ['move_any'],
      },
    ],
    ...input,
  }
}

test('telemetry store ingests payload and computes directional balance scores', () => {
  const dir = mkdtempSync(join(tmpdir(), 'telemetry-store-'))
  const logPath = join(dir, 'match-logs.ndjson')
  const store = new TelemetryStore(logPath)

  const match1 = createSubmission({ matchId: 'm1', winner: 0 })
  const match2 = createSubmission({
    matchId: 'm2',
    winner: 1,
    players: [
      {
        seat: 0,
        decklist: ['spell_invest', 'move_any'],
        cardsPlayed: ['spell_invest'],
        cardsInHandNotPlayed: [],
      },
      {
        seat: 1,
        decklist: ['attack_arrow', 'move_forward'],
        cardsPlayed: ['attack_arrow'],
        cardsInHandNotPlayed: [],
      },
    ],
  })

  const ingest1 = store.ingest(match1, 'client_report')
  const ingest2 = store.ingest(match2, 'server_online')
  assert.equal(ingest1.ok, true)
  assert.equal(ingest2.ok, true)

  const summary = store.getCardBalanceSummary(3_000)
  assert.equal(summary.totalMatches, 2)
  assert.equal(summary.resolvedPlayerSamples, 4)
  assert.equal(summary.baselineWinRate, 0.5)

  const attackArrow = summary.cards.find((entry) => entry.cardId === 'attack_arrow')
  const spellInvest = summary.cards.find((entry) => entry.cardId === 'spell_invest')
  assert.ok(attackArrow)
  assert.ok(spellInvest)
  assert.equal(attackArrow.played.appearances, 2)
  assert.equal(attackArrow.played.wins, 2)
  assert.equal(spellInvest.played.appearances, 2)
  assert.equal(spellInvest.played.wins, 0)
  assert.ok(attackArrow.score > 0)
  assert.ok(spellInvest.score < 0)

  const reloaded = new TelemetryStore(logPath)
  assert.equal(reloaded.listRecentMatches(10).length, 2)
})

test('telemetry store rejects malformed payloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'telemetry-store-invalid-'))
  const store = new TelemetryStore(join(dir, 'match-logs.ndjson'))
  const badPayload = {
    schemaVersion: 1,
    matchId: '',
    mode: 'local',
  }
  const result = store.ingest(badPayload, 'client_report')
  assert.equal(result.ok, false)
  if ('errorCode' in result) {
    assert.equal(result.errorCode, 'invalid_payload')
  }
})
