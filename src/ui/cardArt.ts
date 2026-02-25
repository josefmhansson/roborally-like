import { CARD_DEFS } from '../engine/cards'
import { DEFAULT_SETTINGS } from '../engine/game'
import type { CardDef, CardTargetRequirement } from '../engine/cards'
import type { CardDefId, CardEffect, Direction } from '../engine/types'

type Axial = { q: number; r: number }

export type CardArtGrid =
  | {
      kind: 'hex'
      radius: number
      overflowFadeRing?: boolean
    }
  | {
      kind: 'rect'
      cols: number
      rows: number
    }

export type CardArtPrimitive =
  | {
      type: 'affectedTile'
      tile: Axial
      tone?: 'attack' | 'splash' | 'neutral'
    }
  | {
      type: 'tileHighlight'
      tile: Axial
      mode: 'option' | 'selected'
    }
  | {
      type: 'unit'
      tile: Axial
      owner: 'friendly' | 'enemy'
      facing: Direction
      showFacing?: boolean
      selected?: boolean
    }
  | {
      type: 'directionArrows'
      tile: Axial
      directions: Direction[]
      mode: 'option' | 'selected'
      selectedDirection?: Direction
    }
  | {
      type: 'damageOrbs'
      tile: Axial
      count: number
      role?: 'center' | 'splash' | 'example'
    }
  | {
      type: 'reinforceOrbs'
      tile: Axial
      count: number
    }
  | {
      type: 'teamOrbs'
      tile: Axial
      count: number
    }
  | {
      type: 'spawnRequirement'
      tile: Axial
    }
  | {
      type: 'beam'
      from: Axial
      to: Axial
      mode: 'option' | 'selected'
    }
  | {
      type: 'orbLink'
      from: Axial
      to: Axial
    }
  | {
      type: 'apOrbs'
      tile: Axial
      count: number
      gainedIndex?: number
    }
  | {
      type: 'upArrow'
      from: Axial
      to: Axial
    }
  | {
      type: 'plus'
      tile: Axial
    }
  | {
      type: 'actionStamp'
      tile: Axial
    }

type CardArtPanel = {
  id: string
  grid: CardArtGrid
  showGrid?: boolean
  primitives: CardArtPrimitive[]
}

export type CardArtScene = {
  source: 'generic' | 'override'
  layout: 'single' | 'multi-panel'
  range: number
  panels: CardArtPanel[]
}

export type CardArtBuildContext = {
  defId: CardDefId
  def: CardDef
  boardDepth: number
  range: number
}

export type CardArtOverrideFn = (ctx: CardArtBuildContext) => CardArtScene

const SQRT3 = Math.sqrt(3)
const BOARD_TILT = 0.8
const HEX_RADIUS = 8.7
const PANEL_PADDING = 8
const OUTER_PADDING = 4
const PANEL_GAP = 18
const BOARD_DEPTH = Math.max(DEFAULT_SETTINGS.boardRows, DEFAULT_SETTINGS.boardCols) - 1
const MAX_HEX_GRID_RADIUS = 3
const OVERFLOW_VISUAL_RING = 1

const ORIGIN: Axial = { q: 0, r: 0 }

const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

const CARD_ART_CACHE = new Map<CardDefId, string>()
const AP_SEAL_HREF = resolveAssetUrl('assets/cards/AP_seal.png')

export const CARD_ART_OVERRIDES: Partial<Record<CardDefId, CardArtOverrideFn>> = {
  attack_fwd: buildStrikeOverrideScene,
  spell_invest: buildInvestOverrideScene,
}

export function getCardArtSvg(defId: CardDefId): string {
  const cached = CARD_ART_CACHE.get(defId)
  if (cached) return cached

  const def = CARD_DEFS[defId]
  const context: CardArtBuildContext = {
    defId,
    def,
    boardDepth: BOARD_DEPTH,
    range: inferRange(def),
  }

  const override = CARD_ART_OVERRIDES[defId]
  const effectRuleScene = buildEffectRuleScene(context)
  const scene = override ? override(context) : effectRuleScene ?? buildGenericScene(context)
  const svg = renderSceneToSvg(context, scene)
  CARD_ART_CACHE.set(defId, svg)
  return svg
}

function buildEffectRuleScene(ctx: CardArtBuildContext): CardArtScene | null {
  if (ctx.def.effects.some((effect) => effect.type === 'shove')) {
    return buildImpactAttackRuleScene(ctx, 'shove')
  }
  if (ctx.def.effects.some((effect) => effect.type === 'whirlwind')) {
    return buildImpactAttackRuleScene(ctx, 'whirlwind')
  }
  return null
}

function inferRange(def: CardDef): number {
  const maxDistance = Math.max(...(def.requires.distanceOptions ?? [0]))
  const deepAttack = def.effects.some(
    (effect) => effect.type === 'attack' && (effect.mode === 'line' || effect.mode === 'ray')
  )
  const boardRange = deepAttack ? BOARD_DEPTH : 0
  return Math.max(maxDistance, boardRange, 1)
}

function buildGenericScene(ctx: CardArtBuildContext): CardArtScene {
  const multiTarget = getBoostTargetCount(ctx.def.effects) > 1
  const panelCount = multiTarget ? getBoostTargetCount(ctx.def.effects) : 1
  const layout: CardArtScene['layout'] = multiTarget ? 'multi-panel' : 'single'
  const minRadius = multiTarget ? 1 : 2
  const requestedRadius = Math.max(minRadius, ctx.range)
  const visualRange = getVisualRange(requestedRadius)
  const grid = chooseGrid(ctx.def.requires, requestedRadius)

  const panels: CardArtPanel[] = Array.from({ length: panelCount }, (_, index) => ({
    id: `panel-${index + 1}`,
    grid,
    primitives: [],
  }))

  if (isAnyUnitCard(ctx.def.requires)) {
    buildAnyUnitScene(panels[0], ctx)
  } else if (isAnyTileCard(ctx.def.requires)) {
    buildAnyTileScene(panels[0], ctx)
  } else if (ctx.def.effects.some((effect) => effect.type === 'spawn')) {
    buildSpawnScene(panels[0], ctx.def.requires.direction === true, ctx.def.requires.tile2 === 'barricade')
  } else {
    buildFriendlyUnitScene(panels, ctx, visualRange)
  }

  return {
    source: 'generic',
    layout,
    range: ctx.range,
    panels,
  }
}

