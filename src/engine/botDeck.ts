import { CARD_DEFS } from './cards'
import type { CardDefId, CardType, GameSettings } from './types'

type BotDeckCategory = Extract<CardType, 'attack' | 'reinforcement' | 'movement' | 'spell'>
type CategoryCounts = Record<BotDeckCategory, number>
type CategoryBounds = Record<BotDeckCategory, { min: number; max: number }>

const MAIN_CATEGORIES: BotDeckCategory[] = ['attack', 'reinforcement', 'movement']
const ALL_CATEGORIES: BotDeckCategory[] = ['attack', 'reinforcement', 'movement', 'spell']

const MAIN_MIN_RATIO = 0.2
const MAIN_MAX_RATIO = 0.4
const SPELL_MAX_RATIO = 0.25
const MAIN_TARGET_RATIO = 0.3
const SPELL_TARGET_RATIO = 0.1
const RECRUIT_CARD_ID: CardDefId = 'reinforce_spawn'

const CARD_IDS = Object.keys(CARD_DEFS) as CardDefId[]
const CARDS_BY_CATEGORY: Record<BotDeckCategory, CardDefId[]> = {
  attack: [],
  reinforcement: [],
  movement: [],
  spell: [],
}

CARD_IDS.forEach((cardId) => {
  if (cardId === RECRUIT_CARD_ID) return
  const category = CARD_DEFS[cardId].type as BotDeckCategory
  if (CARDS_BY_CATEGORY[category]) {
    CARDS_BY_CATEGORY[category].push(cardId)
  }
})

export function generateClusteredBotDeck(settings: Pick<GameSettings, 'deckSize' | 'maxCopies'>): CardDefId[] {
  const deckSize = Math.max(0, Math.floor(settings.deckSize))
  const maxCopies = Math.max(1, Math.floor(settings.maxCopies))
  if (deckSize <= 0) return []

  const capacities = getCategoryCapacities(maxCopies)
  const totalCapacity = sumCategoryCounts(capacities) + maxCopies
  if (totalCapacity <= 0) return []

  const targetSize = Math.min(deckSize, totalCapacity)
  const requiredRecruitCount = Math.min(targetSize, Math.ceil(targetSize / 10), maxCopies)
  const categoryCounts = chooseCategoryCounts(targetSize - requiredRecruitCount, capacities, {
    ratioDeckSize: targetSize,
    reservedReinforcement: requiredRecruitCount,
  })

  const deck: CardDefId[] = []
  ALL_CATEGORIES.forEach((category) => {
    const categoryCards = buildClusteredCategoryCards(category, categoryCounts[category], maxCopies)
    deck.push(...categoryCards)
  })
  for (let index = 0; index < requiredRecruitCount; index += 1) {
    deck.push(RECRUIT_CARD_ID)
  }
  return shuffle(deck)
}

function getCategoryCapacities(maxCopies: number): CategoryCounts {
  return {
    attack: CARDS_BY_CATEGORY.attack.length * maxCopies,
    reinforcement: CARDS_BY_CATEGORY.reinforcement.length * maxCopies,
    movement: CARDS_BY_CATEGORY.movement.length * maxCopies,
    spell: CARDS_BY_CATEGORY.spell.length * maxCopies,
  }
}

function chooseCategoryCounts(
  deckSize: number,
  capacities: CategoryCounts,
  options?: { ratioDeckSize?: number; reservedReinforcement?: number }
): CategoryCounts {
  const ratioDeckSize = options?.ratioDeckSize ?? deckSize
  const reservedReinforcement = options?.reservedReinforcement ?? 0
  const bounds = createInitialBounds(capacities, ratioDeckSize, reservedReinforcement)
  rebalanceBoundsForFeasibility(bounds, deckSize, capacities)

  const counts: CategoryCounts = {
    attack: bounds.attack.min,
    reinforcement: bounds.reinforcement.min,
    movement: bounds.movement.min,
    spell: bounds.spell.min,
  }
  const targets = createCategoryTargets(deckSize, bounds)
  let remaining = deckSize - sumCategoryCounts(counts)

  while (remaining > 0) {
    const available = ALL_CATEGORIES.filter((category) => counts[category] < bounds[category].max)
    if (available.length === 0) break
    const chosen = pickWeighted(available, (category) => {
      const current = counts[category]
      const target = targets[category]
      const headroom = bounds[category].max - current
      const deficit = Math.max(0, target - current)
      let weight = 1 + headroom * 0.25 + deficit * 2
      if (category === 'spell') weight *= 0.75
      return weight
    })
    counts[chosen] += 1
    remaining -= 1
  }

  return counts
}

function createInitialBounds(
  capacities: CategoryCounts,
  ratioDeckSize: number,
  reservedReinforcement: number
): CategoryBounds {
  const mainMin = Math.ceil(ratioDeckSize * MAIN_MIN_RATIO)
  const computedMainMax = Math.floor(ratioDeckSize * MAIN_MAX_RATIO)
  const mainMax = Math.max(mainMin, computedMainMax)
  const spellMax = Math.floor(ratioDeckSize * SPELL_MAX_RATIO)

  const reinforcementMin = Math.max(0, mainMin - reservedReinforcement)
  const reinforcementMax = Math.max(reinforcementMin, mainMax - reservedReinforcement)

  const bounds: CategoryBounds = {
    attack: { min: mainMin, max: mainMax },
    reinforcement: { min: reinforcementMin, max: reinforcementMax },
    movement: { min: mainMin, max: mainMax },
    spell: { min: 0, max: spellMax },
  }

  ALL_CATEGORIES.forEach((category) => {
    bounds[category].max = clamp(bounds[category].max, 0, capacities[category])
    bounds[category].min = clamp(bounds[category].min, 0, bounds[category].max)
  })

  return bounds
}

