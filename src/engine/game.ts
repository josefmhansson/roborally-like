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
  PlayerClassId,
  PlayerId,
  Trap,
  TrapKind,
  Tile,
  TileKind,
  Unit,
  UnitId,
  VictoryCondition,
} from './types'
import { CARD_DEFS, STARTING_DECK, cardCountsAsType } from './cards'
import { DIRECTIONS, neighbor, offsetToAxial, rotateDirection } from './hex'

const DEFAULT_BOARD_SIZE = 6
const GENERATED_TILE_KINDS = ['grassland', 'forest', 'hills', 'mountain'] as const satisfies readonly TileKind[]
type GeneratedTileKind = (typeof GENERATED_TILE_KINDS)[number]
const TILE_BASE_WEIGHT: Record<GeneratedTileKind, number> = {
  grassland: 1.15,
  forest: 1,
  hills: 0.95,
  mountain: 0.8,
}
const SAME_KIND_BONUS = 2.2
const COMMANDER_AURA_SOURCE = 'commanderAura'
const ROGUELIKE_DEFAULT_MATCH_NUMBER = 1
let slowMoveUsage = new WeakMap<Unit, number>()

export const DEFAULT_SETTINGS = {
  boardRows: DEFAULT_BOARD_SIZE,
  boardCols: DEFAULT_BOARD_SIZE,
  leaderStrength: 5,
  deckSize: STARTING_DECK.length,
  drawPerTurn: 5,
  maxCopies: 3,
  actionBudgetP1: 3,
  actionBudgetP2: 3,
  randomizeFirstPlayer: false,
  victoryCondition: 'leader' as VictoryCondition,
}

function getVictoryCondition(state: GameState): VictoryCondition {
  return state.settings.victoryCondition ?? 'leader'
}

function hasEliminateUnitsVictory(state: GameState): boolean {
  return getVictoryCondition(state) === 'eliminate_units'
}

function getRoguelikeMatchNumber(state: Pick<GameState, 'settings'>): number {
  const raw = state.settings.roguelikeMatchNumber
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return ROGUELIKE_DEFAULT_MATCH_NUMBER
  return Math.max(ROGUELIKE_DEFAULT_MATCH_NUMBER, Math.floor(raw))
}

function isRoguelikeMonsterPlayer(state: Pick<GameState, 'settings'>, player: PlayerId): boolean {
  return player === 1 && typeof state.settings.roguelikeEncounterId === 'string'
}

function getRoguelikeMonsterDamageModifier(state: Pick<GameState, 'settings'>): number {
  return 1 + getRoguelikeMatchNumber(state) / 10
}

function scaleRoguelikeMonsterCardDamage(state: Pick<GameState, 'settings'>, player: PlayerId, damage: number): number {
  if (!Number.isFinite(damage)) return damage
  const normalized = Math.max(0, damage)
  if (normalized <= 0) return 0
  if (!isRoguelikeMonsterPlayer(state, player)) return normalized
  return Math.max(1, Math.round(normalized * getRoguelikeMonsterDamageModifier(state)))
}

function getRoguelikeUnitStrengthForRole(state: GameState, role: Unit['roguelikeRole']): number {
  const n = getRoguelikeMatchNumber(state)
  if (role === 'slime_grand') return 5 + Math.floor(n / 2)
  if (role === 'slime_mid') return 3 + Math.floor(n / 4)
  if (role === 'slime_small') return 1 + Math.floor(n / 8)
  if (role === 'troll') return 10 + Math.floor(n / 2)
  if (role === 'alpha_wolf') return 4 + Math.floor(n / 3)
  if (role === 'wolf') return 2 + Math.floor(n / 6)
  if (role === 'ice_spirit' || role === 'fire_spirit' || role === 'lightning_spirit') {
    return 2 + Math.floor(n / 3)
  }
  if (role === 'bandit') return 3 + Math.floor(n / 5)
  if (role === 'necromancer') return 4 + Math.floor(n / 4)
  if (role === 'skeleton_soldier' || role === 'skeleton_warrior' || role === 'skeleton_mage') return 2
  return 1
}

const RANDOM_SKELETON_ROLES: Array<Extract<Unit['roguelikeRole'], 'skeleton_soldier' | 'skeleton_warrior' | 'skeleton_mage'>> = [
  'skeleton_soldier',
  'skeleton_warrior',
  'skeleton_mage',
]

function sameHex(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r
}

function isDamageableUnit(unit: Unit): boolean {
  return unit.kind === 'unit' || unit.kind === 'leader' || unit.kind === 'barricade'
}

function isLeaderUnit(unit: Unit): boolean {
  return unit.kind === 'leader'
}

function canActAsUnit(unit: Unit): boolean {
  return unit.kind === 'unit' || unit.kind === 'leader'
}

function canUnitActWithCard(defId: CardDefId, unit: Unit): boolean {
  if (!canActAsUnit(unit)) return false
  if (defId === 'attack_roguelike_pack_hunt') {
    return unit.roguelikeRole === 'alpha_wolf'
  }
  if (defId === 'spell_roguelike_raise') {
    return unit.roguelikeRole === 'necromancer'
  }
  return true
}

function canTriggerTraps(unit: Unit): boolean {
  return canActAsUnit(unit)
}

function getTrapIndexAt(state: GameState, hex: Hex, owner?: PlayerId): number {
  return state.traps.findIndex((trap) => {
    if (!sameHex(trap.pos, hex)) return false
    if (owner === undefined) return true
    return trap.owner === owner
  })
}

function getTrapAt(state: GameState, hex: Hex, owner?: PlayerId): Trap | null {
  const index = getTrapIndexAt(state, hex, owner)
  if (index === -1) return null
  return state.traps[index]
}

function getOrderTileParam(params: OrderParams, key: 'tile' | 'tile2' | 'tile3'): Hex | undefined {
  if (key === 'tile2') return params.tile2
  if (key === 'tile3') return params.tile3
  return params.tile
}

function getOrderUnitParam(params: OrderParams, key: 'unitId' | 'unitId2'): UnitId | undefined {
  return key === 'unitId2' ? params.unitId2 : params.unitId
}

function isAdjacentHex(a: Hex, b: Hex): boolean {
  for (let dir = 0 as Direction; dir < 6; dir += 1) {
    if (sameHex(neighbor(a, dir), b)) return true
  }
  return false
}

function getDirectionToAdjacentTile(from: Hex, to: Hex): Direction | null {
  for (let dir = 0 as Direction; dir < 6; dir += 1) {
    if (sameHex(neighbor(from, dir), to)) return dir
  }
  return null
}

function projectAlongDirection(hex: Hex, direction: Direction): number {
  const axial = offsetToAxial(hex)
  const delta = DIRECTIONS[direction]
  return axial.q * delta.q + axial.r * delta.r
}

function hexDistance(a: Hex, b: Hex): number {
  const aAxial = offsetToAxial(a)
  const bAxial = offsetToAxial(b)
  const dq = aAxial.q - bAxial.q
  const dr = aAxial.r - bAxial.r
  const ds = -aAxial.q - aAxial.r - (-bAxial.q - bAxial.r)
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
}

function getAllowedMoveDistance(unit: Unit, requestedDistance: number): number {
  if (!hasMovementSlowModifier(unit)) return requestedDistance
  const used = slowMoveUsage.get(unit) ?? 0
  const remaining = Math.max(0, 1 - used)
  return Math.min(requestedDistance, remaining)
}