function chooseGrid(requires: CardTargetRequirement, radius: number): CardArtGrid {
  if (requires.tile === 'any' || requires.unit === 'any') {
    return {
      kind: 'rect',
      cols: Math.max(5, DEFAULT_SETTINGS.boardCols),
      rows: Math.max(4, DEFAULT_SETTINGS.boardRows),
    }
  }
  if (radius > MAX_HEX_GRID_RADIUS) {
    return { kind: 'hex', radius: MAX_HEX_GRID_RADIUS, overflowFadeRing: true }
  }
  return { kind: 'hex', radius }
}

function getVisualRange(requestedRadius: number): number {
  if (requestedRadius <= MAX_HEX_GRID_RADIUS) return requestedRadius
  return MAX_HEX_GRID_RADIUS + OVERFLOW_VISUAL_RING
}

function buildAnyUnitScene(panel: CardArtPanel, ctx: CardArtBuildContext): void {
  const selectedEnemy: Axial = { q: 1, r: 0 }
  const mixedUnits: Array<{ tile: Axial; owner: 'friendly' | 'enemy'; selected?: boolean }> = [
    { tile: { q: -1, r: 0 }, owner: 'friendly' },
    { tile: selectedEnemy, owner: 'enemy', selected: true },
    { tile: { q: 0, r: 1 }, owner: 'enemy' },
    { tile: { q: 2, r: -1 }, owner: 'friendly' },
  ]

  mixedUnits.forEach((unit) => {
    panel.primitives.push({ type: 'tileHighlight', tile: unit.tile, mode: unit.selected ? 'selected' : 'option' })
    panel.primitives.push({
      type: 'unit',
      tile: unit.tile,
      owner: unit.owner,
      facing: unit.owner === 'enemy' ? 3 : 0,
      showFacing: false,
      selected: unit.selected,
    })
  })

  ctx.def.effects.forEach((effect) => {
    if (effect.type === 'damage') {
      panel.primitives.push({
        type: 'damageOrbs',
        tile: selectedEnemy,
        count: effect.amount,
        role: 'example',
      })
    }
  })
}

function buildAnyTileScene(panel: CardArtPanel, ctx: CardArtBuildContext): void {
  const center = { ...ORIGIN }
  const optionTiles = getGridTiles(panel.grid)
  optionTiles.forEach((tile) => panel.primitives.push({ type: 'tileHighlight', tile, mode: 'option' }))
  panel.primitives.push({ type: 'tileHighlight', tile: center, mode: 'selected' })

  ctx.def.effects.forEach((effect) => {
    if (effect.type === 'damageTileArea') {
      panel.primitives.push({
        type: 'affectedTile',
        tile: center,
        tone: 'attack',
      })
      panel.primitives.push({
        type: 'damageOrbs',
        tile: center,
        count: effect.centerAmount,
        role: 'center',
      })
      DIRECTIONS.forEach((dir) => {
        panel.primitives.push({
          type: 'affectedTile',
          tile: addHex(center, dir),
          tone: 'splash',
        })
        panel.primitives.push({
          type: 'damageOrbs',
          tile: addHex(center, dir),
          count: effect.splashAmount,
          role: 'splash',
        })
      })
    }
    if (effect.type === 'damageTile') {
      panel.primitives.push({
        type: 'affectedTile',
        tile: center,
        tone: 'attack',
      })
      panel.primitives.push({
        type: 'damageOrbs',
        tile: center,
        count: effect.amount,
        role: 'center',
      })
    }
  })
}

function buildSpawnScene(panel: CardArtPanel, requiresDirection: boolean, hasSecondTile: boolean): void {
  const secondTile = hasSecondTile ? addHex(ORIGIN, DIRECTIONS[0]) : null
  panel.primitives.push({ type: 'tileHighlight', tile: ORIGIN, mode: 'selected' })
  if (secondTile) {
    panel.primitives.push({ type: 'tileHighlight', tile: secondTile, mode: 'selected' })
  }
  panel.primitives.push({ type: 'spawnRequirement', tile: ORIGIN })
  if (secondTile) {
    panel.primitives.push({ type: 'spawnRequirement', tile: secondTile })
  }
  panel.primitives.push({ type: 'unit', tile: ORIGIN, owner: 'friendly', facing: 0, showFacing: false })
  if (secondTile) {
    panel.primitives.push({ type: 'unit', tile: secondTile, owner: 'friendly', facing: 0, showFacing: false })
  }
  if (requiresDirection) {
    panel.primitives.push({
      type: 'directionArrows',
      tile: ORIGIN,
      directions: [0, 1, 2, 3, 4, 5],
      mode: 'option',
    })
  }
}

type MovementArtSemantics = {
  directionSource: 'facing' | { type: 'param'; key: 'direction' | 'moveDirection' }
  distanceSource: { type: 'fixed'; value: number } | { type: 'param'; key: 'distance' }
  finalFacingSource: { type: 'preserve' } | { type: 'param'; key: 'direction' | 'faceDirection' }
}

