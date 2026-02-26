import type {
  CardDefId,
  CardEffect,
  Direction,
  DirectionSource,
  GameState,
  Hex,
  ModifierDuration,
  Order,
  OrderParams,
  PlayerId,
  Tile,
  TileKind,
  Unit,
  UnitId,
} from './types'
import { CARD_DEFS, STARTING_DECK } from './cards'
import { DIRECTIONS, neighbor, rotateDirection } from './hex'

const DEFAULT_BOARD_SIZE = 6
const TILE_KINDS: TileKind[] = ['grass', 'forest', 'mountain', 'pond', 'rocky', 'rough', 'shrub']
const POND_KIND: TileKind = 'pond'
const TILE_BASE_WEIGHT: Record<TileKind, number> = {
  grass: 1,
  forest: 1,
  mountain: 1,
  pond: 0.7,
  rocky: 1,
  rough: 1,
  shrub: 1,
}
const SAME_KIND_BONUS = 2.2

export const DEFAULT_SETTINGS = {
  boardRows: DEFAULT_BOARD_SIZE,
  boardCols: DEFAULT_BOARD_SIZE,
  strongholdStrength: 5,
  deckSize: STARTING_DECK.length,
  drawPerTurn: 5,
  maxCopies: 3,
  actionBudgetP1: 3,
  actionBudgetP2: 3,
}

function sameHex(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r
}

function isDamageableUnit(unit: Unit): boolean {
  return unit.kind !== 'stronghold'
}

function isCardAllowedToTargetBarricades(defId: CardDefId): boolean {
  const def = CARD_DEFS[defId]
  if (typeof def.canTargetBarricades === 'boolean') return def.canTargetBarricades
  return true
}

export function canCardTargetUnit(defId: CardDefId, unit: Unit): boolean {
  if (!isDamageableUnit(unit)) return false
  if (unit.kind === 'barricade' && !isCardAllowedToTargetBarricades(defId)) return false
  return true
}

function isActiveDuration(duration: ModifierDuration): boolean {
  return duration === 'indefinite' || duration > 0
}

function hasUnitModifier(unit: Unit, modifierType: Unit['modifiers'][number]['type']): boolean {
  return unit.modifiers.some((modifier) => modifier.type === modifierType && isActiveDuration(modifier.turnsRemaining))
}

function isActingUnitRequirement(defId: CardDefId): boolean {
  const def = CARD_DEFS[defId]
  if (def.requires.unit !== 'friendly') return false
  return def.effects.some(
    (effect) =>
      (effect.type === 'move' ||
        effect.type === 'face' ||
        effect.type === 'attack' ||
        effect.type === 'shove' ||
        effect.type === 'whirlwind') &&
      effect.unitParam === 'unitId'
  )
}

export function canCardSelectUnit(defId: CardDefId, unit: Unit): boolean {
  if (isActingUnitRequirement(defId)) {
    return unit.kind === 'unit'
  }
  return canCardTargetUnit(defId, unit)
}

function mergeDurations(current: ModifierDuration, incoming: ModifierDuration): ModifierDuration {
  if (current === 'indefinite' || incoming === 'indefinite') return 'indefinite'
  return Math.max(current, incoming)
}

function normalizeDuration(turns: ModifierDuration): ModifierDuration | null {
  if (turns === 'indefinite') return 'indefinite'
  const normalized = Math.max(0, Math.floor(turns))
  if (normalized <= 0) return null
  return normalized
}

function pickWeightedKind(weights: Array<{ kind: TileKind; weight: number }>): TileKind {
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0)
  if (total <= 0) {
    const fallback = weights.filter((entry) => entry.weight >= 0 && entry.kind !== POND_KIND)
    return (fallback.length ? fallback : weights)[Math.floor(Math.random() * weights.length)].kind
  }
  let roll = Math.random() * total
  for (const entry of weights) {
    roll -= entry.weight
    if (roll <= 0) return entry.kind
  }
  return weights[weights.length - 1].kind
}

function countNeighborsOfKind(
  assigned: Map<string, TileKind>,
  rows: number,
  cols: number,
  hex: Hex,
  kind: TileKind
): number {
  let count = 0
  for (let dir = 0 as Direction; dir < 6; dir += 1) {
    const neighborHex = neighbor(hex, dir)
    if (!inBounds(rows, cols, neighborHex)) continue
    const neighborKind = assigned.get(`${neighborHex.q},${neighborHex.r}`)
    if (neighborKind === kind) count += 1
  }
  return count
}

function createTiles(rows: number, cols: number): Tile[] {
  const positions: Hex[] = []
  for (let r = 0; r < rows; r += 1) {
    for (let q = 0; q < cols; q += 1) {
      positions.push({ q, r })
    }
  }

  const assigned = new Map<string, TileKind>()
  shuffle(positions).forEach((hex) => {
    const weights = TILE_KINDS.map((kind) => {
      if (kind === POND_KIND && countNeighborsOfKind(assigned, rows, cols, hex, POND_KIND) > 0) {
        return { kind, weight: 0 }
      }
      const sameCount = countNeighborsOfKind(assigned, rows, cols, hex, kind)
      const weight = TILE_BASE_WEIGHT[kind] + sameCount * SAME_KIND_BONUS
      return { kind, weight }
    })
    const chosen = pickWeightedKind(weights)
    assigned.set(`${hex.q},${hex.r}`, chosen)
  })

  return positions.map((hex) => ({
    id: `${hex.q},${hex.r}`,
    q: hex.q,
    r: hex.r,
    kind: assigned.get(`${hex.q},${hex.r}`) ?? 'grass',
  }))
}