function rebalanceBoundsForFeasibility(
  bounds: CategoryBounds,
  deckSize: number,
  capacities: CategoryCounts
): void {
  let minTotal = sumCategoryBounds(bounds, 'min')
  while (minTotal > deckSize) {
    const reducible = ALL_CATEGORIES.filter((category) => bounds[category].min > 0)
    if (reducible.length === 0) break
    reducible.sort((a, b) => {
      if (bounds[b].min !== bounds[a].min) return bounds[b].min - bounds[a].min
      if (a === 'spell') return -1
      if (b === 'spell') return 1
      return 0
    })
    const category = reducible[0]
    bounds[category].min -= 1
    minTotal -= 1
  }

  let maxTotal = sumCategoryBounds(bounds, 'max')
  if (maxTotal < deckSize) {
    MAIN_CATEGORIES.forEach((category) => {
      bounds[category].max = capacities[category]
    })
    bounds.spell.max = capacities.spell
    maxTotal = sumCategoryBounds(bounds, 'max')
  }

  if (maxTotal < deckSize) {
    ALL_CATEGORIES.forEach((category) => {
      bounds[category].max = capacities[category]
    })
  }

  ALL_CATEGORIES.forEach((category) => {
    bounds[category].max = Math.max(bounds[category].min, bounds[category].max)
  })
}

function createCategoryTargets(deckSize: number, bounds: CategoryBounds): CategoryCounts {
  return {
    attack: clamp(Math.round(deckSize * MAIN_TARGET_RATIO), bounds.attack.min, bounds.attack.max),
    reinforcement: clamp(
      Math.round(deckSize * MAIN_TARGET_RATIO),
      bounds.reinforcement.min,
      bounds.reinforcement.max
    ),
    movement: clamp(Math.round(deckSize * MAIN_TARGET_RATIO), bounds.movement.min, bounds.movement.max),
    spell: clamp(Math.round(deckSize * SPELL_TARGET_RATIO), bounds.spell.min, bounds.spell.max),
  }
}

function buildClusteredCategoryCards(
  category: BotDeckCategory,
  count: number,
  maxCopies: number
): CardDefId[] {
  if (count <= 0) return []

  const pool = shuffle([...CARDS_BY_CATEGORY[category]])
  if (pool.length === 0) return []

  const minimumUnique = Math.max(1, Math.ceil(count / maxCopies))
  const maximumUnique = Math.min(count, pool.length)
  const uniqueCount = chooseClusteredUniqueCount(minimumUnique, maximumUnique)
  const selected = pool.slice(0, uniqueCount)
  const copies = new Map<CardDefId, number>()
  selected.forEach((cardId) => copies.set(cardId, 1))

  let remaining = count - selected.length
  while (remaining > 0) {
    const expandable = selected.filter((cardId) => (copies.get(cardId) ?? 0) < maxCopies)
    if (expandable.length === 0) break

    const chosen = pickWeighted(expandable, (cardId) => {
      const current = copies.get(cardId) ?? 0
      const room = maxCopies - current
      if (room <= 0) return 0
      return (current + 1) * (current + 1)
    })
    copies.set(chosen, (copies.get(chosen) ?? 0) + 1)
    remaining -= 1
  }

  const cards: CardDefId[] = []
  selected.forEach((cardId) => {
    const amount = copies.get(cardId) ?? 0
    for (let i = 0; i < amount; i += 1) {
      cards.push(cardId)
    }
  })
  return shuffle(cards)
}

function chooseClusteredUniqueCount(minimum: number, maximum: number): number {
  if (minimum >= maximum) return minimum
  const span = maximum - minimum
  const biasTowardLow = Math.pow(Math.random(), 2.2)
  return minimum + Math.floor(biasTowardLow * (span + 1))
}

function pickWeighted<T>(items: T[], getWeight: (item: T) => number): T {
  if (items.length === 1) return items[0]

  let total = 0
  const weights = items.map((item) => {
    const weight = Math.max(0, getWeight(item))
    total += weight
    return weight
  })

  if (total <= 0) {
    return items[Math.floor(Math.random() * items.length)]
  }

  let roll = Math.random() * total
  for (let index = 0; index < items.length; index += 1) {
    roll -= weights[index]
    if (roll <= 0) return items[index]
  }
  return items[items.length - 1]
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]]
  }
  return copy
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function sumCategoryCounts(counts: CategoryCounts): number {
  return counts.attack + counts.reinforcement + counts.movement + counts.spell
}

function sumCategoryBounds(bounds: CategoryBounds, key: 'min' | 'max'): number {
  return bounds.attack[key] + bounds.reinforcement[key] + bounds.movement[key] + bounds.spell[key]
}