function deriveMovementArtSemantics(def: CardDef): MovementArtSemantics | null {
  const moveEffect = def.effects.find(
    (effect): effect is Extract<CardEffect, { type: 'move' }> => effect.type === 'move' && effect.unitParam === 'unitId'
  )
  if (!moveEffect) return null

  const directionSource =
    moveEffect.direction === 'facing' ? 'facing' : moveEffect.direction.type === 'param' ? moveEffect.direction : null
  if (!directionSource) return null

  const distanceSource =
    typeof moveEffect.distance === 'number'
      ? { type: 'fixed' as const, value: moveEffect.distance }
      : { type: 'param' as const, key: moveEffect.distance.key }

  const faceEffect = def.effects.find(
    (effect): effect is Extract<CardEffect, { type: 'face' }> => effect.type === 'face' && effect.unitParam === 'unitId'
  )
  const finalFacingSource = faceEffect
    ? { type: 'param' as const, key: faceEffect.directionParam }
    : { type: 'preserve' as const }

  return {
    directionSource,
    distanceSource,
    finalFacingSource,
  }
}

function buildFriendlyUnitScene(panels: CardArtPanel[], ctx: CardArtBuildContext, visualRange: number): void {
  const isMoveCard = ctx.def.effects.some((effect) => effect.type === 'move')
  const showOriginFacing = cardUsesCurrentFacing(ctx.def)
  const isPivotOnly =
    !isMoveCard &&
    ctx.def.effects.some((effect) => effect.type === 'face') &&
    ctx.def.effects.every((effect) => effect.type === 'face')
  const isMultiBoost = getBoostTargetCount(ctx.def.effects) > 1

  panels.forEach((panel, index) => {
    panel.primitives.push({ type: 'unit', tile: ORIGIN, owner: 'friendly', facing: 0, showFacing: showOriginFacing })

    if (isMultiBoost) {
      panel.primitives.push({ type: 'tileHighlight', tile: ORIGIN, mode: 'selected' })
    }

    ctx.def.effects.forEach((effect) => {
      if (effect.type === 'boost') {
        panel.primitives.push({
          type: 'reinforceOrbs',
          tile: ORIGIN,
          count: effect.amount,
        })
        if (effect.requireSpawnTile) {
          panel.primitives.push({ type: 'spawnRequirement', tile: ORIGIN })
        }
      }
      if (effect.type === 'attack') {
        addAttackVisual(panel, effect, visualRange, ctx.def.id)
      }
    })

    if (isMultiBoost && index < panels.length - 1) {
      panels[index + 1].primitives.push({
        type: 'unit',
        tile: ORIGIN,
        owner: 'friendly',
        facing: 0,
        showFacing: showOriginFacing,
      })
    }
  })

  if (ctx.def.requires.distanceOptions && isMoveCard) {
    addDistanceSelectionVisuals(panels[0], ctx, visualRange)
    return
  }

  if (ctx.def.requires.moveDirection && ctx.def.requires.faceDirection && isMoveCard) {
    const moveTarget = addHex(ORIGIN, DIRECTIONS[0])
    DIRECTIONS.forEach((dir) => {
      panels[0].primitives.push({ type: 'tileHighlight', tile: addHex(ORIGIN, dir), mode: 'option' })
    })
    panels[0].primitives.push({ type: 'tileHighlight', tile: moveTarget, mode: 'selected' })
    panels[0].primitives.push({ type: 'beam', from: ORIGIN, to: moveTarget, mode: 'selected' })
    panels[0].primitives.push({
      type: 'directionArrows',
      tile: moveTarget,
      directions: [0, 1, 2, 3, 4, 5],
      mode: 'option',
    })
    return
  }

  if (ctx.def.requires.direction && isPivotOnly) {
    panels[0].primitives.push({ type: 'tileHighlight', tile: ORIGIN, mode: 'selected' })
    panels[0].primitives.push({
      type: 'directionArrows',
      tile: ORIGIN,
      directions: [0, 1, 2, 3, 4, 5],
      mode: 'option',
    })
  }
}

function addDistanceSelectionVisuals(panel: CardArtPanel, ctx: CardArtBuildContext, visualRange: number): void {
  const semantics = deriveMovementArtSemantics(ctx.def)
  if (!semantics) return
  const distances =
    semantics.distanceSource.type === 'param' ? (ctx.def.requires.distanceOptions ?? []) : [semantics.distanceSource.value]
  if (distances.length === 0) return
  const visualDistances = Array.from(new Set(distances.map((distance) => Math.min(distance, visualRange))))
  const maxDistance = Math.min(Math.max(...distances), visualRange)
  const originalFacing: Direction = 0
  const moveDirections: Direction[] =
    semantics.directionSource === 'facing' ? [originalFacing] : ([0, 1, 2, 3, 4, 5] as Direction[])
  const sampleMoveDirection = moveDirections[0] ?? originalFacing
  const selected = walk(ORIGIN, sampleMoveDirection, maxDistance)

  moveDirections.forEach((dir) => {
    visualDistances.forEach((distance) => {
      panel.primitives.push({
        type: 'tileHighlight',
        tile: walk(ORIGIN, dir, distance),
        mode: 'option',
      })
    })
  })

  panel.primitives.push({ type: 'tileHighlight', tile: selected, mode: 'selected' })
  panel.primitives.push({ type: 'beam', from: ORIGIN, to: selected, mode: 'selected' })
  if (semantics.finalFacingSource.type === 'preserve') {
    panel.primitives.push({
      type: 'directionArrows',
      tile: selected,
      directions: [originalFacing],
      mode: 'selected',
      selectedDirection: originalFacing,
    })
    return
  }

  if (semantics.directionSource !== 'facing' && semantics.finalFacingSource.key === semantics.directionSource.key) {
    panel.primitives.push({
      type: 'directionArrows',
      tile: selected,
      directions: [sampleMoveDirection],
      mode: 'selected',
      selectedDirection: sampleMoveDirection,
    })
    return
  }

  panel.primitives.push({
    type: 'directionArrows',
    tile: selected,
    directions: [0, 1, 2, 3, 4, 5],
    mode: 'option',
  })
}