function inBounds(rows: number, cols: number, hex: Hex): boolean {
  return hex.q >= 0 && hex.q < cols && hex.r >= 0 && hex.r < rows
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function createDeckFromList(defIds: CardDefId[]): { id: string; defId: CardDefId }[] {
  return shuffle(defIds.map((defId, index) => ({ id: `c${index + 1}`, defId })))
}

function createStronghold(owner: PlayerId, pos: Hex, strength: number): Unit {
  return {
    id: `stronghold-${owner}`,
    owner,
    kind: 'stronghold',
    strength,
    pos,
    facing: owner === 0 ? 5 : 2,
    modifiers: [],
  }
}

function getStrongholdPositions(rows: number, cols: number): [Hex, Hex] {
  const centerQ = Math.floor(cols / 2)
  return [
    { q: centerQ - 1, r: 0 },
    { q: centerQ, r: rows - 1 },
  ]
}

function createUnit(owner: PlayerId, pos: Hex, facing: Direction, strength: number, id: UnitId): Unit {
  return {
    id,
    owner,
    kind: 'unit',
    strength,
    pos,
    facing,
    modifiers: [],
  }
}

export function createGameState(
  settings: GameState['settings'] = DEFAULT_SETTINGS,
  decks?: { p1: CardDefId[]; p2: CardDefId[] }
): GameState {
  const rows = settings.boardRows
  const cols = settings.boardCols
  const tiles = createTiles(rows, cols)
  const [topPos, bottomPos] = getStrongholdPositions(rows, cols)
  const units: Record<UnitId, Unit> = {}
  units['stronghold-0'] = createStronghold(0, topPos, settings.strongholdStrength)
  units['stronghold-1'] = createStronghold(1, bottomPos, settings.strongholdStrength)
  const topFront = neighbor(units['stronghold-0'].pos, units['stronghold-0'].facing)
  const bottomFront = neighbor(units['stronghold-1'].pos, units['stronghold-1'].facing)
  if (inBounds(rows, cols, topFront)) {
    const id = `u0-1`
    units[id] = createUnit(0, topFront, units['stronghold-0'].facing, 2, id)
  }
  if (inBounds(rows, cols, bottomFront)) {
    const id = `u1-2`
    units[id] = createUnit(1, bottomFront, units['stronghold-1'].facing, 2, id)
  }

  const p1Deck = decks?.p1 ?? STARTING_DECK.slice(0, settings.deckSize)
  const p2Deck = decks?.p2 ?? STARTING_DECK.slice(0, settings.deckSize)

  const players = [
    { deck: createDeckFromList(p1Deck), hand: [], discard: [], orders: [], modifiers: [] },
    { deck: createDeckFromList(p2Deck), hand: [], discard: [], orders: [], modifiers: [] },
  ] as [GameState['players'][0], GameState['players'][1]]

  const state: GameState = {
    boardRows: rows,
    boardCols: cols,
    tiles,
    units,
    players,
    ready: [false, false],
    actionBudgets: [settings.actionBudgetP1, settings.actionBudgetP2],
    activePlayer: 0,
    phase: 'planning',
    actionQueue: [],
    actionIndex: 0,
    turn: 1,
    nextUnitId: 3,
    nextOrderId: 1,
    log: ['Game start.'],
    winner: null,
    spawnedByOrder: {},
    settings,
  }

  drawPhase(state)
  return state
}

function getOrderCost(defId: CardDefId): number {
  return CARD_DEFS[defId].actionCost ?? 1
}

function getUsedActionPoints(state: GameState, player: PlayerId): number {
  return state.players[player].orders.reduce((sum, order) => sum + getOrderCost(order.defId), 0)
}

export function getSpawnTiles(state: GameState, player: PlayerId): Hex[] {
  const stronghold = state.units[`stronghold-${player}`]
  if (!stronghold) return []
  const tiles: Hex[] = []
  for (let dir = 0 as Direction; dir < 6; dir += 1) {
    const candidate = neighbor(stronghold.pos, dir)
    if (inBounds(state.boardRows, state.boardCols, candidate)) {
      tiles.push(candidate)
    }
  }
  return tiles
}

export function getBarricadeSpawnTiles(state: GameState, player: PlayerId): Hex[] {
  const candidates = new Map<string, Hex>()

  Object.values(state.units)
    .filter((unit) => unit.owner === player && (unit.kind === 'stronghold' || unit.kind === 'unit'))
    .forEach((unit) => {
      for (let dir = 0 as Direction; dir < 6; dir += 1) {
        const adjacent = neighbor(unit.pos, dir)
        if (!inBounds(state.boardRows, state.boardCols, adjacent)) continue
        if (getUnitAt(state, adjacent)) continue
        candidates.set(`${adjacent.q},${adjacent.r}`, adjacent)
      }
    })

  return [...candidates.values()]
}

function isValidBarricadeSpawnTile(state: GameState, player: PlayerId, hex: Hex): boolean {
  return getBarricadeSpawnTiles(state, player).some((tile) => sameHex(tile, hex))
}

export function isSpawnTile(state: GameState, player: PlayerId, hex: Hex): boolean {
  return getSpawnTiles(state, player).some((tile) => tile.q === hex.q && tile.r === hex.r)
}

export function drawPhase(state: GameState): void {
  for (const player of [0, 1] as PlayerId[]) {
    const bonusDraw = consumePlayerDrawModifiers(state, player)
    const drawCount = Math.max(0, state.settings.drawPerTurn + bonusDraw)
    drawCards(state, player, drawCount)
    if (bonusDraw > 0) {
      state.log.push(`Player ${player + 1} draws ${bonusDraw} extra card(s).`)
    } else if (bonusDraw < 0) {
      state.log.push(`Player ${player + 1} draws ${Math.abs(bonusDraw)} fewer card(s).`)
    }
  }
  state.phase = 'planning'
  state.log.push(`Turn ${state.turn} draw complete. Active player: ${state.activePlayer + 1}.`)
}

function drawCards(state: GameState, player: PlayerId, count: number): void {
  const playerState = state.players[player]
  for (let i = 0; i < count; i += 1) {
    if (playerState.deck.length === 0) {
      if (playerState.discard.length === 0) {
        return
      }
      playerState.deck = shuffle(playerState.discard)
      playerState.discard = []
      state.log.push(`Player ${player + 1} reshuffles their discard pile.`)
    }
    const card = playerState.deck.shift()
    if (card) {
      playerState.hand.push(card)
    }
  }
}

function consumePlayerDrawModifiers(state: GameState, player: PlayerId): number {
  const playerState = state.players[player]
  let bonusDraw = 0
  playerState.modifiers.forEach((modifier) => {
    if (!isActiveDuration(modifier.turnsRemaining)) return
    if (modifier.type === 'extraDraw') {
      bonusDraw += modifier.amount
    }
    if (modifier.turnsRemaining !== 'indefinite') {
      modifier.turnsRemaining -= 1
    }
  })
  playerState.modifiers = playerState.modifiers.filter((modifier) => isActiveDuration(modifier.turnsRemaining))
  return bonusDraw
}

export function planOrder(
  state: GameState,
  player: PlayerId,
  cardId: string,
  params: OrderParams
): Order | null {
  if (state.phase !== 'planning' || state.winner !== null) return null
  const playerState = state.players[player]
  const cardIndex = playerState.hand.findIndex((card) => card.id === cardId)
  if (cardIndex === -1) return null
  const card = playerState.hand[cardIndex]
  const nextCost = getOrderCost(card.defId)
  const budget =
    state.actionBudgets[player] ??
    (player === 0 ? state.settings.actionBudgetP1 : state.settings.actionBudgetP2) ??
    (player === 0 ? DEFAULT_SETTINGS.actionBudgetP1 : DEFAULT_SETTINGS.actionBudgetP2)
  if (getUsedActionPoints(state, player) + nextCost > budget) return null
  const projectedState = simulatePlannedState(state, player)
  if (!validateOrderParams(projectedState, player, card.defId, params, state)) {
    return null
  }

  playerState.hand.splice(cardIndex, 1)
  const order: Order = {
    id: `o${state.nextOrderId++}`,
    player,
    cardId: card.id,
    defId: card.defId,
    params,
  }
  playerState.orders.push(order)
  state.log.push(`Player ${player + 1} plans a card.`)
  return order
}

export function discardUnchosen(state: GameState): void {
  for (const player of [0, 1] as PlayerId[]) {
    const playerState = state.players[player]
    if (playerState.hand.length > 0) {
      playerState.discard.push(...playerState.hand)
      playerState.hand = []
    }
  }
}

export function startActionPhase(state: GameState): void {
  if (state.phase !== 'planning' || state.winner !== null) return
  if (!playersReady(state)) return
  discardUnchosen(state)
  state.phase = 'action'
  state.actionQueue = buildActionQueue(state)
  state.actionIndex = 0
  state.log.push('Orders revealed. Action phase begins.')
}

function playersReady(state: GameState): boolean {
  return state.ready[0] && state.ready[1]
}

function isPriorityOrder(order: Order): boolean {
  return CARD_DEFS[order.defId].keywords?.includes('Priority') ?? false
}

function buildActionQueue(state: GameState): Order[] {
  const active = state.activePlayer
  const other: PlayerId = active === 0 ? 1 : 0
  const queue: Order[] = []
  const maxOrders = Math.max(state.players[0].orders.length, state.players[1].orders.length)
  for (let i = 0; i < maxOrders; i += 1) {
    const activeOrder = state.players[active].orders[i]
    const otherOrder = state.players[other].orders[i]
    if (activeOrder) queue.push(activeOrder)
    if (otherOrder) queue.push(otherOrder)
  }

  const playersInResolutionOrder: PlayerId[] = [active, other]
  playersInResolutionOrder.forEach((player) => {
    const playerOrders = state.players[player].orders
    if (playerOrders.length < 2) return

    let previousOrderId: string | null = null
    playerOrders.forEach((order) => {
      const currentIndex = queue.findIndex((entry) => entry.id === order.id)
      if (currentIndex === -1) return

      if (!previousOrderId) {
        previousOrderId = order.id
        return
      }
      if (!isPriorityOrder(order)) {
        previousOrderId = order.id
        return
      }

      const previousIndex = queue.findIndex((entry) => entry.id === previousOrderId)
      if (previousIndex === -1 || currentIndex <= previousIndex + 1) {
        previousOrderId = order.id
        return
      }

      let targetIndex = currentIndex
      while (targetIndex > previousIndex + 1) {
        const left = queue[targetIndex - 1]
        if (left.player === player) break
        if (isPriorityOrder(left)) break
        targetIndex -= 1
      }

      if (targetIndex !== currentIndex) {
        const [moved] = queue.splice(currentIndex, 1)
        queue.splice(targetIndex, 0, moved)
        if (previousOrderId === moved.id) {
          previousOrderId = moved.id
        }
      }

      previousOrderId = order.id
    })
  })

  return queue
}

export function resolveNextAction(state: GameState): void {
  if (state.phase !== 'action' || state.winner !== null) return
  const order = state.actionQueue[state.actionIndex]
  if (!order) {
    finishTurn(state)
    return
  }
  applyOrder(state, order)
  if (state.winner !== null) {
    state.actionQueue = []
    state.actionIndex = 0
    return
  }
  const playerState = state.players[order.player]
  const playedCardIndex = playerState.orders.findIndex((item) => item.id === order.id)
  if (playedCardIndex !== -1) {
    const played = playerState.orders.splice(playedCardIndex, 1)[0]
    playerState.discard.push({ id: played.cardId, defId: played.defId })
  }
  state.actionIndex += 1
  if (state.actionIndex >= state.actionQueue.length) {
    finishTurn(state)
  }
}

export function resolveAllActions(state: GameState): void {
  while (state.phase === 'action' && state.winner === null) {
    const currentIndex = state.actionIndex
    resolveNextAction(state)
    if (state.actionIndex === currentIndex) {
      break
    }
  }
}

export function simulatePlannedState(state: GameState, player: PlayerId): GameState {
  const units: Record<UnitId, Unit> = {}
  Object.entries(state.units).forEach(([id, unit]) => {
    units[id] = {
      ...unit,
      pos: { ...unit.pos },
      modifiers: unit.modifiers.map((modifier) => ({ ...modifier })),
    }
  })

  const players: GameState['players'] = [
    {
      deck: [...state.players[0].deck],
      hand: [...state.players[0].hand],
      discard: [...state.players[0].discard],
      orders: [...state.players[0].orders],
      modifiers: state.players[0].modifiers.map((modifier) => ({ ...modifier })),
    },
    {
      deck: [...state.players[1].deck],
      hand: [...state.players[1].hand],
      discard: [...state.players[1].discard],
      orders: [...state.players[1].orders],
      modifiers: state.players[1].modifiers.map((modifier) => ({ ...modifier })),
    },
  ]

  const sim: GameState = {
    ...state,
    units,
    players,
    actionQueue: [],
    actionIndex: 0,
    winner: null,
    spawnedByOrder: {},
    log: [],
  }

  for (const order of state.players[player].orders) {
    applyOrderForPlanning(sim, order)
  }

  return sim
}

export function getPlannedMoveSegments(state: GameState, player: PlayerId): { from: Hex; to: Hex }[] {
  const units: Record<UnitId, Unit> = {}
  Object.entries(state.units).forEach(([id, unit]) => {
    units[id] = {
      ...unit,
      pos: { ...unit.pos },
      modifiers: unit.modifiers.map((modifier) => ({ ...modifier })),
    }
  })

  const players: GameState['players'] = [
    {
      deck: [...state.players[0].deck],
      hand: [...state.players[0].hand],
      discard: [...state.players[0].discard],
      orders: [...state.players[0].orders],
      modifiers: state.players[0].modifiers.map((modifier) => ({ ...modifier })),
    },
    {
      deck: [...state.players[1].deck],
      hand: [...state.players[1].hand],
      discard: [...state.players[1].discard],
      orders: [...state.players[1].orders],
      modifiers: state.players[1].modifiers.map((modifier) => ({ ...modifier })),
    },
  ]

  const sim: GameState = {
    ...state,
    units,
    players,
    actionQueue: [],
    actionIndex: 0,
    winner: null,
    spawnedByOrder: {},
    log: [],
  }

  const segments: { from: Hex; to: Hex }[] = []

  for (const order of state.players[player].orders) {
    const def = CARD_DEFS[order.defId]
    for (const effect of def.effects) {
      if (effect.type === 'move') {
        const params = order.params
        if (!params.unitId) continue
        const resolvedUnitId = resolveUnitId(sim, order.player, params.unitId)
        if (!resolvedUnitId) continue
        const unit = sim.units[resolvedUnitId]
        if (!unit) continue
        const direction = resolveDirection(unit.facing, params, effect.direction)
        if (direction === null) continue
        const distance =
          typeof effect.distance === 'number'
            ? effect.distance
            : params.distance !== undefined
              ? params.distance
              : null
        if (!distance) continue
        const start = { ...unit.pos }
        const end = moveUnitWithPath(sim, unit, direction, distance)
        if (end && (end.q !== start.q || end.r !== start.r)) {
          segments.push({ from: start, to: end })
        }
        continue
      }
      else if (effect.type !== 'budget') {
        applyEffect(sim, order, effect)
      }
    }
  }

  return segments
}

export function getPlannedOrderValidity(state: GameState, player: PlayerId): boolean[] {
  const simUnits: Record<UnitId, Unit> = {}
  Object.entries(state.units).forEach(([id, unit]) => {
    simUnits[id] = {
      ...unit,
      pos: { ...unit.pos },
      modifiers: unit.modifiers.map((modifier) => ({ ...modifier })),
    }
  })

  const simPlayers: GameState['players'] = [
    {
      deck: [...state.players[0].deck],
      hand: [...state.players[0].hand],
      discard: [...state.players[0].discard],
      orders: [...state.players[0].orders],
      modifiers: state.players[0].modifiers.map((modifier) => ({ ...modifier })),
    },
    {
      deck: [...state.players[1].deck],
      hand: [...state.players[1].hand],
      discard: [...state.players[1].discard],
      orders: [...state.players[1].orders],
      modifiers: state.players[1].modifiers.map((modifier) => ({ ...modifier })),
    },
  ]

  const sim: GameState = {
    ...state,
    units: simUnits,
    players: simPlayers,
    actionQueue: [],
    actionIndex: 0,
    winner: null,
    spawnedByOrder: {},
    log: [],
  }

  const validity: boolean[] = []
  for (const order of state.players[player].orders) {
    const canApply = canApplyOrder(sim, order, state)
    validity.push(canApply)
    if (canApply) {
      applyOrderForPlanning(sim, order)
    }
  }
  return validity
}

function finishTurn(state: GameState): void {
  tickUnitModifiers(state)
  state.players[0].orders = []
  state.players[1].orders = []
  state.actionQueue = []
  state.actionIndex = 0
  state.phase = 'planning'
  state.turn += 1
  state.activePlayer = state.activePlayer === 0 ? 1 : 0
  state.ready = [false, false]
  drawPhase(state)
}

function tickUnitModifiers(state: GameState): void {
  const unitIds = Object.keys(state.units)
  unitIds.forEach((unitId) => {
    const unit = state.units[unitId]
    if (!unit) return
    if (unit.modifiers.length === 0) return

    const burnStacks = unit.modifiers.filter(
      (modifier) => modifier.type === 'burn' && isActiveDuration(modifier.turnsRemaining)
    ).length
    if (burnStacks > 0) {
      state.log.push(`Burn deals ${burnStacks} damage to unit ${unit.id}.`)
      applyDamage(state, unit, burnStacks)
    }

    const afterDamage = state.units[unitId]
    if (!afterDamage) return
    afterDamage.modifiers.forEach((modifier) => {
      if (modifier.turnsRemaining === 'indefinite') return
      modifier.turnsRemaining -= 1
    })
    afterDamage.modifiers = afterDamage.modifiers.filter((modifier) => isActiveDuration(modifier.turnsRemaining))
  })
}

function validateOrderParams(
  state: GameState,
  player: PlayerId,
  defId: CardDefId,
  params: OrderParams,
  fallbackState?: GameState
): boolean {
  const def = CARD_DEFS[defId]
  if (def.requires.unit) {
    if (!params.unitId) return false
    if (def.requires.unit === 'any') {
      if (isPlannedUnitReference(state, player, params.unitId)) return false
      const unit = state.units[params.unitId] ?? fallbackState?.units[params.unitId]
      if (!unit) return false
      if (!canCardTargetUnit(defId, unit)) return false
    } else {
      const requireActingUnit = isActingUnitRequirement(defId)
      if (isPlannedUnitReference(state, player, params.unitId)) {
        if (!requireActingUnit) {
          // Planned spawn is allowed as a future unit reference.
        }
      } else {
        const unit = state.units[params.unitId]
        if (!unit) return false
        if (unit.owner !== player) return false
        if (requireActingUnit) {
          if (unit.kind !== 'unit') return false
        } else if (!canCardTargetUnit(defId, unit)) {
          return false
        }
      }
    }
  }
  if (params.unitId && def.effects.some((effect) => effect.type === 'boost' && effect.requireSpawnTile)) {
    const resolvedUnitId = resolveUnitId(state, player, params.unitId)
    if (!resolvedUnitId) return false
    const unit = state.units[resolvedUnitId]
    if (!unit || !isSpawnTile(state, player, unit.pos)) return false
  }
  if (def.requires.tile === 'spawn') {
    if (!params.tile) return false
    if (!isSpawnTile(state, player, params.tile)) return false
  }
  if (def.requires.tile === 'any') {
    if (!params.tile) return false
    if (!inBounds(state.boardRows, state.boardCols, params.tile)) return false
    const unit = getUnitAt(state, params.tile)
    if (unit?.kind === 'stronghold') return false
  }
  if (def.requires.tile === 'barricade') {
    if (!params.tile) return false
    if (!isValidBarricadeSpawnTile(state, player, params.tile)) return false
  }
  if (def.requires.tile2 === 'barricade') {
    if (!params.tile2) return false
    if (!isValidBarricadeSpawnTile(state, player, params.tile2)) return false
    if (!params.tile || sameHex(params.tile, params.tile2)) return false
  }
  if (def.requires.direction && params.direction === undefined) return false
  if (def.requires.moveDirection && params.moveDirection === undefined) return false
  if (def.requires.faceDirection && params.faceDirection === undefined) return false
  if (def.requires.distanceOptions && params.distance === undefined) return false
  if (def.requires.distanceOptions && params.distance !== undefined) {
    if (!def.requires.distanceOptions.includes(params.distance)) return false
  }
  return true
}

function isPlannedUnitReference(state: GameState, player: PlayerId, unitId: string): boolean {
  if (!unitId.startsWith('planned:')) return false
  const orderId = unitId.replace('planned:', '')
  const planned = state.players[player].orders.find((order) => order.id === orderId)
  if (!planned) return false
  return planned.defId === 'reinforce_spawn'
}

function getUnitAt(state: GameState, hex: Hex): Unit | null {
  for (const unit of Object.values(state.units)) {
    if (unit.pos.q === hex.q && unit.pos.r === hex.r) {
      return unit
    }
  }
  return null
}

function setUnitPosition(unit: Unit, pos: Hex): void {
  unit.pos = pos
}

function spawnUnit(
  state: GameState,
  player: PlayerId,
  tile: Hex,
  facing: Direction,
  kind: 'unit' | 'barricade',
  strength: number
): UnitId | null {
  if (!inBounds(state.boardRows, state.boardCols, tile)) return null
  if (getUnitAt(state, tile)) return null
  const id = `u${player}-${state.nextUnitId++}`
  state.units[id] = {
    id,
    owner: player,
    kind,
    strength,
    pos: { ...tile },
    facing,
    modifiers: [],
  }
  if (kind === 'barricade') {
    state.log.push(`Player ${player + 1} spawns a barricade at ${tile.q},${tile.r}.`)
  } else {
    state.log.push(`Player ${player + 1} spawns a unit at ${tile.q},${tile.r}.`)
  }
  return id
}

function boostUnit(state: GameState, unit: Unit, amount: number): void {
  unit.strength += amount
  state.log.push(`Unit ${unit.id} gains ${amount} strength.`)
}

function addUnitModifier(state: GameState, unit: Unit, modifier: Unit['modifiers'][number]['type'], turns: ModifierDuration): void {
  const normalizedTurns = normalizeDuration(turns)
  if (!normalizedTurns) return
  const existing = unit.modifiers.find((entry) => entry.type === modifier)
  if (existing) {
    existing.turnsRemaining = mergeDurations(existing.turnsRemaining, normalizedTurns)
  } else {
    unit.modifiers.push({ type: modifier, turnsRemaining: normalizedTurns })
  }
  const durationLabel = normalizedTurns === 'indefinite' ? 'indefinitely' : `for ${normalizedTurns} turn(s)`
  state.log.push(`Unit ${unit.id} is affected: ${modifier} ${durationLabel}.`)
}

function clearUnitModifiers(state: GameState, unit: Unit): void {
  if (unit.modifiers.length === 0) return
  unit.modifiers = []
  state.log.push(`Unit ${unit.id} has all modifiers removed.`)
}

function addPlayerModifier(
  state: GameState,
  player: PlayerId,
  modifier: 'extraDraw',
  amount: number,
  turns: ModifierDuration
): void {
  const normalizedAmount = Math.max(0, Math.floor(amount))
  const normalizedTurns = normalizeDuration(turns)
  if (normalizedAmount <= 0 || !normalizedTurns) return
  const playerState = state.players[player]
  const existing = playerState.modifiers.find(
    (entry) => entry.type === modifier && entry.amount === normalizedAmount
  )
  if (existing) {
    existing.turnsRemaining = mergeDurations(existing.turnsRemaining, normalizedTurns)
  } else {
    playerState.modifiers.push({
      type: modifier,
      amount: normalizedAmount,
      turnsRemaining: normalizedTurns,
    })
  }
  const durationLabel = normalizedTurns === 'indefinite' ? 'indefinitely' : `for ${normalizedTurns} turn(s)`
  state.log.push(
    `Player ${player + 1} gains ${normalizedAmount} extra draw ${durationLabel}.`
  )
}

function applyDamage(state: GameState, unit: Unit, amount: number): void {
  unit.strength -= amount
  state.log.push(`Unit ${unit.id} takes ${amount} damage.`)
  if (unit.strength <= 0) {
    delete state.units[unit.id]
    state.log.push(`Unit ${unit.id} is destroyed.`)
    if (unit.kind === 'stronghold') {
      state.winner = unit.owner === 0 ? 1 : 0
      state.log.push(`Player ${state.winner + 1} wins by destroying the stronghold.`)
    }
  }
}

function moveUnit(state: GameState, unit: Unit, direction: Direction, distance: number): void {
  if (unit.kind !== 'unit') return
  if (hasUnitModifier(unit, 'cannotMove')) {
    state.log.push(`Unit ${unit.id} cannot move this turn.`)
    return
  }
  let current = { ...unit.pos }
  for (let step = 0; step < distance; step += 1) {
    const next = neighbor(current, direction)
    if (!inBounds(state.boardRows, state.boardCols, next)) break
    if (getUnitAt(state, next)) break
    current = next
  }
  if (current.q !== unit.pos.q || current.r !== unit.pos.r) {
    setUnitPosition(unit, current)
    state.log.push(`Unit ${unit.id} moves to ${current.q},${current.r}.`)
  } else {
    state.log.push(`Unit ${unit.id} cannot move.`)
  }
}

function moveUnitWithPath(state: GameState, unit: Unit, direction: Direction, distance: number): Hex | null {
  if (unit.kind !== 'unit') return null
  if (hasUnitModifier(unit, 'cannotMove')) {
    return { ...unit.pos }
  }
  let current = { ...unit.pos }
  for (let step = 0; step < distance; step += 1) {
    const next = neighbor(current, direction)
    if (!inBounds(state.boardRows, state.boardCols, next)) break
    if (getUnitAt(state, next)) break
    current = next
  }
  setUnitPosition(unit, current)
  return current
}

function attackNearestTile(state: GameState, origin: Unit, direction: Direction, damage: number): void {
  const targetTile = neighbor(origin.pos, direction)
  if (!inBounds(state.boardRows, state.boardCols, targetTile)) return
  const target = getUnitAt(state, targetTile)
  if (target) {
    applyDamage(state, target, damage)
  }
}

function attackRay(state: GameState, origin: Unit, direction: Direction, damage: number): void {
  let cursor = { ...origin.pos }
  for (;;) {
    cursor = neighbor(cursor, direction)
    if (!inBounds(state.boardRows, state.boardCols, cursor)) break
    const target = getUnitAt(state, cursor)
    if (target) {
      applyDamage(state, target, damage)
      break
    }
  }
}

function attackLine(state: GameState, origin: Unit, direction: Direction, damage: number): void {
  let cursor = { ...origin.pos }
  for (;;) {
    cursor = neighbor(cursor, direction)
    if (!inBounds(state.boardRows, state.boardCols, cursor)) break
    const target = getUnitAt(state, cursor)
    if (target) {
      applyDamage(state, target, damage)
    }
  }
}

function pushUnit(state: GameState, unit: Unit, direction: Direction, distance: number): boolean {
  if (distance <= 0) return false
  if (unit.kind === 'stronghold') return false
  let current = { ...unit.pos }
  for (let step = 0; step < distance; step += 1) {
    const next = neighbor(current, direction)
    if (!inBounds(state.boardRows, state.boardCols, next)) return false
    if (getUnitAt(state, next)) return false
    current = next
  }
  if (sameHex(current, unit.pos)) return false
  setUnitPosition(unit, current)
  state.log.push(`Unit ${unit.id} is pushed to ${current.q},${current.r}.`)
  return true
}

function applyOrder(state: GameState, order: Order): void {
  const def = CARD_DEFS[order.defId]
  if (state.winner !== null) return
  for (const effect of def.effects) {
    applyEffect(state, order, effect)
    if (state.winner !== null) return
  }
}

function applyOrderForPlanning(state: GameState, order: Order): void {
  const def = CARD_DEFS[order.defId]
  for (const effect of def.effects) {
    if (effect.type === 'budget') continue
    applyEffect(state, order, effect)
  }
}

function canApplyOrder(state: GameState, order: Order, fallbackState?: GameState): boolean {
  const def = CARD_DEFS[order.defId]
  const params = order.params
  for (const effect of def.effects) {
    if (effect.type === 'spawn') {
      const tile = effect.tileParam === 'tile2' ? params.tile2 : params.tile
      if (!tile) return false
      if (!inBounds(state.boardRows, state.boardCols, tile)) return false
      if (getUnitAt(state, tile)) return false
      if (effect.kind === 'barricade' && !isValidBarricadeSpawnTile(state, order.player, tile)) return false
      const facing = effect.facingParam ? params.direction : effect.facing
      if (facing === undefined) return false
      if (effect.tileParam === 'tile2' && params.tile && sameHex(params.tile, tile)) return false
      continue
    }

    if (effect.type === 'boost') {
      const unitParamValue = effect.unitParam === 'unitId2' ? params.unitId2 : params.unitId
      if (!unitParamValue) {
        if (effect.unitParam === 'unitId2') continue
        return false
      }
      const resolved = resolveUnitId(state, order.player, unitParamValue)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit) return false
      if (!canCardTargetUnit(order.defId, unit)) return false
      if (effect.requireSpawnTile && !isSpawnTile(state, order.player, unit.pos)) return false
      continue
    }

    if (effect.type === 'move') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit) return false
      if (unit.kind !== 'unit') return false
      const direction = resolveDirection(unit.facing, params, effect.direction)
      if (direction === null) return false
      const distance =
        typeof effect.distance === 'number'
          ? effect.distance
          : params.distance !== undefined
            ? params.distance
            : null
      if (!distance) return false
      continue
    }

    if (effect.type === 'face') {
      const nextDirection = effect.directionParam === 'faceDirection' ? params.faceDirection : params.direction
      if (!params.unitId || nextDirection === undefined) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || unit.kind !== 'unit') return false
      continue
    }

    if (effect.type === 'damage') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved] ?? fallbackState?.units[resolved]
      if (!unit) return false
      if (!canCardTargetUnit(order.defId, unit)) return false
      continue
    }

    if (effect.type === 'applyUnitModifier' || effect.type === 'clearUnitModifiers') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved] ?? fallbackState?.units[resolved]
      if (!unit) return false
      if (!canCardTargetUnit(order.defId, unit)) return false
      continue
    }

    if (effect.type === 'damageTile') {
      if (!params.tile) return false
      if (!inBounds(state.boardRows, state.boardCols, params.tile)) return false
      const unit = getUnitAt(state, params.tile)
      if (unit?.kind === 'stronghold') return false
      continue
    }

    if (effect.type === 'damageTileArea') {
      if (!params.tile) return false
      if (!inBounds(state.boardRows, state.boardCols, params.tile)) return false
      const unit = getUnitAt(state, params.tile)
      if (unit?.kind === 'stronghold') return false
      continue
    }

    if (effect.type === 'budget') {
      continue
    }

    if (effect.type === 'applyPlayerModifier') {
      continue
    }

    if (effect.type === 'attack') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || unit.kind !== 'unit') return false
      const directions = resolveDirections(unit.facing, params, effect.directions)
      if (directions.length === 0) return false
      continue
    }

    if (effect.type === 'shove') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || unit.kind !== 'unit') return false
      const direction = resolveDirection(unit.facing, params, effect.direction)
      if (direction === null) return false
      continue
    }

    if (effect.type === 'whirlwind') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || unit.kind !== 'unit') return false
      continue
    }
  }
  return true
}

