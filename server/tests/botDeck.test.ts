import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_DEFS } from '../../src/engine/cards'
import { generateClusteredBotDeck } from '../../src/engine/botDeck'
import type { CardDefId } from '../../src/engine/types'

function countByCard(deck: CardDefId[]): Map<CardDefId, number> {
  const counts = new Map<CardDefId, number>()
  deck.forEach((cardId) => {
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1)
  })
  return counts
}

function countByType(deck: CardDefId[]): Record<'attack' | 'reinforcement' | 'movement' | 'spell', number> {
  const counts = { attack: 0, reinforcement: 0, movement: 0, spell: 0 }
  deck.forEach((cardId) => {
    const type = CARD_DEFS[cardId].type
    counts[type] += 1
  })
  return counts
}

test('bot deck generator respects deck size, max copies, and known card ids', () => {
  const deck = generateClusteredBotDeck({ deckSize: 14, maxCopies: 3 })
  assert.equal(deck.length, 14)

  const perCard = countByCard(deck)
  perCard.forEach((copies, cardId) => {
    assert.ok(cardId in CARD_DEFS, `unknown card id in deck: ${cardId}`)
    assert.ok(copies <= 3, `card ${cardId} exceeds max copies (3): ${copies}`)
  })
})

test('bot deck generator stays within category ratio targets when feasible', () => {
  const deckSize = 14
  const deck = generateClusteredBotDeck({ deckSize, maxCopies: 3 })
  const perType = countByType(deck)

  const mainMin = Math.ceil(deckSize * 0.2)
  const mainMax = Math.floor(deckSize * 0.4)
  const spellMax = Math.floor(deckSize * 0.25)

  assert.ok(
    perType.attack >= mainMin && perType.attack <= mainMax,
    `attack out of range: ${perType.attack} (expected ${mainMin}-${mainMax})`
  )
  assert.ok(
    perType.reinforcement >= mainMin && perType.reinforcement <= mainMax,
    `reinforcement out of range: ${perType.reinforcement} (expected ${mainMin}-${mainMax})`
  )
  assert.ok(
    perType.movement >= mainMin && perType.movement <= mainMax,
    `movement out of range: ${perType.movement} (expected ${mainMin}-${mainMax})`
  )
  assert.ok(perType.spell >= 0 && perType.spell <= spellMax, `spell out of range: ${perType.spell} (expected 0-${spellMax})`)
})

test('bot deck generator gracefully handles impossible settings by capping to total capacity', () => {
  const deck = generateClusteredBotDeck({ deckSize: 40, maxCopies: 1 })
  assert.equal(deck.length, Object.keys(CARD_DEFS).length)

  const perCard = countByCard(deck)
  perCard.forEach((copies) => {
    assert.equal(copies, 1)
  })
})

test('bot deck generator tends to cluster copies instead of all-singleton decks', () => {
  let clusteredRuns = 0
  const runs = 120

  for (let index = 0; index < runs; index += 1) {
    const deck = generateClusteredBotDeck({ deckSize: 14, maxCopies: 3 })
    const perCard = countByCard(deck)
    const hasDuplicate = Array.from(perCard.values()).some((copies) => copies > 1)
    if (hasDuplicate) clusteredRuns += 1
  }

  assert.ok(
    clusteredRuns >= 90,
    `expected clustered decks in most runs, got ${clusteredRuns}/${runs}`
  )
})