function addAttackVisual(
  panel: CardArtPanel,
  effect: Extract<CardEffect, { type: 'attack' }>,
  range: number,
  defId: CardDefId
): void {
  const directions = resolveAttackDirections(effect)
  if (effect.mode === 'nearest') {
    directions.forEach((dir) => {
      const target = walk(ORIGIN, dir, 1)
      panel.primitives.push({ type: 'affectedTile', tile: target, tone: 'attack' })
      panel.primitives.push({ type: 'beam', from: ORIGIN, to: target, mode: 'selected' })
      panel.primitives.push({
        type: 'damageOrbs',
        tile: target,
        count: typeof effect.damage === 'number' ? effect.damage : 3,
      })
    })
    return
  }

  if (effect.mode === 'line') {
    const dir = directions[0] ?? 0
    const primary = walk(ORIGIN, dir, 2)
    for (let step = 1; step <= Math.min(range, 4); step += 1) {
      panel.primitives.push({ type: 'affectedTile', tile: walk(ORIGIN, dir, step), tone: 'attack' })
    }
    if (defId === 'attack_arrow') {
      panel.primitives.push({
        type: 'unit',
        tile: primary,
        owner: 'enemy',
        facing: 3,
        selected: true,
        showFacing: false,
      })
    }
    panel.primitives.push({ type: 'beam', from: ORIGIN, to: primary, mode: 'selected' })
    panel.primitives.push({
      type: 'damageOrbs',
      tile: primary,
      count: typeof effect.damage === 'number' ? effect.damage : 3,
      role: 'example',
    })
    return
  }

  if (effect.mode === 'ray') {
    const dir = directions[0] ?? 0
    for (let step = 1; step <= range; step += 1) {
      const tile = walk(ORIGIN, dir, step)
      panel.primitives.push({ type: 'affectedTile', tile, tone: 'attack' })
      if (step <= 3) {
        panel.primitives.push({
          type: 'damageOrbs',
          tile,
          count: typeof effect.damage === 'number' ? effect.damage : 3,
        })
      }
    }
    panel.primitives.push({ type: 'beam', from: ORIGIN, to: walk(ORIGIN, dir, range), mode: 'selected' })
  }
}

function resolveAttackDirections(effect: Extract<CardEffect, { type: 'attack' }>): Direction[] {
  if (effect.directions === 'facing') return [0]
  if (effect.directions.type === 'relative') {
    return effect.directions.offsets.map((offset) => normalizeDirection(offset))
  }
  return [0]
}

function normalizeDirection(value: number): Direction {
  const normalized = ((value % 6) + 6) % 6
  return normalized as Direction
}

function buildStrikeOverrideScene(ctx: CardArtBuildContext): CardArtScene {
  const target = addHex(ORIGIN, DIRECTIONS[0])
  return {
    source: 'override',
    layout: 'single',
    range: ctx.range,
    panels: [
      {
        id: 'panel-1',
        grid: { kind: 'hex', radius: 2 },
        primitives: [
          { type: 'unit', tile: ORIGIN, owner: 'friendly', facing: 0, showFacing: false },
          ...([0, 1, 2, 3, 4, 5] as Direction[]).map((dir) => ({
            type: 'tileHighlight' as const,
            tile: walk(ORIGIN, dir, 1),
            mode: 'option' as const,
          })),
          { type: 'tileHighlight', tile: target, mode: 'selected' },
          {
            type: 'directionArrows',
            tile: ORIGIN,
            directions: [0, 1, 2, 3, 4, 5],
            mode: 'option',
            selectedDirection: 0,
          },
          { type: 'affectedTile', tile: target, tone: 'attack' },
          { type: 'teamOrbs', tile: ORIGIN, count: 3 },
          { type: 'damageOrbs', tile: target, count: 3, role: 'example' },
          { type: 'orbLink', from: ORIGIN, to: target },
        ],
      },
    ],
  }
}

function buildInvestOverrideScene(ctx: CardArtBuildContext): CardArtScene {
  return {
    source: 'override',
    layout: 'single',
    range: ctx.range,
    panels: [
      {
        id: 'panel-1',
        grid: { kind: 'hex', radius: 1 },
        showGrid: false,
        primitives: [
          { type: 'plus', tile: { q: -1, r: 0 } },
          { type: 'actionStamp', tile: { q: 1, r: 0 } },
        ],
      },
    ],
  }
}

function buildImpactAttackRuleScene(ctx: CardArtBuildContext, mode: 'shove' | 'whirlwind'): CardArtScene {
  const primitives: CardArtPrimitive[] = [{ type: 'unit', tile: ORIGIN, owner: 'friendly', facing: 0, showFacing: false }]

  if (mode === 'shove') {
    const target = addHex(ORIGIN, DIRECTIONS[0])
    const pushed = addHex(target, DIRECTIONS[0])
    primitives.push(
      {
        type: 'directionArrows',
        tile: ORIGIN,
        directions: [0, 1, 2, 3, 4, 5],
        mode: 'option',
        selectedDirection: 0,
      },
      { type: 'tileHighlight', tile: target, mode: 'selected' },
      { type: 'tileHighlight', tile: pushed, mode: 'selected' },
      { type: 'beam', from: ORIGIN, to: target, mode: 'selected' },
      { type: 'upArrow', from: target, to: pushed },
      { type: 'unit', tile: target, owner: 'enemy', facing: 3, selected: true, showFacing: false },
      { type: 'unit', tile: pushed, owner: 'enemy', facing: 3, selected: true, showFacing: false },
      { type: 'damageOrbs', tile: target, count: 3, role: 'example' },
      { type: 'damageOrbs', tile: pushed, count: 3, role: 'example' }
    )
  } else {
    const ringDirections = [0, 1, 2, 3, 4, 5] as Direction[]
    const showcasedDirections = [0, 2, 4] as Direction[]
    ringDirections.forEach((dir) => {
      const tile = walk(ORIGIN, dir, 1)
      primitives.push(
        { type: 'tileHighlight', tile, mode: 'selected' },
        { type: 'affectedTile', tile, tone: 'attack' },
        { type: 'damageOrbs', tile, count: 3, role: 'example' }
      )
    })
    showcasedDirections.forEach((dir) => {
      const tile = walk(ORIGIN, dir, 1)
      const pushed = walk(ORIGIN, dir, 2)
      primitives.push(
        { type: 'unit', tile, owner: 'enemy', facing: normalizeDirection(dir + 3), selected: true, showFacing: false },
        { type: 'upArrow', from: tile, to: pushed },
        { type: 'tileHighlight', tile: pushed, mode: 'option' }
      )
    })
  }

  return {
    source: 'override',
    layout: 'single',
    range: ctx.range,
    panels: [
      {
        id: 'panel-1',
        grid: { kind: 'hex', radius: 2 },
        primitives,
      },
    ],
  }
}