function resolveUnitId(state: GameState, player: PlayerId, unitId: string): UnitId | null {
  if (!unitId.startsWith('planned:')) return unitId
  const orderId = unitId.replace('planned:', '')
  const mapped = state.spawnedByOrder[orderId]
  if (mapped) return mapped
  const planned = state.players[player].orders.find((order) => order.id === orderId)
  if (planned?.defId === 'reinforce_spawn' && planned.params.tile) {
    const candidate = getUnitAt(state, planned.params.tile)
    if (candidate && candidate.owner === player) return candidate.id
  }
  return null
}

function applyEffect(state: GameState, order: Order, effect: CardEffect): void {
  const params = order.params
  switch (effect.type) {
    case 'spawn': {
      const tile = effect.tileParam === 'tile2' ? params.tile2 : params.tile
      const facing = effect.facingParam ? params.direction : effect.facing
      if (!tile || facing === undefined) return
      const kind = effect.kind ?? 'unit'
      if (kind === 'barricade' && !isValidBarricadeSpawnTile(state, order.player, tile)) {
        state.log.push(`${CARD_DEFS[order.defId].name} fails (invalid barricade tile).`)
        return
      }
      const spawnedId = spawnUnit(state, order.player, tile, facing, kind, effect.strength)
      if (spawnedId && effect.mapToOrder) {
        state.spawnedByOrder[order.id] = spawnedId
      }
      if (!spawnedId) {
        state.log.push(`${CARD_DEFS[order.defId].name} fails (tile occupied or out of bounds).`)
      }
      return
    }
    case 'boost': {
      const unitParamValue = effect.unitParam === 'unitId2' ? params.unitId2 : params.unitId
      const resolvedUnitId = unitParamValue ? resolveUnitId(state, order.player, unitParamValue) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit) return
      if (!canCardTargetUnit(order.defId, unit)) return
      if (effect.requireSpawnTile && !isSpawnTile(state, order.player, unit.pos)) return
      boostUnit(state, unit, effect.amount)
      return
    }
    case 'move': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit) return
      const direction = resolveDirection(unit.facing, params, effect.direction)
      if (direction === null) return
      const distance =
        typeof effect.distance === 'number'
          ? effect.distance
          : params.distance !== undefined
            ? params.distance
            : null
      if (!distance) return
      moveUnit(state, unit, direction, distance)
      return
    }
    case 'damage': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canCardTargetUnit(order.defId, unit)) return
      applyDamage(state, unit, effect.amount)
      return
    }
    case 'damageTile': {
      const tile = params.tile
      if (!tile) return
      const unit = getUnitAt(state, tile)
      if (!unit || !isDamageableUnit(unit)) return
      applyDamage(state, unit, effect.amount)
      return
    }
    case 'damageTileArea': {
      const tile = params.tile
      if (!tile) return
      const centerUnit = getUnitAt(state, tile)
      if (centerUnit && isDamageableUnit(centerUnit)) {
        applyDamage(state, centerUnit, effect.centerAmount)
      }
      for (let dir = 0 as Direction; dir < 6; dir += 1) {
        const neighborTile = neighbor(tile, dir)
        if (!inBounds(state.boardRows, state.boardCols, neighborTile)) continue
        const target = getUnitAt(state, neighborTile)
        if (!target || !isDamageableUnit(target)) continue
        applyDamage(state, target, effect.splashAmount)
      }
      return
    }
    case 'applyUnitModifier': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canCardTargetUnit(order.defId, unit)) return
      addUnitModifier(state, unit, effect.modifier, effect.turns)
      return
    }
    case 'clearUnitModifiers': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canCardTargetUnit(order.defId, unit)) return
      clearUnitModifiers(state, unit)
      return
    }
    case 'budget': {
      const current = state.actionBudgets[order.player] ?? 0
      state.actionBudgets[order.player] = Math.max(0, current + effect.amount)
      state.log.push(`Player ${order.player + 1} increases their action budget by ${effect.amount}.`)
      return
    }
    case 'applyPlayerModifier': {
      addPlayerModifier(state, order.player, effect.modifier, effect.amount, effect.turns)
      return
    }
    case 'face': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      const nextDirection = effect.directionParam === 'faceDirection' ? params.faceDirection : params.direction
      if (!resolvedUnitId || nextDirection === undefined) return
      const unit = state.units[resolvedUnitId]
      if (!unit || unit.kind !== 'unit') return
      unit.facing = nextDirection
      state.log.push(`Unit ${unit.id} faces ${nextDirection}.`)
      return
    }
    case 'attack': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || unit.kind !== 'unit') return
      const damage = typeof effect.damage === 'number' ? effect.damage : unit.strength
      const directions = resolveDirections(unit.facing, params, effect.directions)
      directions.forEach((dir) => {
        if (effect.mode === 'line') {
          attackRay(state, unit, dir, damage)
        } else if (effect.mode === 'ray') {
          attackLine(state, unit, dir, damage)
        } else {
          attackNearestTile(state, unit, dir, damage)
        }
      })
      return
    }
    case 'shove': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || actingUnit.kind !== 'unit') return

      const direction = resolveDirection(actingUnit.facing, params, effect.direction)
      if (direction === null) return
      const targetTile = neighbor(actingUnit.pos, direction)
      if (!inBounds(state.boardRows, state.boardCols, targetTile)) return

      const target = getUnitAt(state, targetTile)
      if (!target || !canCardTargetUnit(order.defId, target)) return

      let destination = { ...target.pos }
      let blocker: Unit | null = null
      for (let step = 0; step < effect.distance; step += 1) {
        const next = neighbor(destination, direction)
        if (!inBounds(state.boardRows, state.boardCols, next)) {
          state.log.push(`Unit ${target.id} cannot be pushed.`)
          return
        }
        const occupied = getUnitAt(state, next)
        if (occupied) {
          blocker = occupied
          break
        }
        destination = next
      }

      if (blocker) {
        state.log.push(`Unit ${target.id} collides with ${blocker.id}.`)
        applyDamage(state, target, effect.collisionDamage)
        const remainingBlocker = state.units[blocker.id]
        if (remainingBlocker) {
          applyDamage(state, remainingBlocker, effect.collisionDamage)
        }
        return
      }

      if (!sameHex(destination, target.pos)) {
        setUnitPosition(target, destination)
        state.log.push(`Unit ${target.id} is shoved to ${destination.q},${destination.r}.`)
      }
      return
    }
    case 'whirlwind': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || actingUnit.kind !== 'unit') return

      for (let dir = 0 as Direction; dir < 6; dir += 1) {
        const targetTile = neighbor(actingUnit.pos, dir)
        if (!inBounds(state.boardRows, state.boardCols, targetTile)) continue
        const target = getUnitAt(state, targetTile)
        if (!target || !canCardTargetUnit(order.defId, target)) continue
        applyDamage(state, target, effect.damage)

        const surviving = state.units[target.id]
        if (!surviving) continue
        pushUnit(state, surviving, dir, effect.pushDistance)
      }
      return
    }
    default:
      return
  }
}