function recordSlowMovement(unit: Unit, movedDistance: number): void {
  if (movedDistance <= 0) return
  if (!hasMovementSlowModifier(unit)) return
  const used = slowMoveUsage.get(unit) ?? 0
  slowMoveUsage.set(unit, used + movedDistance)
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

function isCardTargetUnitAllowedForPlayer(defId: CardDefId, player: PlayerId, unit: Unit): boolean {
  if (!canCardTargetUnit(defId, unit)) return false
  const requirement = CARD_DEFS[defId].requires.unit
  if (requirement === 'friendly') return unit.owner === player
  if (requirement === 'enemy') return unit.owner !== player
  return true
}

function isActiveDuration(duration: ModifierDuration): boolean {
  return duration === 'indefinite' || duration > 0
}

function hasUnitModifier(unit: Unit, modifierType: Unit['modifiers'][number]['type']): boolean {
  return unit.modifiers.some((modifier) => modifier.type === modifierType && isActiveDuration(modifier.turnsRemaining))
}

function hasMovementSlowModifier(unit: Unit): boolean {
  return hasUnitModifier(unit, 'slow') || hasUnitModifier(unit, 'chilled')
}

function hasFrozenCondition(unit: Unit): boolean {
  return hasUnitModifier(unit, 'frozen')
}

function isUnitActionBlocked(unit: Unit): boolean {
  return hasUnitModifier(unit, 'stunned') || hasFrozenCondition(unit)
}

function isUnitMovementBlocked(unit: Unit): boolean {
  return hasUnitModifier(unit, 'cannotMove') || isUnitActionBlocked(unit)
}

function ensureUnitModifier(unit: Unit, modifierType: Unit['modifiers'][number]['type']): void {
  if (hasUnitModifier(unit, modifierType)) return
  unit.modifiers.push({ type: modifierType, turnsRemaining: 'indefinite' })
}

function syncFrozenModifier(unit: Unit): void {
  const shouldBeFrozen = hasUnitModifier(unit, 'chilled') && hasUnitModifier(unit, 'slow')
  const hasFrozen = hasUnitModifier(unit, 'frozen')
  if (shouldBeFrozen && !hasFrozen) {
    unit.modifiers.push({ type: 'frozen', turnsRemaining: 'indefinite' })
    return
  }
  if (!shouldBeFrozen && hasFrozen) {
    unit.modifiers = unit.modifiers.filter((modifier) => modifier.type !== 'frozen')
  }
}

function isIceSpiritsEncounter(state: Pick<GameState, 'settings'>): boolean {
  return state.settings.roguelikeEncounterId === 'ice_spirits'
}

function isNecromancerEncounter(state: Pick<GameState, 'settings'>): boolean {
  return state.settings.roguelikeEncounterId === 'necromancer'
}

function syncEncounterPersistentModifiers(state: GameState): void {
  Object.values(state.units).forEach((unit) => {
    if (unit.kind === 'unit' && unit.owner === 0 && isIceSpiritsEncounter(state)) {
      ensureUnitModifier(unit, 'chilled')
    }
    if (unit.kind === 'unit' && unit.owner === 1 && unit.roguelikeRole === 'fire_spirit') {
      ensureUnitModifier(unit, 'scalding')
    }
    if (unit.kind === 'unit' && unit.owner === 1 && unit.roguelikeRole === 'lightning_spirit') {
      ensureUnitModifier(unit, 'lightningBarrier')
    }
    if (unit.kind === 'unit' && unit.owner === 1 && unit.roguelikeRole === 'necromancer') {
      ensureUnitModifier(unit, 'slow')
      ensureUnitModifier(unit, 'spellResistance')
      ensureUnitModifier(unit, 'reinforcementPenalty')
    }
    syncFrozenModifier(unit)
  })
}

function syncUnitState(state: GameState): void {
  syncCommanderAuraStrong(state)
  syncEncounterPersistentModifiers(state)
}

function countUnitModifierStacks(unit: Unit, modifierType: Unit['modifiers'][number]['type']): number {
  return unit.modifiers.filter(
    (modifier) => modifier.type === modifierType && isActiveDuration(modifier.turnsRemaining)
  ).length
}

function hasActivePlayerModifier(
  state: Pick<GameState, 'players'>,
  player: PlayerId,
  modifierType: GameState['players'][number]['modifiers'][number]['type']
): boolean {
  return state.players[player].modifiers.some(
    (modifier) => modifier.type === modifierType && isActiveDuration(modifier.turnsRemaining)
  )
}

function isDebuffModifierType(modifierType: Unit['modifiers'][number]['type']): boolean {
  return (
    modifierType === 'cannotMove' ||
    modifierType === 'stunned' ||
    modifierType === 'slow' ||
    modifierType === 'chilled' ||
    modifierType === 'frozen' ||
    modifierType === 'reinforcementPenalty' ||
    modifierType === 'burn' ||
    modifierType === 'disarmed' ||
    modifierType === 'vulnerable'
  )
}

function isUnitModifierDebuff(modifier: Unit['modifiers'][number]): boolean {
  return isDebuffModifierType(modifier.type)
}

function getPlayerLeaderClass(
  state: Pick<GameState, 'playerClasses'>,
  player: PlayerId
): PlayerClassId | null {
  return state.playerClasses?.[player] ?? null
}

function getLeaderBaseModifiers(state: Pick<GameState, 'playerClasses'>, player: PlayerId): Unit['modifiers'] {
  const classId = getPlayerLeaderClass(state, player)
  const modifiers: Unit['modifiers'] = [
    { type: 'spellResistance', turnsRemaining: 'indefinite' },
    { type: 'reinforcementPenalty', turnsRemaining: 'indefinite' },
  ]
  if (classId !== 'warleader') {
    modifiers.unshift({ type: 'slow', turnsRemaining: 'indefinite' })
  }
  return modifiers
}

function hasCommanderLeaderAdjacencyStrong(state: GameState, unit: Unit): boolean {
  if (unit.kind !== 'unit') return false
  if (getPlayerLeaderClass(state, unit.owner) !== 'commander') return false
  const leader = state.units[`leader-${unit.owner}`]
  if (!leader || leader.kind !== 'leader') return false
  return isAdjacentHex(unit.pos, leader.pos)
}

function isCommanderAuraStrongModifier(modifier: Unit['modifiers'][number]): boolean {
  return modifier.type === 'strong' && modifier.source === COMMANDER_AURA_SOURCE
}

function syncCommanderAuraStrong(state: GameState): void {
  const shouldHaveAura = new Set<UnitId>()

  Object.values(state.units).forEach((unit) => {
    if (!hasCommanderLeaderAdjacencyStrong(state, unit)) return
    shouldHaveAura.add(unit.id)
  })

  Object.values(state.units).forEach((unit) => {
    if (unit.kind !== 'unit') return
    const hasAura = unit.modifiers.some((modifier) => isCommanderAuraStrongModifier(modifier))
    if (shouldHaveAura.has(unit.id)) {
      if (hasAura) return
      unit.modifiers.push({
        type: 'strong',
        turnsRemaining: 'indefinite',
        source: COMMANDER_AURA_SOURCE,
      })
      return
    }
    if (!hasAura) return
    unit.modifiers = unit.modifiers.filter((modifier) => !isCommanderAuraStrongModifier(modifier))
  })
}

function getDamageDealtDelta(unit: Unit | null): number {
  if (!unit) return 0
  return countUnitModifierStacks(unit, 'strong') - countUnitModifierStacks(unit, 'disarmed')
}

function getDamageTakenDelta(unit: Unit): number {
  return countUnitModifierStacks(unit, 'vulnerable')
}

function getEffectiveOrderKeywords(
  state: Pick<GameState, 'players'>,
  order: Pick<Order, 'player' | 'defId'>
): { priority: boolean; slow: boolean } {
  const baseKeywords = CARD_DEFS[order.defId].keywords ?? []
  const basePriority = baseKeywords.includes('Priority')
  const baseSlow = baseKeywords.includes('Slow')
  const addedSlow = hasActivePlayerModifier(state, order.player, 'brainFreeze')
  const priority = basePriority
  const slow = baseSlow || addedSlow
  if (priority && slow) {
    return { priority: false, slow: false }
  }
  return { priority, slow }
}

function isActingUnitRequirementForParam(defId: CardDefId, unitParam: 'unitId' | 'unitId2'): boolean {
  const def = CARD_DEFS[defId]
  if (unitParam === 'unitId' && def.requires.unit !== 'friendly') return false
  if (unitParam === 'unitId2' && def.requires.unit2 !== 'friendly') return false
  return def.effects.some(
    (effect) =>
      ((effect.type === 'move' ||
        effect.type === 'moveToTile' ||
        effect.type === 'teleport' ||
        effect.type === 'face' ||
        effect.type === 'attack' ||
        effect.type === 'attackModifier' ||
        effect.type === 'stunAdjacent' ||
        effect.type === 'chainLightning' ||
        effect.type === 'spawnSkeletonAdjacent' ||
        effect.type === 'harpoon' ||
        effect.type === 'executeForward' ||
        effect.type === 'damageAdjacent' ||
        effect.type === 'shove' ||
        effect.type === 'whirlwind' ||
        effect.type === 'packHunt' ||
        effect.type === 'lineSplash' ||
        effect.type === 'jointAttack' ||
        effect.type === 'volley') &&
        effect.unitParam === unitParam)
  )
}

function isActingUnitRequirement(defId: CardDefId): boolean {
  return isActingUnitRequirementForParam(defId, 'unitId')
}

export function canCardSelectUnit(defId: CardDefId, unit: Unit): boolean {
  if (isActingUnitRequirement(defId)) {
    return canUnitActWithCard(defId, unit)
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
    const fallback = weights.filter((entry) => entry.weight >= 0)
    const pool = fallback.length > 0 ? fallback : weights
    return pool[Math.floor(Math.random() * pool.length)].kind
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

function getSpawnHexes(rows: number, cols: number): Hex[] {
  const [topPos, bottomPos] = getLeaderPositions(rows, cols)
  const keys = new Set<string>()
  const hexes: Hex[] = []
  const anchors = [topPos, bottomPos]

  anchors.forEach((anchor) => {
    const key = `${anchor.q},${anchor.r}`
    if (!keys.has(key)) {
      keys.add(key)
      hexes.push({ ...anchor })
    }
    for (let dir = 0 as Direction; dir < 6; dir += 1) {
      const candidate = neighbor(anchor, dir)
      if (!inBounds(rows, cols, candidate)) continue
      const candidateKey = `${candidate.q},${candidate.r}`
      if (keys.has(candidateKey)) continue
      keys.add(candidateKey)
      hexes.push(candidate)
    }
  })

  return hexes
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
    const weights = GENERATED_TILE_KINDS.map((kind) => {
      const sameCount = countNeighborsOfKind(assigned, rows, cols, hex, kind)
      const weight = TILE_BASE_WEIGHT[kind] + sameCount * SAME_KIND_BONUS
      return { kind, weight }
    })
    const chosen = pickWeightedKind(weights)
    assigned.set(`${hex.q},${hex.r}`, chosen)
  })

  getSpawnHexes(rows, cols).forEach((hex) => {
    assigned.set(`${hex.q},${hex.r}`, 'grassland')
  })

  return positions.map((hex) => ({
    id: `${hex.q},${hex.r}`,
    q: hex.q,
    r: hex.r,
    kind: assigned.get(`${hex.q},${hex.r}`) ?? 'grassland',
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

function createLeader(state: Pick<GameState, 'playerClasses'>, owner: PlayerId, pos: Hex, strength: number, facing: Direction): Unit {
  return {
    id: `leader-${owner}`,
    owner,
    kind: 'leader',
    strength,
    pos,
    facing,
    modifiers: getLeaderBaseModifiers(state, owner),
  }
}

function getLeaderPositions(rows: number, cols: number): [Hex, Hex] {
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
  decks?: { p1: CardDefId[]; p2: CardDefId[] },
  playerClasses?: { p1?: PlayerClassId | null; p2?: PlayerClassId | null }
): GameState {
  const rows = settings.boardRows
  const cols = settings.boardCols
  const tiles = createTiles(rows, cols)
  const [topPos, bottomPos] = getLeaderPositions(rows, cols)
  const resolvedPlayerClasses: [PlayerClassId | null, PlayerClassId | null] = [
    playerClasses?.p1 ?? null,
    playerClasses?.p2 ?? null,
  ]
  const units: Record<UnitId, Unit> = {}
  const topFacing: Direction = 5
  const bottomFacing: Direction = 2
  const classContext: Pick<GameState, 'playerClasses'> = { playerClasses: resolvedPlayerClasses }
  units['leader-0'] = createLeader(classContext, 0, bottomPos, settings.leaderStrength, bottomFacing)
  units['leader-1'] = createLeader(classContext, 1, topPos, settings.leaderStrength, topFacing)
  const p1Front = neighbor(units['leader-0'].pos, units['leader-0'].facing)
  const p2Front = neighbor(units['leader-1'].pos, units['leader-1'].facing)
  if (inBounds(rows, cols, p1Front)) {
    const id = `u0-1`
    units[id] = createUnit(0, p1Front, units['leader-0'].facing, 2, id)
  }
  if (inBounds(rows, cols, p2Front)) {
    const id = `u1-2`
    units[id] = createUnit(1, p2Front, units['leader-1'].facing, 2, id)
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
    traps: [],
    players,
    ready: [false, false],
    actionBudgets: [settings.actionBudgetP1, settings.actionBudgetP2],
    activePlayer: settings.randomizeFirstPlayer ? (Math.random() < 0.5 ? 0 : 1) : 0,
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
    playerClasses: resolvedPlayerClasses,
    leaderMovedLastTurn: [true, true],
    turnStartLeaderPositions: [
      { ...units['leader-0'].pos },
      { ...units['leader-1'].pos },
    ],
    archmageBonusApplied: [0, 0],
  }

  syncUnitState(state)
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
  const [topPos, bottomPos] = getLeaderPositions(state.boardRows, state.boardCols)
  const anchor = player === 0 ? bottomPos : topPos
  const tiles: Hex[] = []
  tiles.push({ ...anchor })
  for (let dir = 0 as Direction; dir < 6; dir += 1) {
    const candidate = neighbor(anchor, dir)
    if (inBounds(state.boardRows, state.boardCols, candidate)) {
      tiles.push(candidate)
    }
  }
  return tiles
}

export function getBarricadeSpawnTiles(state: GameState, player: PlayerId): Hex[] {
  const candidates = new Map<string, Hex>()

  Object.values(state.units)
    .filter((unit) => unit.owner === player && (unit.kind === 'leader' || unit.kind === 'unit'))
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

function getCurrentLeaderPosition(state: GameState, player: PlayerId): Hex {
  const leader = state.units[`leader-${player}`]
  if (!leader || leader.kind !== 'leader') return { q: -1, r: -1 }
  return { ...leader.pos }
}

function getTurnStartLeaderPosition(state: GameState, player: PlayerId): Hex {
  const tracked = state.turnStartLeaderPositions?.[player]
  if (tracked) return { ...tracked }
  return getCurrentLeaderPosition(state, player)
}

function updateLeaderMovementTrackingForTurnEnd(state: GameState): void {
  const leaderMoved: [boolean, boolean] = [false, false]
  ;([0, 1] as PlayerId[]).forEach((player) => {
    const start = getTurnStartLeaderPosition(state, player)
    const end = getCurrentLeaderPosition(state, player)
    leaderMoved[player] = !sameHex(start, end)
  })
  state.leaderMovedLastTurn = leaderMoved
}

function applyArchmageTurnStartActionBudgetBonus(state: GameState): void {
  const applied: [number, number] = [
    state.archmageBonusApplied?.[0] ?? 0,
    state.archmageBonusApplied?.[1] ?? 0,
  ]
  ;([0, 1] as PlayerId[]).forEach((player) => {
    const currentApplied = applied[player] ?? 0
    if (currentApplied <= 0) return
    state.actionBudgets[player] = Math.max(0, (state.actionBudgets[player] ?? 0) - currentApplied)
    applied[player] = 0
  })

  const movedLastTurn: [boolean, boolean] = [
    state.leaderMovedLastTurn?.[0] ?? true,
    state.leaderMovedLastTurn?.[1] ?? true,
  ]
  ;([0, 1] as PlayerId[]).forEach((player) => {
    if (getPlayerLeaderClass(state, player) !== 'archmage') return
    if (movedLastTurn[player]) return
    state.actionBudgets[player] = Math.max(0, (state.actionBudgets[player] ?? 0) + 1)
    applied[player] = 1
    state.log.push(`Player ${player + 1} gains +1 action budget (Archmage leader held position).`)
  })

  state.archmageBonusApplied = applied
}

function getEncounterDrawDelta(state: GameState, player: PlayerId): number {
  const encounterId = state.settings.roguelikeEncounterId
  if (player !== 1 || !encounterId) return 0
  const matchNumber = getRoguelikeMatchNumber(state)
  if (encounterId === 'bandits') {
    const desired = 5 + Math.floor(matchNumber / 4)
    return desired - state.settings.drawPerTurn
  }
  if (encounterId === 'necromancer') {
    const skeletonCount = Object.values(state.units).filter(
      (unit) =>
        unit.owner === 1 &&
        unit.kind === 'unit' &&
        (unit.roguelikeRole === 'skeleton_soldier' ||
          unit.roguelikeRole === 'skeleton_warrior' ||
          unit.roguelikeRole === 'skeleton_mage')
    ).length
    const desired = 3 + skeletonCount
    return desired - state.settings.drawPerTurn
  }
  return 0
}

export function drawPhase(state: GameState): void {
  syncUnitState(state)
  applyArchmageTurnStartActionBudgetBonus(state)
  for (const player of [0, 1] as PlayerId[]) {
    const bonusDraw = consumePlayerDrawModifiers(state, player) + getEncounterDrawDelta(state, player)
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
    if (modifier.type !== 'extraDraw') return
    bonusDraw += modifier.amount
    if (modifier.turnsRemaining !== 'indefinite') {
      modifier.turnsRemaining -= 1
    }
  })
  playerState.modifiers = playerState.modifiers.filter((modifier) => isActiveDuration(modifier.turnsRemaining))
  return bonusDraw
}

function consumePlayerTimingModifiers(state: GameState, player: PlayerId): void {
  const playerState = state.players[player]
  playerState.modifiers.forEach((modifier) => {
    if (modifier.type !== 'brainFreeze' || !isActiveDuration(modifier.turnsRemaining)) return
    if (modifier.turnsRemaining !== 'indefinite') {
      modifier.turnsRemaining -= 1
    }
  })
  playerState.modifiers = playerState.modifiers.filter((modifier) => isActiveDuration(modifier.turnsRemaining))
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
  consumePlayerTimingModifiers(state, 0)
  consumePlayerTimingModifiers(state, 1)
  state.actionIndex = 0
  state.log.push('Orders revealed. Action phase begins.')
}

function playersReady(state: GameState): boolean {
  return state.ready[0] && state.ready[1]
}

function isPriorityOrder(state: Pick<GameState, 'players'>, order: Order): boolean {
  return getEffectiveOrderKeywords(state, order).priority
}

function isSlowOrder(state: Pick<GameState, 'players'>, order: Order): boolean {
  return getEffectiveOrderKeywords(state, order).slow
}

function getSlowTailOrderIds(state: Pick<GameState, 'players'>, playerOrders: Order[]): Set<string> {
  const slowTail = new Set<string>()
  let seenSlow = false
  playerOrders.forEach((order) => {
    if (!seenSlow && isSlowOrder(state, order)) {
      seenSlow = true
    }
    if (seenSlow) {
      slowTail.add(order.id)
    }
  })
  return slowTail
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
    if (playerOrders.length === 0) return

    let previousOrderId: string | null = null
    playerOrders.forEach((order) => {
      const currentIndex = queue.findIndex((entry) => entry.id === order.id)
      if (currentIndex === -1) return

      if (!previousOrderId) {
        if (isPriorityOrder(state, order)) {
          let targetIndex = currentIndex
          while (targetIndex > 0) {
            const left = queue[targetIndex - 1]
            if (left.player === player) break
            if (isPriorityOrder(state, left)) break
            targetIndex -= 1
          }
          if (targetIndex !== currentIndex) {
            const [moved] = queue.splice(currentIndex, 1)
            queue.splice(targetIndex, 0, moved)
          }
        }
        previousOrderId = order.id
        return
      }
      if (!isPriorityOrder(state, order)) {
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
        if (isPriorityOrder(state, left)) break
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

  const slowTailOrderIds = new Set<string>([
    ...getSlowTailOrderIds(state, state.players[0].orders),
    ...getSlowTailOrderIds(state, state.players[1].orders),
  ])
  if (slowTailOrderIds.size === 0) return queue
  const nonSlow = queue.filter((order) => !slowTailOrderIds.has(order.id))
  const slow = queue.filter((order) => slowTailOrderIds.has(order.id))
  return [...nonSlow, ...slow]
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

  const traps = state.traps.map((trap) => ({
    ...trap,
    pos: { ...trap.pos },
  }))

  const sim: GameState = {
    ...state,
    units,
    traps,
    players,
    actionQueue: [],
    actionIndex: 0,
    winner: null,
    spawnedByOrder: {},
    log: [],
  }

  syncUnitState(sim)
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

  const traps = state.traps.map((trap) => ({
    ...trap,
    pos: { ...trap.pos },
  }))

  const sim: GameState = {
    ...state,
    units,
    traps,
    players,
    actionQueue: [],
    actionIndex: 0,
    winner: null,
    spawnedByOrder: {},
    log: [],
  }

  syncUnitState(sim)
  const segments: { from: Hex; to: Hex }[] = []

  for (const order of state.players[player].orders) {
    const def = CARD_DEFS[order.defId]
    const context: OrderResolutionContext = {
      movedUnitOrigins: {},
      lastMoveSucceededByUnit: {},
      resolvedCompositeEffects: new Set(),
    }
    for (const effect of def.effects) {
      if (effect.type === 'move') {
        const params = order.params
        if (!params.unitId) continue
        const resolvedUnitId = resolveUnitId(sim, order.player, params.unitId)
        if (!resolvedUnitId) continue
        const unit = sim.units[resolvedUnitId]
        if (!unit) continue
        if (!context.movedUnitOrigins[resolvedUnitId]) {
          context.movedUnitOrigins[resolvedUnitId] = { ...unit.pos }
        }
        if (order.defId === 'move_tandem') {
          continue
        }
        const start = { ...unit.pos }
        const direction = resolveDirection(unit.facing, params, effect.direction)
        if (direction === null) continue
        const distance =
          typeof effect.distance === 'number'
            ? effect.distance
            : params.distance !== undefined
              ? params.distance
              : null
        if (!distance) continue
        const end = moveUnitWithPath(sim, unit, direction, distance)
        if (end && (end.q !== start.q || end.r !== start.r)) {
          segments.push({ from: start, to: end })
        }
        continue
      }
      if (effect.type === 'moveToTile') {
        if (order.defId === 'move_double_steps') {
          if (context.resolvedCompositeEffects.has('move_double_steps')) continue
          const beforePositions = new Map<string, Hex>()
          Object.values(sim.units).forEach((unit) => {
            beforePositions.set(unit.id, { ...unit.pos })
          })
          applyEffect(sim, order, effect, context)
          beforePositions.forEach((from, unitId) => {
            const afterUnit = sim.units[unitId]
            if (!afterUnit || sameHex(from, afterUnit.pos)) return
            segments.push({ from, to: { ...afterUnit.pos } })
          })
          continue
        }
        const rawUnitId = getOrderUnitParam(order.params, effect.unitParam)
        if (!rawUnitId) continue
        const resolvedUnitId = resolveUnitId(sim, order.player, rawUnitId)
        if (!resolvedUnitId) continue
        const unit = sim.units[resolvedUnitId]
        if (!unit) continue
        const start = { ...unit.pos }
        applyEffect(sim, order, effect, context)
        const movedUnit = sim.units[resolvedUnitId]
        if (!movedUnit) continue
        if (!sameHex(start, movedUnit.pos)) {
          segments.push({ from: start, to: { ...movedUnit.pos } })
        }
        continue
      }
      if (effect.type === 'moveAdjacentFriendlyGroup' || effect.type === 'convergeTowardTile') {
        const beforePositions = new Map<string, Hex>()
        Object.values(sim.units).forEach((unit) => {
          beforePositions.set(unit.id, { ...unit.pos })
        })
        applyEffect(sim, order, effect, context)
        beforePositions.forEach((from, unitId) => {
          const afterUnit = sim.units[unitId]
          if (!afterUnit) return
          const to = afterUnit.pos
          if (from.q === to.q && from.r === to.r) return
          segments.push({ from, to: { ...to } })
        })
        continue
      }
      else if (
        effect.type !== 'budget' &&
        effect.type !== 'chainLightning' &&
        effect.type !== 'chainLightningAllFriendly'
      ) {
        applyEffect(sim, order, effect, context)
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

  const simTraps = state.traps.map((trap) => ({
    ...trap,
    pos: { ...trap.pos },
  }))

  const sim: GameState = {
    ...state,
    units: simUnits,
    traps: simTraps,
    players: simPlayers,
    actionQueue: [],
    actionIndex: 0,
    winner: null,
    spawnedByOrder: {},
    log: [],
  }

  syncUnitState(sim)
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
  updateLeaderMovementTrackingForTurnEnd(state)
  slowMoveUsage = new WeakMap<Unit, number>()
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
  state.turnStartLeaderPositions = [getCurrentLeaderPosition(state, 0), getCurrentLeaderPosition(state, 1)]
}

function tickUnitModifiers(state: GameState): void {
  const unitIds = Object.keys(state.units)
  unitIds.forEach((unitId) => {
    const unit = state.units[unitId]
    if (!unit) return
    if (unit.modifiers.length === 0) return

    const burnEntries = unit.modifiers.filter(
      (modifier) => modifier.type === 'burn' && isActiveDuration(modifier.turnsRemaining)
    )
    if (burnEntries.length > 0) {
      state.log.push(`Burn deals 1 damage to unit ${unit.id}.`)
      applyDamage(state, unit, 1)
    }

    const afterDamage = state.units[unitId]
    if (!afterDamage) return
    const regenerationStacks = afterDamage.modifiers.filter(
      (modifier) => modifier.type === 'regeneration' && isActiveDuration(modifier.turnsRemaining)
    ).length
    if (regenerationStacks > 0) {
      afterDamage.strength += regenerationStacks
      state.log.push(`Regeneration heals unit ${afterDamage.id} for ${regenerationStacks}.`)
    }
    const firstBurn = afterDamage.modifiers.find((modifier) => modifier.type === 'burn')
    if (firstBurn) {
      afterDamage.modifiers = afterDamage.modifiers.filter((modifier) => modifier.type !== 'burn' || modifier === firstBurn)
    }
    if (hasUnitModifier(afterDamage, 'lightningBarrier')) {
      let hitAnyTarget = false
      for (let dir = 0 as Direction; dir < 6; dir += 1) {
        const targetTile = neighbor(afterDamage.pos, dir)
        if (!inBounds(state.boardRows, state.boardCols, targetTile)) continue
        const target = getUnitAt(state, targetTile)
        if (!target || target.owner === afterDamage.owner || !isDamageableUnit(target)) continue
        hitAnyTarget = true
        state.log.push(`Lightning barrier arcs from unit ${afterDamage.id} to unit ${target.id}.`)
        applyDamage(state, target, 1, afterDamage)
        if (!state.units[afterDamage.id]) return
      }
      if (!hitAnyTarget) {
        state.log.push(`Lightning barrier on unit ${afterDamage.id} crackles but finds no adjacent targets.`)
      }
    }
    if (hasUnitModifier(afterDamage, 'berserk')) {
      destroyUnit(state, afterDamage)
      return
    }
    afterDamage.modifiers.forEach((modifier) => {
      if (modifier.turnsRemaining === 'indefinite') return
      modifier.turnsRemaining -= 1
    })
    afterDamage.modifiers = afterDamage.modifiers.filter((modifier) => isActiveDuration(modifier.turnsRemaining))
    syncFrozenModifier(afterDamage)
  })
  Object.values(state.units).forEach((unit) => {
    if (!isLeaderUnit(unit)) return
    const baseModifiers = getLeaderBaseModifiers(state, unit.owner)
    baseModifiers.forEach((baseModifier) => {
      if (hasUnitModifier(unit, baseModifier.type)) return
      unit.modifiers.unshift({ ...baseModifier })
    })
  })
  syncEncounterPersistentModifiers(state)
}

function validateUnitRequirementParam(
  state: GameState,
  player: PlayerId,
  defId: CardDefId,
  requirement: 'friendly' | 'enemy' | 'any',
  rawUnitId: string | undefined,
  unitParam: 'unitId' | 'unitId2',
  fallbackState?: GameState
): boolean {
  if (!rawUnitId) return false
  const normalizedUnitId = normalizeLegacyLeaderUnitId(rawUnitId)
  const requireActingUnit = isActingUnitRequirementForParam(defId, unitParam)
  if (requirement === 'friendly') {
    if (isPlannedUnitReference(state, player, normalizedUnitId)) {
      return !requireActingUnit || Boolean(resolveUnitId(state, player, normalizedUnitId))
    }
    const resolvedUnitId = resolveUnitId(state, player, normalizedUnitId)
    if (!resolvedUnitId) return false
    const unit = state.units[resolvedUnitId]
    if (!unit) return false
    if (unit.owner !== player) return false
    if (requireActingUnit) {
      if (!canUnitActWithCard(defId, unit)) return false
      return true
    }
    return canCardTargetUnit(defId, unit)
  }

  if (isPlannedUnitReference(state, player, normalizedUnitId)) return false
  const resolvedUnitId = resolveUnitId(state, player, normalizedUnitId)
  const unit =
    (resolvedUnitId ? state.units[resolvedUnitId] : undefined) ??
    fallbackState?.units[normalizedUnitId] ??
    (resolvedUnitId ? fallbackState?.units[resolvedUnitId] : undefined)
  if (!unit) return false
  if (requirement === 'enemy' && unit.owner === player) return false
  return canCardTargetUnit(defId, unit)
}

function validateOrderParams(
  state: GameState,
  player: PlayerId,
  defId: CardDefId,
  params: OrderParams,
  fallbackState?: GameState
): boolean {
  const def = CARD_DEFS[defId]
  if (def.requires.unit && !validateUnitRequirementParam(state, player, defId, def.requires.unit, params.unitId, 'unitId', fallbackState)) {
    return false
  }
  if (
    def.requires.unit2 &&
    !validateUnitRequirementParam(state, player, defId, def.requires.unit2, params.unitId2, 'unitId2', fallbackState)
  ) {
    if (defId !== 'move_double_steps' || hasResolvableDoubleStepsFollowUp(state, player, params.unitId, params.tile)) {
      return false
    }
  }
  if (def.requires.unit2 && params.unitId && params.unitId2) {
    if (normalizeLegacyLeaderUnitId(params.unitId) === normalizeLegacyLeaderUnitId(params.unitId2)) return false
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
  if (def.requires.tile2 === 'any') {
    if (!params.tile2) {
      if (defId !== 'move_double_steps' || hasResolvableDoubleStepsFollowUp(state, player, params.unitId, params.tile)) {
        return false
      }
    } else if (!inBounds(state.boardRows, state.boardCols, params.tile2)) {
      return false
    }
  }
  if (def.requires.tile3 === 'any') {
    if (!params.tile3) return false
    if (!inBounds(state.boardRows, state.boardCols, params.tile3)) return false
  }
  if (def.requires.direction && params.direction === undefined) return false
  if (def.requires.moveDirection && params.moveDirection === undefined) return false
  if (def.requires.faceDirection && params.faceDirection === undefined) return false
  if (def.requires.distanceOptions && params.distance === undefined) return false
  if (def.requires.distanceOptions && params.distance !== undefined) {
    if (!def.requires.distanceOptions.includes(params.distance)) return false
  }
  for (const effect of def.effects) {
    if (effect.type !== 'volley') continue
    const resolvedUnitId = params.unitId ? resolveUnitId(state, player, params.unitId) : null
    const tile = getOrderTileParam(params, effect.tileParam)
    if (!resolvedUnitId || !tile) return false
    const unit = state.units[resolvedUnitId]
    if (!unit || !canActAsUnit(unit)) return false
    if (hexDistance(unit.pos, tile) > effect.radius) return false
  }
  return true
}

type PlannedUnitReference = {
  orderId: string
  spawnKey: 'tile' | 'tile2' | null
}

function parsePlannedUnitReference(unitId: string): PlannedUnitReference | null {
  if (!unitId.startsWith('planned:')) return null
  const raw = unitId.replace('planned:', '')
  if (!raw) return null
  const separator = raw.indexOf(':')
  if (separator === -1) return { orderId: raw, spawnKey: null }
  const orderId = raw.slice(0, separator)
  const spawnKey = raw.slice(separator + 1)
  if (!orderId || (spawnKey !== 'tile' && spawnKey !== 'tile2')) return null
  return { orderId, spawnKey }
}

function normalizeLegacyLeaderUnitId(unitId: string): UnitId {
  return unitId.startsWith('stronghold-') ? (`leader-${unitId.slice('stronghold-'.length)}` as UnitId) : unitId
}

function isMappedPlannedSpawnEffect(
  effect: CardEffect
): effect is Extract<CardEffect, { type: 'spawn' | 'spawnAdjacentFriendly' }> {
  if (effect.type === 'spawn') return !!effect.mapToOrder
  if (effect.type === 'spawnAdjacentFriendly') return !!effect.mapToOrder
  return false
}

function getSpawnMapKey(orderId: string, tileParam: 'tile' | 'tile2'): string {
  return `${orderId}:${tileParam}`
}

function registerSpawnedByOrder(
  state: GameState,
  orderId: string,
  tileParam: 'tile' | 'tile2',
  spawnedId: UnitId
): void {
  state.spawnedByOrder[getSpawnMapKey(orderId, tileParam)] = spawnedId
  if (!state.spawnedByOrder[orderId]) {
    state.spawnedByOrder[orderId] = spawnedId
  }
}

function isPlannedUnitReference(state: GameState, player: PlayerId, unitId: string): boolean {
  const plannedRef = parsePlannedUnitReference(unitId)
  if (!plannedRef) return false
  const planned = state.players[player].orders.find((order) => order.id === plannedRef.orderId)
  if (!planned) return false
  return CARD_DEFS[planned.defId].effects.some((effect) => {
    if (!isMappedPlannedSpawnEffect(effect)) return false
    if (!plannedRef.spawnKey) return true
    return effect.tileParam === plannedRef.spawnKey
  })
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
  strength: number,
  roguelikeRole?: Unit['roguelikeRole']
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
    roguelikeRole,
  }
  if (kind === 'barricade') {
    state.log.push(`Player ${player + 1} spawns a barricade at ${tile.q},${tile.r}.`)
  } else {
    state.log.push(`Player ${player + 1} spawns a unit at ${tile.q},${tile.r}.`)
  }
  triggerTrapAtCurrentTile(state, state.units[id])
  return id
}

function getDefaultSpawnFacing(state: GameState, player: PlayerId): Direction {
  const leader = state.units[`leader-${player}`]
  if (leader && leader.kind === 'leader') {
    return leader.facing
  }
  return (player === 0 ? 2 : 5) as Direction
}

function placeTrap(
  state: GameState,
  player: PlayerId,
  tile: Hex,
  trapKind: TrapKind,
  sourceCardName: string
): boolean {
  if (!inBounds(state.boardRows, state.boardCols, tile)) return false
  if (getUnitAt(state, tile)) return false
  if (getTrapAt(state, tile)) return false
  const trapId = `t-${player}-${state.turn}-${state.actionIndex}-${tile.q},${tile.r}-${trapKind}`
  state.traps.push({
    id: trapId,
    owner: player,
    kind: trapKind,
    pos: { ...tile },
  })
  state.log.push(`Player ${player + 1} sets a hidden trap with ${sourceCardName}.`)
  return true
}

function boostUnit(state: GameState, unit: Unit, amount: number): void {
  const resolvedAmount = hasUnitModifier(unit, 'reinforcementPenalty') ? Math.floor(amount / 2) : amount
  if (resolvedAmount <= 0) {
    state.log.push(`Unit ${unit.id} gains no strength.`)
    return
  }
  unit.strength += resolvedAmount
  state.log.push(`Unit ${unit.id} gains ${resolvedAmount} strength.`)
}

function addUnitModifier(state: GameState, unit: Unit, modifier: Unit['modifiers'][number]['type'], turns: ModifierDuration): void {
  const normalizedTurns = normalizeDuration(turns)
  if (!normalizedTurns) return
  if (isDebuffModifierType(modifier) && hasUnitModifier(unit, 'undying')) {
    state.log.push(`Unit ${unit.id} ignores ${modifier} because of Undying.`)
    return
  }
  if (modifier === 'vulnerable' || modifier === 'strong') {
    unit.modifiers.push({ type: modifier, turnsRemaining: normalizedTurns })
    syncFrozenModifier(unit)
    const durationLabel = normalizedTurns === 'indefinite' ? 'indefinitely' : `for ${normalizedTurns} turn(s)`
    const stacks = unit.modifiers.filter(
      (entry) => entry.type === modifier && isActiveDuration(entry.turnsRemaining)
    ).length
    state.log.push(`Unit ${unit.id} is affected: ${modifier} ${durationLabel} (stacks: ${stacks}).`)
    return
  }
  const existing = unit.modifiers.find((entry) => entry.type === modifier)
  if (existing) {
    existing.turnsRemaining = mergeDurations(existing.turnsRemaining, normalizedTurns)
  } else {
    unit.modifiers.push({ type: modifier, turnsRemaining: normalizedTurns })
  }
  syncFrozenModifier(unit)
  const durationLabel = normalizedTurns === 'indefinite' ? 'indefinitely' : `for ${normalizedTurns} turn(s)`
  state.log.push(`Unit ${unit.id} is affected: ${modifier} ${durationLabel}.`)
}

function clearUnitDebuffs(state: GameState, unit: Unit): void {
  const remaining = unit.modifiers.filter((modifier) => !isUnitModifierDebuff(modifier))
  if (remaining.length === unit.modifiers.length) return
  unit.modifiers = remaining
  syncFrozenModifier(unit)
  state.log.push(`Unit ${unit.id} has debuffs removed.`)
}

function clearUnitModifiers(state: GameState, unit: Unit): void {
  if (unit.modifiers.length === 0) return
  if (isLeaderUnit(unit)) {
    const baseModifiers = getLeaderBaseModifiers(state, unit.owner)
    const baseTypes = new Set(baseModifiers.map((modifier) => modifier.type))
    const hadRemovable = unit.modifiers.some((modifier) => !baseTypes.has(modifier.type))
    unit.modifiers = baseModifiers
    syncFrozenModifier(unit)
    if (hadRemovable) {
      state.log.push(`Unit ${unit.id} has removable modifiers removed.`)
    }
    return
  }
  unit.modifiers = []
  syncFrozenModifier(unit)
  state.log.push(`Unit ${unit.id} has all modifiers removed.`)
}

function addPlayerModifier(
  state: GameState,
  player: PlayerId,
  modifier: 'extraDraw' | 'brainFreeze',
  amount: number,
  turns: ModifierDuration
): void {
  const normalizedAmount = Math.max(0, Math.floor(amount))
  const normalizedTurns = normalizeDuration(turns)
  if (!normalizedTurns) return
  if (modifier === 'extraDraw' && normalizedAmount <= 0) return
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
  if (modifier === 'extraDraw') {
    state.log.push(`Player ${player + 1} gains ${normalizedAmount} extra draw ${durationLabel}.`)
    return
  }
  state.log.push(`Player ${player + 1} suffers Brain Freeze ${durationLabel}.`)
}

function countsForEliminationObjective(unit: Unit): boolean {
  return unit.kind === 'unit' && !unit.isMinion
}

function hasUnitsForEliminationObjective(state: GameState, player: PlayerId): boolean {
  return Object.values(state.units).some((unit) => unit.owner === player && countsForEliminationObjective(unit))
}

function checkVictoryConditions(state: GameState): void {
  if (state.winner !== null) return
  if (!hasEliminateUnitsVictory(state)) return
  if (state.settings.roguelikeEncounterId) {
    const encounterUnitsRemain = hasUnitsForEliminationObjective(state, 1)
    if (!encounterUnitsRemain) {
      state.winner = 0
      state.log.push('Player 1 wins by eliminating all enemy units.')
    }
    return
  }
  const p1HasUnits = hasUnitsForEliminationObjective(state, 0)
  const p2HasUnits = hasUnitsForEliminationObjective(state, 1)
  if (!p1HasUnits && !p2HasUnits) return
  if (!p1HasUnits) {
    state.winner = 1
    state.log.push('Player 2 wins by eliminating all enemy units.')
    return
  }
  if (!p2HasUnits) {
    state.winner = 0
    state.log.push('Player 1 wins by eliminating all enemy units.')
  }
}

function getSlimeSplitChildRole(role: Unit['roguelikeRole']): Unit['roguelikeRole'] | null {
  if (role === 'slime_grand') return 'slime_mid'
  if (role === 'slime_mid') return 'slime_small'
  return null
}

function pickRandomSkeletonRole(): Extract<Unit['roguelikeRole'], 'skeleton_soldier' | 'skeleton_warrior' | 'skeleton_mage'> {
  const index = Math.floor(Math.random() * RANDOM_SKELETON_ROLES.length)
  return RANDOM_SKELETON_ROLES[Math.max(0, Math.min(index, RANDOM_SKELETON_ROLES.length - 1))]
}

function getSkeletonRoleForDestroyedPlayerUnit(
  state: Pick<GameState, 'playerClasses'>,
  unit: Unit
): Extract<Unit['roguelikeRole'], 'skeleton_soldier' | 'skeleton_warrior' | 'skeleton_mage'> {
  const classId = getPlayerLeaderClass(state, unit.owner)
  if (classId === 'archmage') return 'skeleton_mage'
  if (classId === 'warleader') return 'skeleton_warrior'
  return 'skeleton_soldier'
}

function findNearestOpenTileForSplit(state: GameState, origin: Hex): Hex | null {
  let nearest: Hex | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  state.tiles.forEach((tile) => {
    const candidate = { q: tile.q, r: tile.r }
    if (sameHex(candidate, origin)) return
    if (getUnitAt(state, candidate)) return

    const distance = hexDistance(origin, candidate)
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
      return
    }
    if (distance > nearestDistance || !nearest) return
    if (candidate.r < nearest.r || (candidate.r === nearest.r && candidate.q < nearest.q)) {
      nearest = candidate
    }
  })

  return nearest
}

function maybeSplitDestroyedSlime(state: GameState, destroyed: Unit): void {
  const childRole = getSlimeSplitChildRole(destroyed.roguelikeRole)
  if (!childRole) return
  const childStrength = getRoguelikeUnitStrengthForRole(state, childRole)
  for (let i = 0; i < 2; i += 1) {
    const tile = findNearestOpenTileForSplit(state, destroyed.pos)
    if (!tile) break
    const spawnedId = spawnUnit(state, destroyed.owner, tile, destroyed.facing, 'unit', childStrength, childRole)
    if (!spawnedId) continue
    state.log.push(
      `Slime split: ${destroyed.id} lobs from ${destroyed.pos.q},${destroyed.pos.r} to ${tile.q},${tile.r}.`
    )
  }
}

function spawnSkeletonAtTile(
  state: GameState,
  tile: Hex,
  facing: Direction,
  role: Extract<Unit['roguelikeRole'], 'skeleton_soldier' | 'skeleton_warrior' | 'skeleton_mage'>
): UnitId | null {
  const spawnedId = spawnUnit(state, 1, tile, facing, 'unit', 2, role)
  if (!spawnedId) return null
  const spawned = state.units[spawnedId]
  if (spawned) {
    spawned.isMinion = true
  }
  return spawnedId
}

function maybeSpawnNecromancerSkeletonFromDestroyedPlayerUnit(state: GameState, destroyed: Unit): void {
  if (!isNecromancerEncounter(state)) return
  if (destroyed.owner !== 0 || destroyed.kind !== 'unit') return
  const role = getSkeletonRoleForDestroyedPlayerUnit(state, destroyed)
  const spawnedId = spawnSkeletonAtTile(state, destroyed.pos, destroyed.facing, role)
  if (spawnedId) {
    state.log.push(`Necromancy raises ${spawnedId} from ${destroyed.id}'s remains.`)
  }
}

function destroyUnit(state: GameState, destroyed: Unit, logEntry = `Unit ${destroyed.id} is destroyed.`): void {
  delete state.units[destroyed.id]
  state.log.push(logEntry)
  maybeSplitDestroyedSlime(state, destroyed)
  maybeSpawnNecromancerSkeletonFromDestroyedPlayerUnit(state, destroyed)
  if (isLeaderUnit(destroyed)) {
    state.winner = destroyed.owner === 0 ? 1 : 0
    state.log.push(`Player ${state.winner + 1} wins by defeating the enemy leader.`)
    return
  }
  checkVictoryConditions(state)
}

function splitUnit(state: GameState, unit: Unit): boolean {
  if (unit.kind !== 'unit') return false
  const splitTile = findNearestOpenTileForSplit(state, unit.pos)
  if (!splitTile) return false

  const childStrength = Math.max(1, Math.ceil(unit.strength / 2))
  const childModifiers = unit.modifiers.map((modifier) => ({ ...modifier }))
  const extraRole = unit.roguelikeRole

  unit.strength = childStrength
  unit.modifiers = childModifiers.map((modifier) => ({ ...modifier }))
  syncFrozenModifier(unit)

  const spawnedId = spawnUnit(state, unit.owner, splitTile, unit.facing, 'unit', childStrength, extraRole)
  if (!spawnedId) return false
  const spawned = state.units[spawnedId]
  if (spawned) {
    spawned.modifiers = childModifiers.map((modifier) => ({ ...modifier }))
    spawned.isMinion = true
    syncFrozenModifier(spawned)
  }
  state.log.push(`Split: ${unit.id} lobs from ${unit.pos.q},${unit.pos.r} to ${splitTile.q},${splitTile.r}.`)
  return true
}

type DamageOptions = {
  allowSpikes?: boolean
  ignoreUndying?: boolean
}

function applyDamage(
  state: GameState,
  unit: Unit,
  amount: number,
  sourceUnit?: Unit | null,
  sourceDefId?: CardDefId,
  options: DamageOptions = {}
): void {
  syncUnitState(state)
  const liveUnit = state.units[unit.id] ?? unit
  const liveSourceUnit = sourceUnit ? (state.units[sourceUnit.id] ?? null) : null
  if (!options.ignoreUndying && hasUnitModifier(liveUnit, 'undying')) {
    state.log.push(`Unit ${liveUnit.id} is protected by Undying.`)
    return
  }
  const dealtDelta = getDamageDealtDelta(liveSourceUnit)
  const takenDelta = getDamageTakenDelta(liveUnit)
  let resolvedDamage = Math.max(0, amount + dealtDelta + takenDelta)
  const isSpellDamage = sourceDefId ? cardCountsAsType(sourceDefId, 'spell') : false
  if (isSpellDamage && isLeaderUnit(liveUnit) && hasUnitModifier(liveUnit, 'spellResistance')) {
    resolvedDamage = Math.floor(resolvedDamage / 2)
  }
  const hadSpikes = hasUnitModifier(liveUnit, 'spikes')
  liveUnit.strength -= resolvedDamage
  state.log.push(`Unit ${liveUnit.id} takes ${resolvedDamage} damage.`)
  if ((options.allowSpikes ?? true) && hadSpikes && resolvedDamage > 0 && liveSourceUnit) {
    state.log.push(`Spikes reflect 1 damage to unit ${liveSourceUnit.id}.`)
    applyDamage(state, liveSourceUnit, 1, null, undefined, { allowSpikes: false })
  }
  const targetAfterDamage = state.units[liveUnit.id]
  if (
    targetAfterDamage &&
    targetAfterDamage.strength > 0 &&
    liveSourceUnit &&
    sourceDefId &&
    cardCountsAsType(sourceDefId, 'attack') &&
    hasUnitModifier(liveSourceUnit, 'scalding')
  ) {
    addUnitModifier(state, targetAfterDamage, 'burn', 'indefinite')
  }
  if (liveUnit.strength <= 0) {
    destroyUnit(state, liveUnit)
  }
}

function getLiveDamageSourceUnit(state: GameState, sourceUnit: Unit | null | undefined): Unit | null {
  if (!sourceUnit) return null
  const liveSourceUnit = state.units[sourceUnit.id]
  if (!liveSourceUnit || !canActAsUnit(liveSourceUnit)) return null
  return liveSourceUnit
}

function applyRepeatedUnitSourcedDamage(
  state: GameState,
  sourceUnits: Unit[],
  damage: number,
  sourceDefId: CardDefId,
  getTargetForSource: (liveSourceUnit: Unit) => Unit | null
): void {
  sourceUnits.forEach((sourceUnit) => {
    const liveSourceUnit = getLiveDamageSourceUnit(state, sourceUnit)
    if (!liveSourceUnit) return
    const target = getTargetForSource(liveSourceUnit)
    if (!target) return
    applyDamage(state, target, damage, liveSourceUnit, sourceDefId)
  })
}

function triggerTrapAtCurrentTile(state: GameState, unit: Unit): { stopMovement: boolean } {
  if (state.phase !== 'action') return { stopMovement: false }
  if (!canTriggerTraps(unit)) return { stopMovement: false }
  const trapIndex = state.traps.findIndex((trap) => sameHex(trap.pos, unit.pos))
  if (trapIndex === -1) return { stopMovement: false }

  const [trap] = state.traps.splice(trapIndex, 1)
  const trapLabel = trap.kind === 'pitfall' ? 'bear' : trap.kind
  state.log.push(`Unit ${unit.id} triggers a ${trapLabel} trap at ${unit.pos.q},${unit.pos.r}.`)
  if (trap.kind === 'pitfall') {
    applyDamage(state, unit, 2)
    const surviving = state.units[unit.id]
    if (surviving) {
      addUnitModifier(state, surviving, 'cannotMove', 2)
      return { stopMovement: true }
    }
    return { stopMovement: true }
  }

  applyDamage(state, unit, 3)
  return { stopMovement: false }
}

function moveUnit(state: GameState, unit: Unit, direction: Direction, distance: number): void {
  if (!canActAsUnit(unit)) return
  if (isUnitMovementBlocked(unit)) {
    state.log.push(`Unit ${unit.id} cannot move this turn.`)
    return
  }
  const maxDistance = getAllowedMoveDistance(unit, distance)
  let movedDistance = 0
  let current = { ...unit.pos }
  let movedUnit: Unit = unit
  let stoppedByTrap = false
  let destroyedByTrap = false
  for (let step = 0; step < maxDistance; step += 1) {
    const next = neighbor(current, direction)
    if (!inBounds(state.boardRows, state.boardCols, next)) break
    if (getUnitAt(state, next)) break
    current = next
    setUnitPosition(movedUnit, current)
    movedDistance += 1
    const trapResolution = triggerTrapAtCurrentTile(state, movedUnit)
    const surviving = state.units[movedUnit.id]
    if (!surviving) {
      stoppedByTrap = trapResolution.stopMovement
      destroyedByTrap = true
      break
    }
    movedUnit = surviving
    if (trapResolution.stopMovement) {
      stoppedByTrap = true
      break
    }
  }
  if (movedDistance > 0) {
    if (!destroyedByTrap) {
      recordSlowMovement(movedUnit, movedDistance)
    }
    state.log.push(`Unit ${unit.id} moves to ${current.q},${current.r}.`)
    if (stoppedByTrap) {
      state.log.push(`Unit ${unit.id} is stopped by a trap.`)
    }
    if (destroyedByTrap) return
  } else {
    state.log.push(`Unit ${unit.id} cannot move.`)
  }
}

function moveUnitWithPath(state: GameState, unit: Unit, direction: Direction, distance: number): Hex | null {
  if (!canActAsUnit(unit)) return null
  if (isUnitMovementBlocked(unit)) {
    return { ...unit.pos }
  }
  const maxDistance = getAllowedMoveDistance(unit, distance)
  let movedDistance = 0
  let current = { ...unit.pos }
  let movedUnit: Unit = unit
  for (let step = 0; step < maxDistance; step += 1) {
    const next = neighbor(current, direction)
    if (!inBounds(state.boardRows, state.boardCols, next)) break
    if (getUnitAt(state, next)) break
    current = next
    setUnitPosition(movedUnit, current)
    movedDistance += 1
    const trapResolution = triggerTrapAtCurrentTile(state, movedUnit)
    const surviving = state.units[movedUnit.id]
    if (!surviving) return null
    movedUnit = surviving
    if (trapResolution.stopMovement) break
  }
  recordSlowMovement(movedUnit, movedDistance)
  return current
}

function moveUnitToTile(state: GameState, unit: Unit, tile: Hex, faceMovedDirection = false): boolean {
  const direction = getDirectionToAdjacentTile(unit.pos, tile)
  if (direction === null) {
    state.log.push(`Unit ${unit.id} cannot move.`)
    return false
  }
  const start = { ...unit.pos }
  moveUnit(state, unit, direction, 1)
  const movedUnit = state.units[unit.id]
  if (!movedUnit) return false
  const moved = !sameHex(start, movedUnit.pos)
  if (moved && faceMovedDirection) {
    movedUnit.facing = direction
    state.log.push(`Unit ${movedUnit.id} faces ${direction}.`)
  }
  return moved
}

function getCommanderSupportParticipants(
  state: GameState,
  player: PlayerId,
  tile: Hex,
  excludeUnitId?: UnitId
): Unit[] {
  return Object.values(state.units)
    .filter(
      (unit) =>
        unit.owner === player &&
        unit.id !== excludeUnitId &&
        canActAsUnit(unit) &&
        !isUnitActionBlocked(unit) &&
        isAdjacentHex(unit.pos, tile)
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}

function getPincerAttackParticipants(state: GameState, player: PlayerId, tile: Hex): Unit[] {
  const participants: Unit[] = []
  for (let dir = 0 as Direction; dir < 6; dir += 1) {
    const adjacent = neighbor(tile, dir)
    if (!inBounds(state.boardRows, state.boardCols, adjacent)) return []
    const unit = getUnitAt(state, adjacent)
    if (!unit || unit.owner !== player || !canActAsUnit(unit) || isUnitActionBlocked(unit)) {
      return []
    }
    participants.push(unit)
  }
  return participants.sort((a, b) => a.id.localeCompare(b.id))
}

function moveUnitFormation(state: GameState, unitIds: UnitId[], direction: Direction, distance: number): void {
  const participants = unitIds.filter((unitId) => {
    const unit = state.units[unitId]
    return Boolean(unit && canActAsUnit(unit))
  })
  if (participants.length === 0) return

  const participantSet = new Set(participants)
  const remainingSteps = new Map<UnitId, number>()
  const movedSteps = new Map<UnitId, number>()
  const stoppedByTrap = new Set<UnitId>()
  const cannotMoveLogged = new Set<UnitId>()
  const lastKnownPositions = new Map<UnitId, Hex>()

  participants.forEach((unitId) => {
    const unit = state.units[unitId]
    if (!unit || !canActAsUnit(unit)) return
    lastKnownPositions.set(unitId, { ...unit.pos })
    movedSteps.set(unitId, 0)
    if (isUnitMovementBlocked(unit)) {
      state.log.push(`Unit ${unit.id} cannot move this turn.`)
      cannotMoveLogged.add(unitId)
      remainingSteps.set(unitId, 0)
      return
    }
    const allowed = getAllowedMoveDistance(unit, distance)
    remainingSteps.set(unitId, Math.max(0, allowed))
  })

  for (let step = 0; step < distance; step += 1) {
    const stepCandidates = new Map<UnitId, Hex>()
    participants.forEach((unitId) => {
      if (stoppedByTrap.has(unitId)) return
      const unit = state.units[unitId]
      if (!unit || !canActAsUnit(unit)) return
      const remaining = remainingSteps.get(unitId) ?? 0
      if (remaining <= 0) return
      const next = neighbor(unit.pos, direction)
      if (!inBounds(state.boardRows, state.boardCols, next)) {
        remainingSteps.set(unitId, 0)
        return
      }
      stepCandidates.set(unitId, next)
    })
    if (stepCandidates.size === 0) break

    const occupiedByTile = new Map<string, UnitId>()
    Object.values(state.units).forEach((unit) => {
      occupiedByTile.set(`${unit.pos.q},${unit.pos.r}`, unit.id)
    })

    const movable = new Set<UnitId>(stepCandidates.keys())
    let changed = true
    while (changed) {
      changed = false
      for (const unitId of [...movable]) {
        const target = stepCandidates.get(unitId)
        if (!target) {
          movable.delete(unitId)
          changed = true
          continue
        }
        const occupant = occupiedByTile.get(`${target.q},${target.r}`)
        if (!occupant) continue
        if (!participantSet.has(occupant) || !movable.has(occupant)) {
          movable.delete(unitId)
          changed = true
        }
      }
    }

    if (movable.size === 0) break

    const movedThisStep = new Set<UnitId>(movable)
    movedThisStep.forEach((unitId) => {
      const unit = state.units[unitId]
      const target = stepCandidates.get(unitId)
      if (!unit || !target) return
      setUnitPosition(unit, { ...target })
      lastKnownPositions.set(unitId, { ...target })
    })

    movedThisStep.forEach((unitId) => {
      const unit = state.units[unitId]
      if (!unit) return
      const trapResolution = triggerTrapAtCurrentTile(state, unit)
      movedSteps.set(unitId, (movedSteps.get(unitId) ?? 0) + 1)
      remainingSteps.set(unitId, Math.max(0, (remainingSteps.get(unitId) ?? 0) - 1))
      const surviving = state.units[unitId]
      if (!surviving) {
        remainingSteps.set(unitId, 0)
        if (trapResolution.stopMovement) {
          stoppedByTrap.add(unitId)
        }
        return
      }
      if (trapResolution.stopMovement) {
        stoppedByTrap.add(unitId)
        remainingSteps.set(unitId, 0)
      }
    })

    participants.forEach((unitId) => {
      if (movedThisStep.has(unitId)) return
      if ((remainingSteps.get(unitId) ?? 0) <= 0) return
      remainingSteps.set(unitId, 0)
    })
  }

  participants.forEach((unitId) => {
    const moved = movedSteps.get(unitId) ?? 0
    if (moved <= 0) {
      if (!cannotMoveLogged.has(unitId)) {
        state.log.push(`Unit ${unitId} cannot move.`)
      }
      return
    }
    const finalPos = state.units[unitId]?.pos ?? lastKnownPositions.get(unitId)
    if (!finalPos) return
    state.log.push(`Unit ${unitId} moves to ${finalPos.q},${finalPos.r}.`)
    if (stoppedByTrap.has(unitId)) {
      state.log.push(`Unit ${unitId} is stopped by a trap.`)
    }
    const surviving = state.units[unitId]
    if (surviving) {
      recordSlowMovement(surviving, moved)
    }
  })
}

type SimultaneousMovePlan = {
  unitId: UnitId
  target: Hex
  faceMovedDirection?: boolean
}

type SimultaneousMoveResolution = {
  plans: Map<UnitId, { unit: Unit; target: Hex; direction: Direction; faceMovedDirection: boolean }>
  movable: Set<UnitId>
  cannotMove: Set<UnitId>
}

function resolveSimultaneousMovePlans(state: GameState, plans: SimultaneousMovePlan[]): SimultaneousMoveResolution {
  const resolvedPlans = new Map<UnitId, { unit: Unit; target: Hex; direction: Direction; faceMovedDirection: boolean }>()

  plans.forEach((plan) => {
    const unit = state.units[plan.unitId]
    if (!unit || !canActAsUnit(unit)) return
    if (!inBounds(state.boardRows, state.boardCols, plan.target)) return
    const direction = getDirectionToAdjacentTile(unit.pos, plan.target)
    if (direction === null) return
    resolvedPlans.set(plan.unitId, {
      unit,
      target: { ...plan.target },
      direction,
      faceMovedDirection: plan.faceMovedDirection === true,
    })
  })

  const cannotMove = new Set<UnitId>()
  resolvedPlans.forEach((plan, unitId) => {
    if (isUnitMovementBlocked(plan.unit)) {
      cannotMove.add(unitId)
    }
  })

  const movable = new Set<UnitId>([...resolvedPlans.keys()].filter((unitId) => !cannotMove.has(unitId)))

  let changed = true
  while (changed) {
    changed = false
    const targetCounts = new Map<string, number>()
    movable.forEach((unitId) => {
      const plan = resolvedPlans.get(unitId)
      if (!plan) return
      const key = `${plan.target.q},${plan.target.r}`
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1)
    })

    for (const unitId of [...movable]) {
      const plan = resolvedPlans.get(unitId)
      if (!plan) {
        movable.delete(unitId)
        changed = true
        continue
      }

      const targetKey = `${plan.target.q},${plan.target.r}`
      if ((targetCounts.get(targetKey) ?? 0) > 1) {
        movable.delete(unitId)
        changed = true
        continue
      }

      const occupant = getUnitAt(state, plan.target)
      if (!occupant || occupant.id === unitId) continue
      if (!resolvedPlans.has(occupant.id) || !movable.has(occupant.id)) {
        movable.delete(unitId)
        changed = true
      }
    }
  }

  return { plans: resolvedPlans, movable, cannotMove }
}

function canResolveSimultaneousMoves(state: GameState, plans: SimultaneousMovePlan[]): boolean {
  const resolution = resolveSimultaneousMovePlans(state, plans)
  return resolution.plans.size > 0 && resolution.movable.size === resolution.plans.size
}

function executeSimultaneousMoves(state: GameState, plans: SimultaneousMovePlan[]): void {
  const resolution = resolveSimultaneousMovePlans(state, plans)
  const stoppedByTrap = new Set<UnitId>()

  resolution.cannotMove.forEach((unitId) => {
    state.log.push(`Unit ${unitId} cannot move this turn.`)
  })

  resolution.movable.forEach((unitId) => {
    const plan = resolution.plans.get(unitId)
    if (!plan) return
    setUnitPosition(plan.unit, { ...plan.target })
  })

  resolution.movable.forEach((unitId) => {
    const liveUnit = state.units[unitId]
    if (!liveUnit) return
    const trapResolution = triggerTrapAtCurrentTile(state, liveUnit)
    if (trapResolution.stopMovement) {
      stoppedByTrap.add(unitId)
    }
    const surviving = state.units[unitId]
    if (!surviving) return
    const plan = resolution.plans.get(unitId)
    if (plan?.faceMovedDirection) {
      surviving.facing = plan.direction
      state.log.push(`Unit ${surviving.id} faces ${plan.direction}.`)
    }
    recordSlowMovement(surviving, 1)
  })

  resolution.plans.forEach((plan, unitId) => {
    if (!resolution.movable.has(unitId)) {
      if (!resolution.cannotMove.has(unitId)) {
        state.log.push(`Unit ${unitId} cannot move.`)
      }
      return
    }
    const liveUnit = state.units[unitId]
    const finalPos = liveUnit?.pos ?? plan.target
    state.log.push(`Unit ${unitId} moves to ${finalPos.q},${finalPos.r}.`)
    if (stoppedByTrap.has(unitId)) {
      state.log.push(`Unit ${unitId} is stopped by a trap.`)
    }
  })
}

function hasResolvableDoubleStepsFollowUp(
  state: GameState,
  player: PlayerId,
  firstUnitId: string | undefined,
  firstTile: Hex | undefined
): boolean {
  if (!firstUnitId || !firstTile) return false
  const resolvedFirstUnitId = resolveUnitId(state, player, firstUnitId)
  if (!resolvedFirstUnitId) return false
  const firstUnit = state.units[resolvedFirstUnitId]
  if (!firstUnit || !canActAsUnit(firstUnit)) return false

  return Object.values(state.units).some((unit) => {
    if (unit.owner !== player || unit.id === resolvedFirstUnitId || !canActAsUnit(unit)) {
      return false
    }
    for (let direction = 0 as Direction; direction < 6; direction += 1) {
      const candidate = neighbor(unit.pos, direction)
      if (!inBounds(state.boardRows, state.boardCols, candidate)) continue
      if (
        canResolveSimultaneousMoves(state, [
          { unitId: resolvedFirstUnitId, target: firstTile },
          { unitId: unit.id, target: candidate },
        ])
      ) {
        return true
      }
    }
    return false
  })
}

function teleportUnit(state: GameState, unit: Unit, target: Hex, maxDistance: number): boolean {
  if (!canActAsUnit(unit)) return false
  if (isUnitMovementBlocked(unit)) {
    state.log.push(`Unit ${unit.id} cannot move this turn.`)
    return false
  }
  if (!inBounds(state.boardRows, state.boardCols, target)) return false

  const distance = hexDistance(unit.pos, target)
  if (distance <= 0) {
    state.log.push(`Unit ${unit.id} cannot teleport.`)
    return false
  }
  const allowed = getAllowedMoveDistance(unit, maxDistance)
  if (distance > allowed) {
    state.log.push(`Unit ${unit.id} cannot teleport that far.`)
    return false
  }
  const occupied = getUnitAt(state, target)
  if (occupied && occupied.id !== unit.id) {
    state.log.push(`Unit ${unit.id} cannot teleport to an occupied tile.`)
    return false
  }

  setUnitPosition(unit, { ...target })
  recordSlowMovement(unit, distance)
  state.log.push(`Unit ${unit.id} teleports to ${target.q},${target.r}.`)
  triggerTrapAtCurrentTile(state, unit)
  return true
}

function getAdjacentChainLightningTargets(
  state: GameState,
  origin: Hex,
  visitedIds: Set<string>,
  sourceCardId: CardDefId
): Unit[] {
  const targets: Unit[] = []
  for (let dir = 0 as Direction; dir < 6; dir += 1) {
    const candidateHex = neighbor(origin, dir)
    if (!inBounds(state.boardRows, state.boardCols, candidateHex)) continue
    const candidate = getUnitAt(state, candidateHex)
    if (!candidate) continue
    if (visitedIds.has(candidate.id)) continue
    if (!canCardTargetUnit(sourceCardId, candidate)) continue
    targets.push(candidate)
  }
  return targets
}

function isFriendlyChainLightningImmune(unit: Unit, player: PlayerId): boolean {
  return unit.owner === player && unit.kind === 'unit' && unit.roguelikeRole === 'lightning_spirit'
}

function resolveChainLightningFromOrigin(
  state: GameState,
  originUnit: Unit,
  damage: number,
  sourceCardId: CardDefId,
  eligibleTargetIds: Set<string>
): string[] {
  const visited = new Set<string>([originUnit.id])
  const path: string[] = []
  let currentOrigin = { ...originUnit.pos }
  while (state.winner === null) {
    const candidates = getAdjacentChainLightningTargets(state, currentOrigin, visited, sourceCardId).filter((target) =>
      eligibleTargetIds.has(target.id)
    )
    if (candidates.length === 0) break
    const choiceIndex = Math.floor(Math.random() * candidates.length)
    const target = candidates[Math.max(0, Math.min(choiceIndex, candidates.length - 1))]
    visited.add(target.id)
    path.push(target.id)
    const nextOrigin = { ...target.pos }
    if (!isFriendlyChainLightningImmune(target, originUnit.owner)) {
      applyDamage(state, target, damage, originUnit, sourceCardId)
    }
    currentOrigin = nextOrigin
  }
  return path
}

function logChainLightningResult(state: GameState, originUnitId: UnitId, path: string[]): void {
  if (path.length === 0) {
    state.log.push(`Chain lightning from unit ${originUnitId} finds no adjacent targets.`)
    return
  }
  state.log.push(`Chain lightning from unit ${originUnitId} path: ${path.join(' -> ')}.`)
}

function getAttackTargets(
  state: GameState,
  origin: Unit,
  mode: 'nearest' | 'line' | 'ray',
  direction: Direction,
  maxRange?: number
): Unit[] {
  if (mode === 'nearest') {
    const targetTile = neighbor(origin.pos, direction)
    if (typeof maxRange === 'number' && maxRange < 1) return []
    if (!inBounds(state.boardRows, state.boardCols, targetTile)) return []
    const target = getUnitAt(state, targetTile)
    return target ? [target] : []
  }

  if (mode === 'line') {
    let cursor = { ...origin.pos }
    let steps = 0
    for (;;) {
      cursor = neighbor(cursor, direction)
      steps += 1
      if (typeof maxRange === 'number' && steps > maxRange) return []
      if (!inBounds(state.boardRows, state.boardCols, cursor)) return []
      const target = getUnitAt(state, cursor)
      if (target) return [target]
    }
  }

  const targets: Unit[] = []
  let cursor = { ...origin.pos }
  let steps = 0
  for (;;) {
    cursor = neighbor(cursor, direction)
    steps += 1
    if (typeof maxRange === 'number' && steps > maxRange) break
    if (!inBounds(state.boardRows, state.boardCols, cursor)) break
    const target = getUnitAt(state, cursor)
    if (target) {
      targets.push(target)
    }
  }
  return targets
}

function pushUnit(state: GameState, unit: Unit, direction: Direction, distance: number): boolean {
  if (distance <= 0) return false
  let moved = false
  let current = { ...unit.pos }
  let pushedUnit: Unit = unit
  for (let step = 0; step < distance; step += 1) {
    const next = neighbor(current, direction)
    if (!inBounds(state.boardRows, state.boardCols, next)) return false
    if (getUnitAt(state, next)) return false
    current = next
    setUnitPosition(pushedUnit, current)
    moved = true
    const trapResolution = triggerTrapAtCurrentTile(state, pushedUnit)
    const surviving = state.units[pushedUnit.id]
    if (!surviving) return moved
    pushedUnit = surviving
    if (trapResolution.stopMovement) break
  }
  if (!moved) return false
  state.log.push(`Unit ${unit.id} is pushed to ${current.q},${current.r}.`)
  return moved
}

type OrderResolutionContext = {
  movedUnitOrigins: Record<string, Hex>
  lastMoveSucceededByUnit: Record<string, boolean>
  resolvedCompositeEffects: Set<string>
}

function getPrimaryActingUnit(state: GameState, order: Order): Unit | null {
  if (!isActingUnitRequirement(order.defId)) return null
  const rawUnitId = order.params.unitId
  if (!rawUnitId) return null
  const resolved = resolveUnitId(state, order.player, rawUnitId)
  if (!resolved) return null
  const unit = state.units[resolved]
  if (!unit || !canUnitActWithCard(order.defId, unit)) return null
  return unit
}

function applyOrder(state: GameState, order: Order): void {
  const def = CARD_DEFS[order.defId]
  if (state.winner !== null) return
  const actingUnit = getPrimaryActingUnit(state, order)
  if (isActingUnitRequirement(order.defId)) {
    if (!actingUnit) return
    if (isUnitActionBlocked(actingUnit)) {
      state.log.push(`Unit ${actingUnit.id} is stunned and cannot act this turn.`)
      return
    }
  }
  const context: OrderResolutionContext = {
    movedUnitOrigins: {},
    lastMoveSucceededByUnit: {},
    resolvedCompositeEffects: new Set(),
  }
  syncUnitState(state)
  for (const effect of def.effects) {
    applyEffect(state, order, effect, context)
    syncUnitState(state)
    checkVictoryConditions(state)
    if (state.winner !== null) return
  }
}

function applyOrderForPlanning(state: GameState, order: Order): void {
  const def = CARD_DEFS[order.defId]
  const actingUnit = getPrimaryActingUnit(state, order)
  if (isActingUnitRequirement(order.defId)) {
    if (!actingUnit) return
    if (isUnitActionBlocked(actingUnit)) return
  }
  const context: OrderResolutionContext = {
    movedUnitOrigins: {},
    lastMoveSucceededByUnit: {},
    resolvedCompositeEffects: new Set(),
  }
  syncUnitState(state)
  for (const effect of def.effects) {
    if (effect.type === 'budget' || effect.type === 'chainLightning' || effect.type === 'chainLightningAllFriendly') continue
    applyEffect(state, order, effect, context)
    syncUnitState(state)
    checkVictoryConditions(state)
    if (state.winner !== null) return
  }
}

function canApplyOrder(state: GameState, order: Order, fallbackState?: GameState): boolean {
  const def = CARD_DEFS[order.defId]
  const params = order.params
  if (isActingUnitRequirement(order.defId)) {
    if (!params.unitId) return false
    const resolved = resolveUnitId(state, order.player, params.unitId)
    if (!resolved) return false
    const unit = state.units[resolved]
    if (!unit || !canUnitActWithCard(order.defId, unit)) return false
  }
  if (def.requires.unit2 && params.unitId && params.unitId2) {
    if (normalizeLegacyLeaderUnitId(params.unitId) === normalizeLegacyLeaderUnitId(params.unitId2)) return false
  }

  for (const effect of def.effects) {
    if (effect.type === 'spawn') {
      const tile = getOrderTileParam(params, effect.tileParam)
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
      if (!canActAsUnit(unit)) return false
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

    if (effect.type === 'moveToTile') {
      const rawUnitId = getOrderUnitParam(params, effect.unitParam)
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!rawUnitId || !tile) {
        if (order.defId === 'move_double_steps' && effect.unitParam === 'unitId2' && !rawUnitId && !tile) {
          continue
        }
        return false
      }
      const resolved = resolveUnitId(state, order.player, rawUnitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      if (!inBounds(state.boardRows, state.boardCols, tile)) return false
      if (getDirectionToAdjacentTile(unit.pos, tile) === null) return false
      if (order.defId === 'move_double_steps') {
        const firstUnitId =
          effect.unitParam === 'unitId'
            ? resolved
            : params.unitId
              ? resolveUnitId(state, order.player, params.unitId)
              : null
        const firstTile = effect.unitParam === 'unitId' ? tile : params.tile
        const plans: SimultaneousMovePlan[] = []
        if (firstUnitId && firstTile) {
          plans.push({ unitId: firstUnitId, target: firstTile })
        }
        if (effect.unitParam === 'unitId2') {
          plans.push({ unitId: resolved, target: tile })
        }
        if (!canResolveSimultaneousMoves(state, plans)) return false
        continue
      }
      const occupyingUnit = getUnitAt(state, tile)
      if (occupyingUnit && occupyingUnit.id !== unit.id) return false
      continue
    }

    if (effect.type === 'teleport') {
      if (!params.unitId || !params.tile) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      if (!inBounds(state.boardRows, state.boardCols, params.tile)) return false
      const destination = getUnitAt(state, params.tile)
      if (destination && destination.id !== unit.id) return false
      const allowedRange = getAllowedMoveDistance(unit, effect.maxDistance)
      const distance = hexDistance(unit.pos, params.tile)
      if (distance <= 0 || distance > allowedRange) return false
      continue
    }

    if (effect.type === 'face') {
      const nextDirection = effect.directionParam === 'faceDirection' ? params.faceDirection : params.direction
      if (!params.unitId || nextDirection === undefined) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
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

    if (effect.type === 'applyUnitModifier' || effect.type === 'clearUnitModifiers' || effect.type === 'clearUnitDebuffs') {
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
      continue
    }

    if (effect.type === 'damageTileArea') {
      if (!params.tile) return false
      if (!inBounds(state.boardRows, state.boardCols, params.tile)) return false
      continue
    }

    if (effect.type === 'damageRadius') {
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!tile) return false
      if (!inBounds(state.boardRows, state.boardCols, tile)) return false
      continue
    }

    if (effect.type === 'placeTrap') {
      const tile = params.tile
      if (!tile) return false
      if (!inBounds(state.boardRows, state.boardCols, tile)) return false
      if (!isValidBarricadeSpawnTile(state, order.player, tile)) return false
      if (getTrapAt(state, tile)) return false
      if (getUnitAt(state, tile)) return false
      continue
    }

    if (effect.type === 'spawnAdjacentFriendly') {
      const tile = params.tile
      if (!tile) return false
      if (!inBounds(state.boardRows, state.boardCols, tile)) return false
      if (!isValidBarricadeSpawnTile(state, order.player, tile)) return false
      if (effect.facingParam && params.direction === undefined) return false
      if (getUnitAt(state, tile)) return false
      continue
    }

    if (effect.type === 'splitUnit') {
      const rawUnitId = getOrderUnitParam(params, effect.unitParam)
      if (!rawUnitId) return false
      const resolved = resolveUnitId(state, order.player, rawUnitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || unit.kind !== 'unit') return false
      if (!canCardTargetUnit(order.defId, unit)) return false
      if (!findNearestOpenTileForSplit(state, unit.pos)) return false
      continue
    }

    if (effect.type === 'spawnSkeletonAdjacent') {
      const rawUnitId = getOrderUnitParam(params, effect.unitParam)
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!rawUnitId || !tile) return false
      const resolved = resolveUnitId(state, order.player, rawUnitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || unit.kind !== 'unit') return false
      if (!canUnitActWithCard(order.defId, unit)) return false
      if (!inBounds(state.boardRows, state.boardCols, tile)) return false
      if (!isAdjacentHex(unit.pos, tile)) return false
      if (getUnitAt(state, tile)) return false
      continue
    }

    if (effect.type === 'budget') {
      continue
    }

    if (effect.type === 'applyPlayerModifier') {
      continue
    }

    if (
      effect.type === 'boostAllFriendly' ||
      effect.type === 'teamAttackForward' ||
      effect.type === 'chainLightningAllFriendly'
    ) {
      continue
    }

    if (effect.type === 'jointAttack') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!tile || !inBounds(state.boardRows, state.boardCols, tile)) return false
      if (getDirectionToAdjacentTile(unit.pos, tile) === null) return false
      continue
    }

    if (effect.type === 'pincerAttack') {
      continue
    }

    if (effect.type === 'volley') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!tile || !inBounds(state.boardRows, state.boardCols, tile)) return false
      if (hexDistance(unit.pos, tile) > effect.radius) return false
      continue
    }

    if (effect.type === 'convergeTowardTile') {
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!tile) return false
      if (!inBounds(state.boardRows, state.boardCols, tile)) return false
      continue
    }

    if (effect.type === 'attack') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      const directions = resolveDirections(unit.facing, params, effect.directions)
      if (directions.length === 0) return false
      continue
    }

    if (effect.type === 'attackModifier') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      const directions = resolveDirections(unit.facing, params, effect.directions)
      if (directions.length === 0) return false
      continue
    }

    if (effect.type === 'lineSplash') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      const directions = resolveDirections(unit.facing, params, effect.directions)
      if (directions.length === 0) return false
      continue
    }

    if (
      effect.type === 'harpoon' ||
      effect.type === 'executeForward' ||
      effect.type === 'damageAdjacent' ||
      effect.type === 'stunAdjacent' ||
      effect.type === 'chainLightning'
    ) {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      if (effect.type === 'chainLightning') {
        const visited = new Set<string>([unit.id])
        const candidates = getAdjacentChainLightningTargets(state, unit.pos, visited, order.defId)
        if (candidates.length === 0) return false
      }
      continue
    }

    if (effect.type === 'packHunt') {
      if (!params.unitId) return false
      if (params.direction === undefined) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      continue
    }

    if (effect.type === 'markAdvanceToward') {
      if (!params.unitId) return false
      const normalizedUnitId = normalizeLegacyLeaderUnitId(params.unitId)
      const resolvedUnitId = resolveUnitId(state, order.player, normalizedUnitId)
      const target =
        state.units[normalizedUnitId] ??
        (resolvedUnitId ? state.units[resolvedUnitId] : undefined) ??
        fallbackState?.units[normalizedUnitId] ??
        (resolvedUnitId ? fallbackState?.units[resolvedUnitId] : undefined)
      if (!target) return false
      if (!isCardTargetUnitAllowedForPlayer(order.defId, order.player, target)) return false
      continue
    }

    if (effect.type === 'shove') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      const direction = resolveDirection(unit.facing, params, effect.direction)
      if (direction === null) return false
      continue
    }

    if (effect.type === 'whirlwind') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
      continue
    }

    if (effect.type === 'moveAdjacentFriendlyGroup') {
      if (!params.unitId) return false
      const resolved = resolveUnitId(state, order.player, params.unitId)
      if (!resolved) return false
      const unit = state.units[resolved]
      if (!unit || !canActAsUnit(unit)) return false
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
  }
  return true
}

function resolveUnitId(state: GameState, player: PlayerId, unitId: string): UnitId | null {
  const normalizedUnitId = normalizeLegacyLeaderUnitId(unitId)
  const plannedRef = parsePlannedUnitReference(normalizedUnitId)
  if (!plannedRef) return normalizedUnitId.startsWith('planned:') ? null : normalizedUnitId
  const scopedKey = plannedRef.spawnKey ? getSpawnMapKey(plannedRef.orderId, plannedRef.spawnKey) : plannedRef.orderId
  const mapped = state.spawnedByOrder[scopedKey]
  if (mapped) return mapped
  if (plannedRef.spawnKey) {
    const fallbackMapped = state.spawnedByOrder[plannedRef.orderId]
    if (fallbackMapped) return fallbackMapped
  }
  const planned = state.players[player].orders.find((order) => order.id === plannedRef.orderId)
  if (!planned) return null
  const allowedParams: Array<'tile' | 'tile2'> = plannedRef.spawnKey ? [plannedRef.spawnKey] : ['tile', 'tile2']
  for (const effect of CARD_DEFS[planned.defId].effects) {
    if (!isMappedPlannedSpawnEffect(effect)) continue
    if (!allowedParams.includes(effect.tileParam)) continue
    const tile = getOrderTileParam(planned.params, effect.tileParam)
    if (!tile) continue
    const candidate = getUnitAt(state, tile)
    if (candidate && candidate.owner === player) return candidate.id
  }
  return null
}

function applyEffect(state: GameState, order: Order, effect: CardEffect, context: OrderResolutionContext): void {
  const params = order.params
  switch (effect.type) {
    case 'spawn': {
      const tile = getOrderTileParam(params, effect.tileParam)
      const facing = effect.facingParam ? params.direction : effect.facing
      if (!tile || facing === undefined) return
      const kind = effect.kind ?? 'unit'
      if (kind === 'barricade' && !isValidBarricadeSpawnTile(state, order.player, tile)) {
        state.log.push(`${CARD_DEFS[order.defId].name} fails (invalid barricade tile).`)
        return
      }
      const spawnedId = spawnUnit(state, order.player, tile, facing, kind, effect.strength)
      if (spawnedId && effect.mapToOrder) {
        registerSpawnedByOrder(state, order.id, effect.tileParam, spawnedId)
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
      const startPos = { ...unit.pos }
      if (!context.movedUnitOrigins[resolvedUnitId]) {
        context.movedUnitOrigins[resolvedUnitId] = { ...unit.pos }
      }
      if (order.defId === 'move_tandem') {
        return
      }
      const direction = resolveDirection(unit.facing, params, effect.direction)
      if (direction === null) {
        context.lastMoveSucceededByUnit[resolvedUnitId] = false
        return
      }
      const distance =
        typeof effect.distance === 'number'
          ? effect.distance
          : params.distance !== undefined
            ? params.distance
            : null
      if (!distance) {
        context.lastMoveSucceededByUnit[resolvedUnitId] = false
        return
      }
      moveUnit(state, unit, direction, distance)
      const movedUnit = state.units[resolvedUnitId]
      context.lastMoveSucceededByUnit[resolvedUnitId] = Boolean(
        movedUnit && !sameHex(startPos, movedUnit.pos)
      )
      return
    }
    case 'moveToTile': {
      if (order.defId === 'move_double_steps') {
        if (context.resolvedCompositeEffects.has('move_double_steps')) return
        context.resolvedCompositeEffects.add('move_double_steps')
        const firstUnitId = getOrderUnitParam(params, 'unitId')
        const firstTile = getOrderTileParam(params, 'tile')
        const secondUnitId = getOrderUnitParam(params, 'unitId2')
        const secondTile = getOrderTileParam(params, 'tile2')
        const firstResolved = firstUnitId ? resolveUnitId(state, order.player, firstUnitId) : null
        const secondResolved = secondUnitId ? resolveUnitId(state, order.player, secondUnitId) : null
        const plans: SimultaneousMovePlan[] = []
        if (firstResolved && firstTile) {
          if (!context.movedUnitOrigins[firstResolved]) {
            context.movedUnitOrigins[firstResolved] = { ...state.units[firstResolved].pos }
          }
          plans.push({ unitId: firstResolved, target: firstTile })
        }
        if (secondResolved && secondTile) {
          if (!context.movedUnitOrigins[secondResolved]) {
            context.movedUnitOrigins[secondResolved] = { ...state.units[secondResolved].pos }
          }
          plans.push({ unitId: secondResolved, target: secondTile })
        }
        executeSimultaneousMoves(state, plans)
        ;([firstResolved, secondResolved] as Array<UnitId | null>).forEach((unitId) => {
          if (!unitId) return
          const origin = context.movedUnitOrigins[unitId]
          const movedUnit = state.units[unitId]
          context.lastMoveSucceededByUnit[unitId] = Boolean(origin && movedUnit && !sameHex(origin, movedUnit.pos))
        })
        return
      }
      const rawUnitId = getOrderUnitParam(params, effect.unitParam)
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!rawUnitId || !tile) return
      const resolvedUnitId = resolveUnitId(state, order.player, rawUnitId)
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canActAsUnit(unit)) return
      const startPos = { ...unit.pos }
      if (!context.movedUnitOrigins[resolvedUnitId]) {
        context.movedUnitOrigins[resolvedUnitId] = { ...unit.pos }
      }
      const moved = moveUnitToTile(state, unit, tile, effect.faceMovedDirection === true)
      const movedUnit = state.units[resolvedUnitId]
      context.lastMoveSucceededByUnit[resolvedUnitId] = Boolean(
        moved && movedUnit && !sameHex(startPos, movedUnit.pos)
      )
      return
    }
    case 'teleport': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      const destination = getOrderTileParam(params, effect.tileParam)
      if (!resolvedUnitId || !destination) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canActAsUnit(unit)) return
      if (!context.movedUnitOrigins[resolvedUnitId]) {
        context.movedUnitOrigins[resolvedUnitId] = { ...unit.pos }
      }
      teleportUnit(state, unit, destination, effect.maxDistance)
      return
    }
    case 'damage': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canCardTargetUnit(order.defId, unit)) return
      applyDamage(state, unit, scaleRoguelikeMonsterCardDamage(state, order.player, effect.amount), null, order.defId)
      return
    }
    case 'damageTile': {
      const tile = params.tile
      if (!tile) return
      const unit = getUnitAt(state, tile)
      if (!unit || !isDamageableUnit(unit)) return
      applyDamage(state, unit, scaleRoguelikeMonsterCardDamage(state, order.player, effect.amount), null, order.defId)
      return
    }
    case 'damageTileArea': {
      const tile = params.tile
      if (!tile) return
      const centerUnitId = getUnitAt(state, tile)?.id
      const splashTargetIds: UnitId[] = []
      for (let dir = 0 as Direction; dir < 6; dir += 1) {
        const neighborTile = neighbor(tile, dir)
        if (!inBounds(state.boardRows, state.boardCols, neighborTile)) continue
        const target = getUnitAt(state, neighborTile)
        if (!target || !isDamageableUnit(target)) continue
        splashTargetIds.push(target.id)
      }
      if (centerUnitId) {
        const centerUnit = state.units[centerUnitId]
        if (centerUnit && isDamageableUnit(centerUnit)) {
          applyDamage(
            state,
            centerUnit,
            scaleRoguelikeMonsterCardDamage(state, order.player, effect.centerAmount),
            null,
            order.defId
          )
        }
      }
      splashTargetIds.forEach((targetId) => {
        const target = state.units[targetId]
        if (!target || !isDamageableUnit(target)) return
        applyDamage(
          state,
          target,
          scaleRoguelikeMonsterCardDamage(state, order.player, effect.splashAmount),
          null,
          order.defId
        )
      })
      return
    }
    case 'damageRadius': {
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!tile) return
      Object.values(state.units)
        .filter((unit) => hexDistance(unit.pos, tile) <= effect.radius)
        .sort((a, b) => a.pos.r - b.pos.r || a.pos.q - b.pos.q || a.id.localeCompare(b.id))
        .forEach((unit) => {
          const liveTarget = state.units[unit.id]
          if (!liveTarget || !isDamageableUnit(liveTarget)) return
          applyDamage(
            state,
            liveTarget,
            scaleRoguelikeMonsterCardDamage(state, order.player, effect.amount),
            null,
            order.defId
          )
          const afterDamage = state.units[unit.id]
          if (!afterDamage || !effect.modifier || !effect.turns || !canActAsUnit(afterDamage)) return
          addUnitModifier(state, afterDamage, effect.modifier, effect.turns)
        })
      return
    }
    case 'placeTrap': {
      const tile = params.tile
      if (!tile) return
      if (!isValidBarricadeSpawnTile(state, order.player, tile)) return
      const placed = placeTrap(state, order.player, tile, effect.trapKind, CARD_DEFS[order.defId].name)
      if (!placed) {
        state.log.push(`${CARD_DEFS[order.defId].name} fails (invalid trap tile).`)
      }
      return
    }
    case 'spawnAdjacentFriendly': {
      const tile = params.tile
      if (!tile) return
      if (!isValidBarricadeSpawnTile(state, order.player, tile)) {
        state.log.push(`${CARD_DEFS[order.defId].name} fails (invalid recruitment tile).`)
        return
      }
      const facing = effect.facingParam ? params.direction : getDefaultSpawnFacing(state, order.player)
      if (facing === undefined) return
      const spawnedId = spawnUnit(state, order.player, tile, facing, 'unit', effect.strength)
      if (spawnedId && effect.mapToOrder) {
        registerSpawnedByOrder(state, order.id, effect.tileParam, spawnedId)
      }
      if (!spawnedId) {
        state.log.push(`${CARD_DEFS[order.defId].name} fails (tile occupied or blocked).`)
      }
      return
    }
    case 'splitUnit': {
      const resolvedUnitId = getOrderUnitParam(params, effect.unitParam)
        ? resolveUnitId(state, order.player, getOrderUnitParam(params, effect.unitParam)!)
        : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || unit.kind !== 'unit' || !canCardTargetUnit(order.defId, unit)) return
      if (!splitUnit(state, unit)) {
        state.log.push(`${CARD_DEFS[order.defId].name} fails (no room to split).`)
      }
      return
    }
    case 'spawnSkeletonAdjacent': {
      const rawUnitId = getOrderUnitParam(params, effect.unitParam)
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!rawUnitId || !tile) return
      const resolvedUnitId = resolveUnitId(state, order.player, rawUnitId)
      if (!resolvedUnitId) return
      const necromancer = state.units[resolvedUnitId]
      if (!necromancer || necromancer.kind !== 'unit' || !canUnitActWithCard(order.defId, necromancer)) return
      if (!isAdjacentHex(necromancer.pos, tile)) return
      const role = pickRandomSkeletonRole()
      const spawnedId = spawnSkeletonAtTile(state, tile, necromancer.facing, role)
      if (!spawnedId) {
        state.log.push(`${CARD_DEFS[order.defId].name} fails (tile occupied or blocked).`)
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
    case 'clearUnitDebuffs': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canCardTargetUnit(order.defId, unit)) return
      clearUnitDebuffs(state, unit)
      return
    }
    case 'budget': {
      const current = state.actionBudgets[order.player] ?? 0
      state.actionBudgets[order.player] = Math.max(0, current + effect.amount)
      state.log.push(`Player ${order.player + 1} increases their action budget by ${effect.amount}.`)
      return
    }
    case 'applyPlayerModifier': {
      const targetPlayer = effect.target === 'opponent' ? (order.player === 0 ? 1 : 0) : order.player
      addPlayerModifier(state, targetPlayer, effect.modifier, effect.amount, effect.turns)
      return
    }
    case 'boostAllFriendly': {
      const friendlyUnits = Object.values(state.units).filter((unit) => unit.owner === order.player && canActAsUnit(unit))
      friendlyUnits.forEach((unit) => boostUnit(state, unit, effect.amount))
      return
    }
    case 'jointAttack': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!resolvedUnitId || !tile) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return
      if (getDirectionToAdjacentTile(actingUnit.pos, tile) === null) return
      const participants = [actingUnit, ...getCommanderSupportParticipants(state, order.player, tile, actingUnit.id)]
      applyRepeatedUnitSourcedDamage(
        state,
        participants,
        scaleRoguelikeMonsterCardDamage(state, order.player, effect.damagePerAdjacentAlly),
        order.defId,
        () => {
          const target = getUnitAt(state, tile)
          if (!target || !canCardTargetUnit(order.defId, target)) return null
          return target
        }
      )
      return
    }
    case 'pincerAttack': {
      const targets = Object.values(state.units)
        .filter((unit) => unit.owner !== order.player && canActAsUnit(unit))
        .sort((a, b) => a.pos.r - b.pos.r || a.pos.q - b.pos.q || a.id.localeCompare(b.id))
      targets.forEach((target) => {
        if (getPincerAttackParticipants(state, order.player, target.pos).length !== 6) return
        const liveTarget = state.units[target.id]
        if (!liveTarget || !canActAsUnit(liveTarget)) return
        applyDamage(
          state,
          liveTarget,
          scaleRoguelikeMonsterCardDamage(state, order.player, effect.damage),
          null,
          order.defId
        )
      })
      return
    }
    case 'volley': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!resolvedUnitId || !tile) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return
      if (hexDistance(actingUnit.pos, tile) > effect.radius) return
      const participants = new Map<UnitId, Unit>()
      participants.set(actingUnit.id, actingUnit)
      getCommanderSupportParticipants(state, order.player, actingUnit.pos).forEach((participant) => {
        participants.set(participant.id, participant)
      })
      const damageSources = [...participants.values()].sort((a, b) => a.id.localeCompare(b.id))
      applyRepeatedUnitSourcedDamage(
        state,
        damageSources,
        scaleRoguelikeMonsterCardDamage(state, order.player, effect.damage),
        order.defId,
        () => {
          const target = getUnitAt(state, tile)
          if (!target || !canCardTargetUnit(order.defId, target)) return null
          return target
        }
      )
      return
    }
    case 'teamAttackForward': {
      const attackers = Object.values(state.units)
        .filter((unit) => unit.owner === order.player && canActAsUnit(unit) && !isUnitActionBlocked(unit))
        .sort((a, b) => a.id.localeCompare(b.id))
      applyRepeatedUnitSourcedDamage(
        state,
        attackers,
        scaleRoguelikeMonsterCardDamage(state, order.player, effect.damage),
        order.defId,
        (liveSourceUnit) => {
          const targetHex = neighbor(liveSourceUnit.pos, liveSourceUnit.facing)
          if (!inBounds(state.boardRows, state.boardCols, targetHex)) return null
          const target = getUnitAt(state, targetHex)
          if (!target || !canCardTargetUnit(order.defId, target)) return null
          return target
        }
      )
      return
    }
    case 'face': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      const nextDirection = effect.directionParam === 'faceDirection' ? params.faceDirection : params.direction
      if (!resolvedUnitId || nextDirection === undefined) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canActAsUnit(unit)) return
      unit.facing = nextDirection
      state.log.push(`Unit ${unit.id} faces ${nextDirection}.`)
      return
    }
    case 'attack': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canActAsUnit(unit)) return
      const baseDamage = typeof effect.damage === 'number' ? effect.damage : unit.strength
      const damage = scaleRoguelikeMonsterCardDamage(state, order.player, baseDamage)
      const directions = resolveDirections(unit.facing, params, effect.directions)
      const targetIds = directions.flatMap((dir) =>
        getAttackTargets(state, unit, effect.mode, dir, effect.maxRange).map((target) => target.id)
      )
      targetIds.forEach((targetId) => {
        const target = state.units[targetId]
        if (!target) return
        applyDamage(state, target, damage, unit, order.defId)
      })
      return
    }
    case 'attackModifier': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canActAsUnit(unit)) return
      const directions = resolveDirections(unit.facing, params, effect.directions)
      const targetIds = directions.flatMap((dir) =>
        getAttackTargets(state, unit, effect.mode, dir, effect.maxRange).map((target) => target.id)
      )
      targetIds.forEach((targetId) => {
        const target = state.units[targetId]
        if (!target || !canCardTargetUnit(order.defId, target)) return
        addUnitModifier(state, target, effect.modifier, effect.turns)
      })
      return
    }
    case 'lineSplash': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const unit = state.units[resolvedUnitId]
      if (!unit || !canActAsUnit(unit)) return
      const directions = resolveDirections(unit.facing, params, effect.directions)
      directions.forEach((dir) => {
        const target = getAttackTargets(state, unit, 'line', dir, effect.maxRange)[0]
        if (!target || !canCardTargetUnit(order.defId, target)) return
        const targetPos = { ...target.pos }
        const splashTargetIds = Object.values(state.units)
          .filter((candidate) => candidate.id !== target.id && hexDistance(candidate.pos, targetPos) <= effect.splashRadius)
          .map((candidate) => candidate.id)
        applyDamage(state, target, scaleRoguelikeMonsterCardDamage(state, order.player, effect.damage), unit, order.defId)
        splashTargetIds.forEach((targetId) => {
          const splashTarget = state.units[targetId]
          if (!splashTarget || !canCardTargetUnit(order.defId, splashTarget)) return
          applyDamage(
            state,
            splashTarget,
            scaleRoguelikeMonsterCardDamage(state, order.player, effect.damage),
            unit,
            order.defId
          )
        })
      })
      return
    }
    case 'harpoon': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return

      const targets = getAttackTargets(state, actingUnit, 'line', actingUnit.facing)
      const target = targets[0]
      if (!target) return
      if (!canCardTargetUnit(order.defId, target)) return

      applyDamage(
        state,
        target,
        scaleRoguelikeMonsterCardDamage(state, order.player, effect.damage),
        actingUnit,
        order.defId
      )
      let pulledUnit = state.units[target.id]
      if (!pulledUnit) return

      const pullDirection = rotateDirection(actingUnit.facing, 3)
      let moved = false
      while (pulledUnit && !isAdjacentHex(pulledUnit.pos, actingUnit.pos)) {
        const next = neighbor(pulledUnit.pos, pullDirection)
        if (!inBounds(state.boardRows, state.boardCols, next)) break
        if (getUnitAt(state, next)) break
        setUnitPosition(pulledUnit, next)
        moved = true
        const trapResolution = triggerTrapAtCurrentTile(state, pulledUnit)
        const surviving = state.units[pulledUnit.id]
        if (!surviving) break
        pulledUnit = surviving
        if (trapResolution.stopMovement) break
      }
      if (moved && pulledUnit) {
        state.log.push(`Unit ${pulledUnit.id} is pulled to ${pulledUnit.pos.q},${pulledUnit.pos.r}.`)
      }
      return
    }
    case 'executeForward': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return

      const targetTile = neighbor(actingUnit.pos, actingUnit.facing)
      if (!inBounds(state.boardRows, state.boardCols, targetTile)) return
      const target = getUnitAt(state, targetTile)
      if (!target || !canCardTargetUnit(order.defId, target)) return

      if (target.kind === 'leader') {
        applyDamage(
          state,
          target,
          scaleRoguelikeMonsterCardDamage(state, order.player, effect.leaderDamage),
          actingUnit,
          order.defId
        )
        return
      }

      destroyUnit(state, target, `Unit ${target.id} is executed.`)
      return
    }
    case 'damageAdjacent': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      if (order.defId === 'attack_blade_dance' && !context.lastMoveSucceededByUnit[resolvedUnitId]) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return

      const targetIds: UnitId[] = []
      for (let dir = 0 as Direction; dir < 6; dir += 1) {
        const targetTile = neighbor(actingUnit.pos, dir)
        if (!inBounds(state.boardRows, state.boardCols, targetTile)) continue
        const target = getUnitAt(state, targetTile)
        if (!target || !canCardTargetUnit(order.defId, target)) continue
        targetIds.push(target.id)
      }
      targetIds.forEach((targetId) => {
        const target = state.units[targetId]
        if (!target) return
        applyDamage(
          state,
          target,
          scaleRoguelikeMonsterCardDamage(state, order.player, effect.amount),
          actingUnit,
          order.defId
        )
      })
      return
    }
    case 'stunAdjacent': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return
      const targetIds: UnitId[] = []
      for (let dir = 0 as Direction; dir < 6; dir += 1) {
        const targetTile = neighbor(actingUnit.pos, dir)
        if (!inBounds(state.boardRows, state.boardCols, targetTile)) continue
        const target = getUnitAt(state, targetTile)
        if (!target || !canCardTargetUnit(order.defId, target)) continue
        targetIds.push(target.id)
      }
      targetIds.forEach((targetId) => {
        const target = state.units[targetId]
        if (!target) return
        addUnitModifier(state, target, 'stunned', effect.turns)
      })
      return
    }
    case 'chainLightning': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return
      const eligibleTargetIds = new Set(Object.keys(state.units))
      const path = resolveChainLightningFromOrigin(
        state,
        actingUnit,
        scaleRoguelikeMonsterCardDamage(state, order.player, effect.damage),
        order.defId,
        eligibleTargetIds
      )
      logChainLightningResult(state, actingUnit.id, path)
      return
    }
    case 'chainLightningAllFriendly': {
      const eligibleTargetIds = new Set(Object.keys(state.units))
      const origins = Object.values(state.units)
        .filter((unit) => unit.owner === order.player && canActAsUnit(unit))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((unit) => ({
          ...unit,
          pos: { ...unit.pos },
          modifiers: unit.modifiers.map((modifier) => ({ ...modifier })),
        }))
      origins.forEach((originUnit) => {
        if (state.winner !== null) return
        const path = resolveChainLightningFromOrigin(
          state,
          originUnit,
          scaleRoguelikeMonsterCardDamage(state, order.player, effect.damage),
          'attack_chain_lightning',
          eligibleTargetIds
        )
        logChainLightningResult(state, originUnit.id, path)
      })
      return
    }
    case 'shove': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return

      const direction = resolveDirection(actingUnit.facing, params, effect.direction)
      if (direction === null) return
      const targetTile = neighbor(actingUnit.pos, direction)
      if (!inBounds(state.boardRows, state.boardCols, targetTile)) return

      const target = getUnitAt(state, targetTile)
      if (!target || !canCardTargetUnit(order.defId, target)) return

      let destination = { ...target.pos }
      let pushedDistance = 0
      let blocker: Unit | null = null
      for (let step = 0; step < effect.distance; step += 1) {
        const next = neighbor(destination, direction)
        if (!inBounds(state.boardRows, state.boardCols, next)) {
          break
        }
        const occupied = getUnitAt(state, next)
        if (occupied) {
          blocker = occupied
          break
        }
        destination = next
        pushedDistance += 1
      }

      if (pushedDistance <= 0 && !blocker) {
        state.log.push(`Unit ${target.id} cannot be pushed.`)
      }

      if (pushedDistance > 0) {
        pushUnit(state, target, direction, pushedDistance)
      }

      const impactDamage = scaleRoguelikeMonsterCardDamage(state, order.player, effect.impactDamage ?? 0)
      const collisionDamage = scaleRoguelikeMonsterCardDamage(state, order.player, effect.collisionDamage)
      if (blocker) {
        const pushedTarget = state.units[target.id]
        if (!pushedTarget || !isAdjacentHex(pushedTarget.pos, blocker.pos)) return
        state.log.push(`Unit ${pushedTarget.id} collides with ${blocker.id}.`)
        applyDamage(state, pushedTarget, collisionDamage + impactDamage, actingUnit, order.defId)
        const remainingBlocker = state.units[blocker.id]
        if (remainingBlocker) {
          applyDamage(state, remainingBlocker, collisionDamage, actingUnit, order.defId)
        }
        return
      }

      const pushedTarget = state.units[target.id]
      if (impactDamage > 0 && pushedTarget) {
        applyDamage(state, pushedTarget, impactDamage, actingUnit, order.defId)
      }
      return
    }
    case 'whirlwind': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return

      const targetsByDirection: Array<{ direction: Direction; targetId: UnitId }> = []
      for (let dir = 0 as Direction; dir < 6; dir += 1) {
        const targetTile = neighbor(actingUnit.pos, dir)
        if (!inBounds(state.boardRows, state.boardCols, targetTile)) continue
        const target = getUnitAt(state, targetTile)
        if (!target) continue
        if (!canCardTargetUnit(order.defId, target)) continue
        targetsByDirection.push({ direction: dir, targetId: target.id })
      }
      targetsByDirection.forEach(({ direction, targetId }) => {
        const target = state.units[targetId]
        if (!target) return
        applyDamage(
          state,
          target,
          scaleRoguelikeMonsterCardDamage(state, order.player, effect.damage),
          actingUnit,
          order.defId
        )
        const surviving = state.units[targetId]
        if (!surviving) return
        pushUnit(state, surviving, direction, effect.pushDistance)
      })
      return
    }
    case 'moveAdjacentFriendlyGroup': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canActAsUnit(actingUnit)) return

      const direction = resolveDirection(actingUnit.facing, params, effect.direction)
      if (direction === null) return
      const distance =
        typeof effect.distance === 'number'
          ? effect.distance
          : params.distance !== undefined
            ? params.distance
            : null
      if (!distance) return

      const anchor = context.movedUnitOrigins[resolvedUnitId] ?? actingUnit.pos
      const adjacentIds = Object.values(state.units)
        .filter(
          (unit) =>
            unit.id !== resolvedUnitId &&
            unit.owner === order.player &&
            canActAsUnit(unit) &&
            isAdjacentHex(anchor, unit.pos)
        )
        .map((unit) => unit.id)
      const participantIds = [resolvedUnitId, ...adjacentIds].sort(
        (a, b) => projectAlongDirection(state.units[b].pos, direction) - projectAlongDirection(state.units[a].pos, direction)
      )
      moveUnitFormation(state, participantIds, direction, distance)
      return
    }
    case 'packHunt': {
      const resolvedUnitId = params.unitId ? resolveUnitId(state, order.player, params.unitId) : null
      if (!resolvedUnitId || params.direction === undefined) return
      const actingUnit = state.units[resolvedUnitId]
      if (!actingUnit || !canUnitActWithCard(order.defId, actingUnit)) return
      actingUnit.facing = params.direction
      moveUnit(state, actingUnit, params.direction, effect.moveDistance)
      const actorAfterMove = state.units[resolvedUnitId]
      if (!actorAfterMove || !canActAsUnit(actorAfterMove)) return
      const targetTile = neighbor(actorAfterMove.pos, actorAfterMove.facing)
      if (!inBounds(state.boardRows, state.boardCols, targetTile)) return
      const adjacentAllies = Object.values(state.units).filter(
        (unit) => unit.owner === order.player && canActAsUnit(unit) && isAdjacentHex(unit.pos, targetTile)
      ).length
      if (adjacentAllies <= 0) return
      const damagePerAdjacent = scaleRoguelikeMonsterCardDamage(state, order.player, effect.damagePerAdjacent)
      const target = getUnitAt(state, targetTile)
      if (!target || !canCardTargetUnit(order.defId, target)) return
      applyDamage(state, target, damagePerAdjacent * adjacentAllies, actorAfterMove, order.defId)
      return
    }
    case 'markAdvanceToward': {
      const targetUnit = params.unitId ? state.units[normalizeLegacyLeaderUnitId(params.unitId)] : null
      if (!targetUnit) return
      if (!isCardTargetUnitAllowedForPlayer(order.defId, order.player, targetUnit)) return
      const targetPos = { ...targetUnit.pos }
      const plans = Object.values(state.units)
        .filter((unit) => unit.owner === order.player && canActAsUnit(unit))
        .sort((a, b) => hexDistance(b.pos, targetPos) - hexDistance(a.pos, targetPos))
        .map<SimultaneousMovePlan | null>((ally) => {
          const live = state.units[ally.id]
          if (!live || !canActAsUnit(live)) return null
          const direction = getClosestDirectionToward(state, live, targetPos)
          if (direction === null) return null
          return { unitId: live.id, target: neighbor(live.pos, direction) }
        })
        .filter((plan): plan is SimultaneousMovePlan => plan !== null)
      executeSimultaneousMoves(state, plans)
      return
    }
    case 'convergeTowardTile': {
      const tile = getOrderTileParam(params, effect.tileParam)
      if (!tile) return
      const plans = Object.values(state.units)
        .filter((unit) => unit.owner === order.player && canActAsUnit(unit))
        .sort((a, b) => hexDistance(b.pos, tile) - hexDistance(a.pos, tile))
        .map<SimultaneousMovePlan | null>((ally) => {
          const live = state.units[ally.id]
          if (!live || !canActAsUnit(live)) return null
          const direction = getClosestDirectionToward(state, live, tile)
          if (direction === null) return null
          return {
            unitId: live.id,
            target: neighbor(live.pos, direction),
            faceMovedDirection: effect.faceMovedDirection === true,
          }
        })
        .filter((plan): plan is SimultaneousMovePlan => plan !== null)
      executeSimultaneousMoves(state, plans)
      return
    }
    default:
      return
  }
}