function getBoostTargetCount(effects: CardEffect[]): number {
  const unitParams = effects
    .filter((effect): effect is Extract<CardEffect, { type: 'boost' }> => effect.type === 'boost')
    .map((effect) => effect.unitParam)
  return new Set(unitParams).size
}

function isAnyUnitCard(requires: CardTargetRequirement): boolean {
  return requires.unit === 'any'
}

function isAnyTileCard(requires: CardTargetRequirement): boolean {
  return requires.tile === 'any'
}

function cardUsesCurrentFacing(def: CardDef): boolean {
  const moveSemantics = deriveMovementArtSemantics(def)
  if (moveSemantics) {
    if (moveSemantics.directionSource === 'facing') return true
    if (moveSemantics.finalFacingSource.type === 'preserve') return true
  }

  return def.effects.some((effect) => {
    if (effect.type === 'attack') {
      if (effect.directions === 'facing') return true
      if (typeof effect.directions === 'object' && effect.directions.type === 'relative') return true
    }
    return false
  })
}

function addHex(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r }
}

function walk(origin: Axial, direction: Direction, distance: number): Axial {
  const dir = DIRECTIONS[direction]
  return {
    q: origin.q + dir.q * distance,
    r: origin.r + dir.r * distance,
  }
}

type RenderedPanel = {
  panel: CardArtPanel
  tiles: Axial[]
  fadeTiles: Axial[]
  centers: Map<string, { x: number; y: number }>
  width: number
  height: number
  minX: number
  minY: number
}

function renderSceneToSvg(ctx: CardArtBuildContext, scene: CardArtScene): string {
  const renderedPanels = scene.panels.map(preparePanel)
  const maxHeight = renderedPanels.reduce((max, panel) => Math.max(max, panel.height), 0)
  const panelGap = scene.layout === 'multi-panel' ? PANEL_GAP : 0

  let cursor = OUTER_PADDING
  const panelOrigins: Array<{ x: number; y: number }> = []
  renderedPanels.forEach((panel) => {
    panelOrigins.push({
      x: cursor,
      y: OUTER_PADDING + (maxHeight - panel.height) / 2,
    })
    cursor += panel.width + panelGap
  })

  const width = Math.max(1, cursor - panelGap + OUTER_PADDING)
  const height = Math.max(1, maxHeight + OUTER_PADDING * 2)

  const content: string[] = []
  content.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true" data-card-art-id="${ctx.defId}" data-art-source="${scene.source}" data-art-layout="${scene.layout}" data-range="${scene.range}">`
  )

  renderedPanels.forEach((rendered, index) => {
    const origin = panelOrigins[index]
    content.push(`<g data-panel-id="${rendered.panel.id}">`)
    if (rendered.panel.showGrid !== false) {
      rendered.fadeTiles.forEach((tile) => {
        const center = resolvePanelPoint(rendered, origin, tile)
        if (!center) return
        content.push(
          `<polygon data-primitive="grid-fade" points="${hexPoints(center, HEX_RADIUS)}" fill="rgba(12,22,32,0.07)" stroke="rgba(7,4,5,0.35)" stroke-width="0.75" />`
        )
      })
      rendered.tiles.forEach((tile) => {
        const center = resolvePanelPoint(rendered, origin, tile)
        if (!center) return
        content.push(
          `<polygon points="${hexPoints(center, HEX_RADIUS)}" fill="rgba(12,22,32,0.18)" stroke="#070405" stroke-width="0.82" />`
        )
      })
    }

    const ordered = sortPrimitivesForRender(rendered.panel.primitives)
    ordered.forEach((primitive) => {
      content.push(renderPrimitive(rendered, origin, primitive))
    })
    content.push('</g>')
  })

  if (scene.layout === 'multi-panel' && panelOrigins.length > 1) {
    for (let i = 0; i < panelOrigins.length - 1; i += 1) {
      const left = renderedPanels[i]
      const leftX = panelOrigins[i].x + left.width
      const rightX = panelOrigins[i + 1].x
      const cx = (leftX + rightX) / 2
      const cy = height / 2
      content.push(`<g data-primitive="ellipsis">`)
      content.push(`<circle cx="${formatNumber(cx - 4)}" cy="${formatNumber(cy)}" r="1.4" fill="#101015" />`)
      content.push(`<circle cx="${formatNumber(cx)}" cy="${formatNumber(cy)}" r="1.4" fill="#101015" />`)
      content.push(`<circle cx="${formatNumber(cx + 4)}" cy="${formatNumber(cy)}" r="1.4" fill="#101015" />`)
      content.push('</g>')
    }
  }

  content.push('</svg>')
  return content.join('')
}