function resolveDirection(facing: Direction, params: OrderParams, source: DirectionSource): Direction | null {
  if (source === 'facing') return facing
  if (typeof source === 'object' && source.type === 'param') {
    const value = source.key === 'moveDirection' ? params.moveDirection : params.direction
    if (value === undefined) return null
    return value
  }
  return null
}

function resolveDirections(facing: Direction, params: OrderParams, source: DirectionSource): Direction[] {
  if (source === 'facing') return [facing]
  if (typeof source === 'object' && source.type === 'param') {
    const value = source.key === 'moveDirection' ? params.moveDirection : params.direction
    if (value === undefined) return []
    return [value]
  }
  if (typeof source === 'object' && source.type === 'relative') {
    return source.offsets.map((offset) => rotateDirection(facing, offset))
  }
  return []
}

export function getUnitFacingVector(dir: Direction): Hex {
  return DIRECTIONS[dir]
}

export function getDirectionFromFacing(base: Direction, relative: number): Direction {
  return rotateDirection(base, relative)
}

export function getTiles(): Hex[] {
  const tiles: Hex[] = []
  for (let r = 0; r < DEFAULT_BOARD_SIZE; r += 1) {
    for (let q = 0; q < DEFAULT_BOARD_SIZE; q += 1) {
      tiles.push({ q, r })
    }
  }
  return tiles
}