function chooseLeftBiasedDirection(candidates: Direction[]): Direction | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 2) {
    const [a, b] = candidates
    if (rotateDirection(a, 1) === b) return b
    if (rotateDirection(b, 1) === a) return a
  }
  return [...candidates].sort((a, b) => a - b)[0]
}

function getClosestDirectionToward(state: GameState, unit: Unit, target: Hex): Direction | null {
  let bestDistance = Number.POSITIVE_INFINITY
  const candidates: Direction[] = []
  for (let dir = 0 as Direction; dir < 6; dir += 1) {
    const next = neighbor(unit.pos, dir)
    if (!inBounds(state.boardRows, state.boardCols, next)) continue
    const distance = hexDistance(next, target)
    if (distance < bestDistance) {
      bestDistance = distance
      candidates.length = 0
      candidates.push(dir)
      continue
    }
    if (distance === bestDistance) {
      candidates.push(dir)
    }
  }
  return chooseLeftBiasedDirection(candidates)
}

function resolveDirection(facing: Direction, params: OrderParams, source: DirectionSource): Direction | null {
  if (source === 'facing') return facing
  if (typeof source === 'object' && source.type === 'param') {
    const value =
      source.key === 'moveDirection'
        ? params.moveDirection
        : source.key === 'faceDirection'
          ? params.faceDirection
          : params.direction
    if (value === undefined) return null
    return value
  }
  return null
}

function resolveDirections(facing: Direction, params: OrderParams, source: DirectionSource): Direction[] {
  if (source === 'facing') return [facing]
  if (typeof source === 'object' && source.type === 'param') {
    const value =
      source.key === 'moveDirection'
        ? params.moveDirection
        : source.key === 'faceDirection'
          ? params.faceDirection
          : params.direction
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