function preparePanel(panel: CardArtPanel): RenderedPanel {
  const tiles = getGridTiles(panel.grid)
  const fadeTiles = getGridFadeTiles(panel.grid)
  const allTiles = [...tiles, ...fadeTiles]
  const centers = new Map<string, { x: number; y: number }>()
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  allTiles.forEach((tile) => {
    const center = toPoint(tile)
    centers.set(hexKey(tile), center)
    minX = Math.min(minX, center.x - HEX_RADIUS)
    maxX = Math.max(maxX, center.x + HEX_RADIUS)
    minY = Math.min(minY, center.y - HEX_RADIUS)
    maxY = Math.max(maxY, center.y + HEX_RADIUS)
  })

  if (!tiles.length) {
    const center = toPoint(ORIGIN)
    centers.set(hexKey(ORIGIN), center)
    minX = center.x - HEX_RADIUS
    maxX = center.x + HEX_RADIUS
    minY = center.y - HEX_RADIUS
    maxY = center.y + HEX_RADIUS
  }

  return {
    panel,
    tiles,
    fadeTiles,
    centers,
    width: maxX - minX + PANEL_PADDING * 2,
    height: maxY - minY + PANEL_PADDING * 2,
    minX,
    minY,
  }
}

function getGridTiles(grid: CardArtGrid): Axial[] {
  if (grid.kind === 'hex') {
    const tiles: Axial[] = []
    for (let q = -grid.radius; q <= grid.radius; q += 1) {
      for (let r = -grid.radius; r <= grid.radius; r += 1) {
        const s = -q - r
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= grid.radius) {
          tiles.push({ q, r })
        }
      }
    }
    return tiles
  }

  const centerRow = Math.floor(grid.rows / 2)
  const centerCol = Math.floor(grid.cols / 2)
  const centerAxialQ = centerCol - (centerRow + (centerRow & 1)) / 2
  const tiles: Axial[] = []
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const q = col - (row + (row & 1)) / 2 - centerAxialQ
      const r = row - centerRow
      tiles.push({ q, r })
    }
  }
  return tiles
}

function getGridFadeTiles(grid: CardArtGrid): Axial[] {
  if (grid.kind !== 'hex') return []
  if (!grid.overflowFadeRing) return []
  return getHexRingTiles(grid.radius + OVERFLOW_VISUAL_RING)
}

function getHexRingTiles(radius: number): Axial[] {
  const ring: Axial[] = []
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = -radius; r <= radius; r += 1) {
      const s = -q - r
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) !== radius) continue
      ring.push({ q, r })
    }
  }
  return ring
}

function toPoint(tile: Axial): { x: number; y: number } {
  return {
    x: HEX_RADIUS * SQRT3 * (tile.q + tile.r / 2),
    y: HEX_RADIUS * 1.5 * tile.r * BOARD_TILT,
  }
}

function resolvePanelPoint(rendered: RenderedPanel, origin: { x: number; y: number }, tile: Axial): { x: number; y: number } | null {
  const local = rendered.centers.get(hexKey(tile))
  if (!local) return null
  return {
    x: origin.x + (local.x - rendered.minX + PANEL_PADDING),
    y: origin.y + (local.y - rendered.minY + PANEL_PADDING),
  }
}

function hexKey(tile: Axial): string {
  return `${tile.q},${tile.r}`
}

function sortPrimitivesForRender(primitives: CardArtPrimitive[]): CardArtPrimitive[] {
  const order: Record<CardArtPrimitive['type'], number> = {
    affectedTile: 1,
    tileHighlight: 2,
    beam: 3,
    orbLink: 3,
    directionArrows: 4,
    spawnRequirement: 5,
    unit: 6,
    damageOrbs: 7,
    reinforceOrbs: 7,
    teamOrbs: 7,
    apOrbs: 7,
    actionStamp: 7,
    plus: 8,
    upArrow: 8,
  }
  return [...primitives].sort((a, b) => order[a.type] - order[b.type])
}

