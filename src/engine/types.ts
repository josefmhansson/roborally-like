export type PlayerId = 0 | 1

export type Hex = {
  q: number
  r: number
}

export type Direction = 0 | 1 | 2 | 3 | 4 | 5

export type UnitId = string

export type UnitKind = 'unit' | 'stronghold' | 'barricade'

export type UnitModifierType = 'cannotMove' | 'burn' | 'disarmed' | 'vulnerable' | 'strong'

export type ModifierDuration = number | 'indefinite'

export type UnitModifier = {
  type: UnitModifierType
  turnsRemaining: ModifierDuration
}

export type Unit = {
  id: UnitId
  owner: PlayerId
  kind: UnitKind
  strength: number
  pos: Hex
  facing: Direction
  modifiers: UnitModifier[]
}

export type TileKind = 'grass' | 'forest' | 'mountain' | 'pond' | 'rocky' | 'rough' | 'shrub'

export type Tile = {
  id: string
  q: number
  r: number
  kind: TileKind
}

export type Phase = 'planning' | 'action'

export type CardType = 'reinforcement' | 'movement' | 'attack' | 'spell'

export type CardDefId =
  | 'reinforce_spawn'
  | 'reinforce_boost'
  | 'reinforce_boost_spawn'
  | 'reinforce_barricade'
  | 'reinforce_quick_boost'
  | 'move_forward'
  | 'move_any'
  | 'move_forward_face'
  | 'move_quickstep'
  | 'attack_line'
  | 'attack_disarm'
  | 'attack_bleed'
  | 'attack_fwd_lr'
  | 'attack_fwd'
  | 'attack_arrow'
  | 'attack_charge'
  | 'attack_jab'
  | 'attack_shove'
  | 'attack_whirlwind'
  | 'reinforce_rage'
  | 'reinforce_bolster'
  | 'spell_lightning'
  | 'spell_meteor'
  | 'spell_invest'
  | 'spell_trip'
  | 'spell_snare'
  | 'spell_dispel'
  | 'spell_divination'
  | 'spell_burn'
  | 'move_pivot'

export type EffectRef = 'unitId' | 'direction' | 'distance' | 'tile' | 'tile2'

export type DirectionSource =
  | 'facing'
  | { type: 'param'; key: 'direction' | 'moveDirection' }
  | { type: 'relative'; offsets: number[] }

export type CardEffect =
  | {
      type: 'spawn'
      kind?: 'unit' | 'barricade'
      strength: number
      tileParam: 'tile' | 'tile2'
      facingParam?: 'direction'
      facing?: Direction
      mapToOrder?: boolean
    }
  | {
      type: 'boost'
      amount: number
      unitParam: 'unitId' | 'unitId2'
      requireSpawnTile?: boolean
    }
  | {
      type: 'damage'
      amount: number
      unitParam: 'unitId'
    }
  | {
      type: 'damageTile'
      amount: number
      tileParam: 'tile'
    }
  | {
      type: 'damageTileArea'
      centerAmount: number
      splashAmount: number
      tileParam: 'tile'
    }
  | {
      type: 'budget'
      amount: number
    }
  | {
      type: 'applyUnitModifier'
      unitParam: 'unitId'
      modifier: UnitModifierType
      turns: ModifierDuration
    }
  | {
      type: 'clearUnitModifiers'
      unitParam: 'unitId'
    }
  | {
      type: 'applyPlayerModifier'
      modifier: 'extraDraw'
      amount: number
      turns: ModifierDuration
    }
  | {
      type: 'move'
      unitParam: 'unitId'
      direction: DirectionSource
      distance: number | { type: 'param'; key: 'distance' }
    }
  | {
      type: 'face'
      unitParam: 'unitId'
      directionParam: 'direction' | 'faceDirection'
    }
  | {
      type: 'attack'
      unitParam: 'unitId'
      mode: 'nearest' | 'line' | 'ray'
      directions: DirectionSource
      damage: number | { type: 'unitStrength' }
    }
  | {
      type: 'attackModifier'
      unitParam: 'unitId'
      mode: 'nearest' | 'line' | 'ray'
      directions: DirectionSource
      modifier: UnitModifierType
      turns: ModifierDuration
    }
  | {
      type: 'shove'
      unitParam: 'unitId'
      direction: DirectionSource
      distance: number
      collisionDamage: number
    }
  | {
      type: 'whirlwind'
      unitParam: 'unitId'
      damage: number
      pushDistance: number
    }

export type CardInstance = {
  id: string
  defId: CardDefId
}

export type OrderParams = {
  unitId?: UnitId
  unitId2?: UnitId
  tile?: Hex
  tile2?: Hex
  direction?: Direction
  moveDirection?: Direction
  faceDirection?: Direction
  distance?: number
}

export type Order = {
  id: string
  player: PlayerId
  cardId: string
  defId: CardDefId
  params: OrderParams
}

export type PlayerState = {
  deck: CardInstance[]
  hand: CardInstance[]
  discard: CardInstance[]
  orders: Order[]
  modifiers: PlayerModifier[]
}

export type PlayerModifierType = 'extraDraw'

export type PlayerModifier = {
  type: PlayerModifierType
  amount: number
  turnsRemaining: ModifierDuration
}

export type GameState = {
  boardRows: number
  boardCols: number
  tiles: Tile[]
  units: Record<UnitId, Unit>
  players: [PlayerState, PlayerState]
  ready: [boolean, boolean]
  actionBudgets: [number, number]
  activePlayer: PlayerId
  phase: Phase
  actionQueue: Order[]
  actionIndex: number
  turn: number
  nextUnitId: number
  nextOrderId: number
  log: string[]
  winner: PlayerId | null
  spawnedByOrder: Record<string, UnitId>
  settings: GameSettings
}

export type GameSettings = {
  boardRows: number
  boardCols: number
  strongholdStrength: number
  deckSize: number
  drawPerTurn: number
  maxCopies: number
  actionBudgetP1: number
  actionBudgetP2: number
}