function renderPrimitive(rendered: RenderedPanel, origin: { x: number; y: number }, primitive: CardArtPrimitive): string {
  if (primitive.type === 'affectedTile') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const fill = primitive.tone === 'splash' ? 'rgba(166, 82, 49, 0.42)' : 'rgba(146, 48, 48, 0.48)'
    return `<polygon data-primitive="affected-tile" data-tone="${primitive.tone ?? 'neutral'}" points="${hexPoints(center, HEX_RADIUS - 0.9)}" fill="${fill}" stroke="rgba(7,4,5,0.88)" stroke-width="0.65" />`
  }

  if (primitive.type === 'tileHighlight') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    if (primitive.mode === 'selected') {
      return [
        `<polygon data-primitive="tile-highlight" data-mode="selected" points="${hexPoints(center, HEX_RADIUS - 0.7)}" fill="none" stroke="#57c8ff" stroke-width="1.4" />`,
        `<polygon data-primitive="tile-highlight-inner" data-mode="selected" points="${hexPoints(center, HEX_RADIUS - 2.5)}" fill="none" stroke="#ffe66a" stroke-width="1.4" />`,
      ].join('')
    }
    return `<polygon data-primitive="tile-highlight" data-mode="option" points="${hexPoints(center, HEX_RADIUS - 0.7)}" fill="none" stroke="#57c8ff" stroke-width="1.4" />`
  }

  if (primitive.type === 'unit') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const color = primitive.owner === 'friendly' ? '#4aa6ff' : '#ff5b5b'
    const showFacing = primitive.showFacing ?? primitive.owner === 'friendly'
    const adjacent = resolvePanelPoint(rendered, origin, addHex(primitive.tile, DIRECTIONS[primitive.facing]))
    const markerTarget = adjacent ?? directionTip(center, primitive.facing, HEX_RADIUS * 1.7)
    const facingTriangle = showFacing ? triangleMarker(center, markerTarget, 3.53, 4.8) : ''
    return [
      `<g data-primitive="unit" data-owner="${primitive.owner}" data-selected="${primitive.selected ? 'true' : 'false'}" data-show-facing="${showFacing ? 'true' : 'false'}">`,
      `<circle cx="${formatNumber(center.x)}" cy="${formatNumber(center.y)}" r="4.2" fill="${color}" stroke="#0f1524" stroke-width="1.1" />`,
      showFacing ? `<path d="${facingTriangle}" fill="${color}" stroke="#060709" stroke-width="0.85" stroke-linejoin="round" />` : '',
      `</g>`,
    ].join('')
  }

  if (primitive.type === 'directionArrows') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const modeColor = primitive.mode === 'selected' ? '#ffe66a' : '#57c8ff'
    const arrows = primitive.directions
      .map((dir) => {
        const adjacent = resolvePanelPoint(rendered, origin, addHex(primitive.tile, DIRECTIONS[dir]))
        const markerTarget = adjacent ?? directionTip(center, dir, HEX_RADIUS * 1.68)
        const color =
          primitive.selectedDirection !== undefined
            ? dir === primitive.selectedDirection
              ? '#ffe66a'
              : '#57c8ff'
            : modeColor
        return `<path d="${triangleMarker(center, markerTarget, 3.08, 4.2)}" fill="${color}" stroke="#05060a" stroke-width="0.92" stroke-linejoin="round" />`
      })
      .join('')
    const selectedAttr = primitive.selectedDirection !== undefined ? ` data-selected-direction="${primitive.selectedDirection}"` : ''
    return `<g data-primitive="direction-arrows" data-mode="${primitive.mode}"${selectedAttr}>${arrows}</g>`
  }

  if (primitive.type === 'damageOrbs') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const orbs = renderStackedOrbs(center, primitive.count, '#ff5b5b', '#ffb3b3')
    return `<g data-primitive="damage-orbs" data-count="${primitive.count}" data-role="${primitive.role ?? 'default'}">${orbs}</g>`
  }

  if (primitive.type === 'reinforceOrbs') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const orbs = renderStackedOrbs(center, primitive.count, '#53e083', '#b7ffd3')
    return `<g data-primitive="reinforce-orbs" data-count="${primitive.count}">${orbs}</g>`
  }

  if (primitive.type === 'teamOrbs') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const orbs = renderStackedOrbs(center, primitive.count, '#4aa6ff', '#bee2ff')
    return `<g data-primitive="team-orbs" data-count="${primitive.count}">${orbs}</g>`
  }

  if (primitive.type === 'spawnRequirement') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const cy = center.y + HEX_RADIUS + 4
    return [
      `<g data-primitive="spawn-glyph">`,
      `<path d="M ${formatNumber(center.x - 5)} ${formatNumber(cy)} L ${formatNumber(center.x)} ${formatNumber(cy - 5)} L ${formatNumber(center.x + 5)} ${formatNumber(cy)} L ${formatNumber(center.x)} ${formatNumber(cy + 3)} Z" fill="#2a2f3a" stroke="#7de899" stroke-width="0.9" />`,
      `<path d="M ${formatNumber(center.x - 2.2)} ${formatNumber(cy)} L ${formatNumber(center.x)} ${formatNumber(cy - 2.2)} L ${formatNumber(center.x + 2.2)} ${formatNumber(cy)} L ${formatNumber(center.x)} ${formatNumber(cy + 1.3)} Z" fill="#7de899" />`,
      `</g>`,
    ].join('')
  }

  if (primitive.type === 'beam') {
    const from = resolvePanelPoint(rendered, origin, primitive.from)
    const to = resolvePanelPoint(rendered, origin, primitive.to)
    if (!from || !to) return ''
    const color = primitive.mode === 'selected' ? '#ffe66a' : '#57c8ff'
    return [
      `<g data-primitive="beam" data-mode="${primitive.mode}">`,
      `<path d="M ${formatNumber(from.x)} ${formatNumber(from.y)} L ${formatNumber(to.x)} ${formatNumber(to.y)}" stroke="${color}" stroke-width="1.25" stroke-linecap="round" />`,
      `<path d="${arrowHeadPath(from, to, 2.5)}" fill="${color}" />`,
      `</g>`,
    ].join('')
  }

  if (primitive.type === 'orbLink') {
    const from = resolvePanelPoint(rendered, origin, primitive.from)
    const to = resolvePanelPoint(rendered, origin, primitive.to)
    if (!from || !to) return ''
    return [
      `<g data-primitive="orb-link">`,
      `<path d="M ${formatNumber(from.x)} ${formatNumber(from.y)} L ${formatNumber(to.x)} ${formatNumber(to.y)}" stroke="#ffe66a" stroke-width="1.35" stroke-linecap="round" />`,
      `<path d="${arrowHeadPath(from, to, 2.8)}" fill="#ffe66a" />`,
      `</g>`,
    ].join('')
  }

  if (primitive.type === 'apOrbs') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const spacing = 4.25
    const startX = center.x - ((primitive.count - 1) * spacing) / 2
    const y = center.y + HEX_RADIUS + 2.5
    const circles: string[] = []
    for (let i = 0; i < primitive.count; i += 1) {
      const cx = startX + i * spacing
      const highlighted = primitive.gainedIndex === i
      circles.push(
        `<circle cx="${formatNumber(cx)}" cy="${formatNumber(y)}" r="1.9" fill="${highlighted ? '#f7e081' : '#dcb35c'}" stroke="#3d2a0f" stroke-width="0.7" />`
      )
      circles.push(
        `<circle cx="${formatNumber(cx - 0.5)}" cy="${formatNumber(y - 0.55)}" r="0.65" fill="${highlighted ? '#fff6c8' : '#f7d59b'}" opacity="0.9" />`
      )
    }
    return `<g data-primitive="ap-orbs" data-count="${primitive.count}">${circles.join('')}</g>`
  }

  if (primitive.type === 'upArrow') {
    const from = resolvePanelPoint(rendered, origin, primitive.from)
    const to = resolvePanelPoint(rendered, origin, primitive.to)
    if (!from || !to) return ''
    return [
      `<g data-primitive="up-arrow">`,
      `<path d="M ${formatNumber(from.x)} ${formatNumber(from.y)} L ${formatNumber(to.x)} ${formatNumber(to.y)}" stroke="#ffe66a" stroke-width="1.4" stroke-linecap="round" />`,
      `<path d="${arrowHeadPath(from, to, 3.1)}" fill="#ffe66a" />`,
      `</g>`,
    ].join('')
  }

  if (primitive.type === 'actionStamp') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const size = 64
    const x = center.x - size / 2
    const y = center.y - size / 2
    return [
      `<g data-primitive="action-stamp">`,
      `<image href="${escapeAttr(AP_SEAL_HREF)}" x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(size)}" height="${formatNumber(size)}" preserveAspectRatio="xMidYMid meet" />`,
      `</g>`,
    ].join('')
  }

  if (primitive.type === 'plus') {
    const center = resolvePanelPoint(rendered, origin, primitive.tile)
    if (!center) return ''
    const h = 4.2
    return [
      `<g data-primitive="plus">`,
      `<path d="M ${formatNumber(center.x - h)} ${formatNumber(center.y)} L ${formatNumber(center.x + h)} ${formatNumber(center.y)} M ${formatNumber(center.x)} ${formatNumber(center.y - h)} L ${formatNumber(center.x)} ${formatNumber(center.y + h)}" stroke="#060709" stroke-width="2.8" stroke-linecap="round" />`,
      `<path d="M ${formatNumber(center.x - h)} ${formatNumber(center.y)} L ${formatNumber(center.x + h)} ${formatNumber(center.y)} M ${formatNumber(center.x)} ${formatNumber(center.y - h)} L ${formatNumber(center.x)} ${formatNumber(center.y + h)}" stroke="#ffe66a" stroke-width="1.6" stroke-linecap="round" />`,
      `</g>`,
    ].join('')
  }

  return ''
}

function renderStackedOrbs(
  center: { x: number; y: number },
  count: number,
  midColor: string,
  highlightColor: string
): string {
  const safeCount = Math.max(0, Math.min(count, 7))
  const parts: string[] = []
  for (let i = 0; i < safeCount; i += 1) {
    const cx = center.x + HEX_RADIUS * 0.47
    const cy = center.y - i * 3.15 + HEX_RADIUS * 0.3
    parts.push(
      `<circle cx="${formatNumber(cx)}" cy="${formatNumber(cy)}" r="1.82" fill="${midColor}" stroke="#1a1111" stroke-width="0.58" />`
    )
    parts.push(`<circle cx="${formatNumber(cx - 0.44)}" cy="${formatNumber(cy - 0.46)}" r="0.66" fill="${highlightColor}" />`)
  }
  return parts.join('')
}

function directionTip(center: { x: number; y: number }, direction: Direction, length: number): { x: number; y: number } {
  const delta = DIRECTIONS[direction]
  const deltaPoint = toPoint(delta)
  const magnitude = Math.hypot(deltaPoint.x, deltaPoint.y) || 1
  const nx = deltaPoint.x / magnitude
  const ny = deltaPoint.y / magnitude
  return {
    x: center.x + nx * length,
    y: center.y + ny * length,
  }
}

function triangleMarker(
  from: { x: number; y: number },
  toward: { x: number; y: number },
  baseHalf: number,
  tipLength: number
): string {
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const nx = dx / length
  const ny = dy / length
  const px = -ny
  const py = nx
  const baseCenterX = from.x + nx * (HEX_RADIUS - 0.35)
  const baseCenterY = from.y + ny * (HEX_RADIUS - 0.35)
  const tipX = baseCenterX + nx * tipLength
  const tipY = baseCenterY + ny * tipLength
  const leftX = baseCenterX + px * baseHalf
  const leftY = baseCenterY + py * baseHalf
  const rightX = baseCenterX - px * baseHalf
  const rightY = baseCenterY - py * baseHalf
  return `M ${formatNumber(tipX)} ${formatNumber(tipY)} L ${formatNumber(leftX)} ${formatNumber(leftY)} L ${formatNumber(rightX)} ${formatNumber(rightY)} Z`
}

function arrowHeadPath(from: { x: number; y: number }, to: { x: number; y: number }, size: number): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const nx = dx / length
  const ny = dy / length
  const px = -ny
  const py = nx
  const baseX = to.x - nx * size
  const baseY = to.y - ny * size
  const wing = size * 0.56
  const p1x = baseX + px * wing
  const p1y = baseY + py * wing
  const p2x = baseX - px * wing
  const p2y = baseY - py * wing
  return `M ${formatNumber(to.x)} ${formatNumber(to.y)} L ${formatNumber(p1x)} ${formatNumber(p1y)} L ${formatNumber(p2x)} ${formatNumber(p2y)} Z`
}

function hexPoints(center: { x: number; y: number }, radius: number): string {
  const points: string[] = []
  for (let i = 0; i < 6; i += 1) {
    const angle = ((60 * i - 30) * Math.PI) / 180
    points.push(
      `${formatNumber(center.x + radius * Math.cos(angle))},${formatNumber(center.y + radius * Math.sin(angle) * BOARD_TILT)}`
    )
  }
  return points.join(' ')
}

function resolveAssetUrl(relativePath: string): string {
  const envBase = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  const normalizedBase = envBase.endsWith('/') ? envBase : `${envBase}/`
  const normalizedPath = relativePath.replace(/^\/+/, '')
  return `${normalizedBase}${normalizedPath}`
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString()
}
