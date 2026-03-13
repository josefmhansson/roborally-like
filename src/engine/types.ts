export type PlayerId = 0 | 1

export type PlayerClassId = 'commander' | 'warleader' | 'archmage'

export type Hex = {
  q: number
  r: number
}

export type Direction = 0 | 1 | 2 | 3 | 4 | 5

export type UnitId = string

export type UnitKind = 'unit' | 'leader' | 'barricade'

export type RoguelikeUnitRole =
  | 'slime_grand'
  | 'slime_mid'
  | 'slime_small'
  | 'troll'
  | 'alpha_wolf'
  | 'wolf'
  | 'ice_spirit'
  | 'fire_spirit'
  | 'lightning_spirit'
  | 'bandit'
  | 'necromancer'
  | 'skeleton_soldier'
  | 'skeleton_warrior'
  | 'skeleton_mage'

export type RoguelikeEncounterId =
  | 'slimes'
  | 'trolls'
  | 'wolf_pack'
  | 'ice_spirits'
  | 'fire_spirits'
  | 'lightning_spirits'
  | 'bandits'
  | 'necromancer'

export type VictoryCondition = 'leader' | 'eliminate_units'

export type TrapKind = 'pitfall' | 'explosive'

export type TrapId = string

export type Trap = {
  id: TrapId
  owner: PlayerId
  kind: TrapKind
  pos: Hex
}

export type UnitModifierType =
  | 'cannotMove'
  | 'stunned'
  | 'slow'
  | 'chilled'
  | 'frozen'
  | 'spellResistance'
  | 'reinforcementPenalty'
  | 'burn'
  | 'regeneration'
  | 'disarmed'
  | 'vulnerable'
  | 'strong'
  | 'undying'
  | 'spikes'
  | 'berserk'
  | 'scalding'
  | 'lightningBarrier'

export type UnitModifierSource = 'commanderAura'

export type ModifierDuration = number | 'indefinite'

export type UnitModifier = {
  type: UnitModifierType
  turnsRemaining: ModifierDuration
  source?: UnitModifierSource
}

export type Unit = {
  id: UnitId
  owner: PlayerId
  kind: UnitKind
  strength: number
  pos: Hex
  facing: Direction
  modifiers: UnitModifier[]
  roguelikeRole?: RoguelikeUnitRole
  isMinion?: boolean
}

export type TileKind =
  | 'grassland'
  | 'meadow'
  | 'forest'
  | 'swamp'
  | 'hills'
  | 'mountain'
  | 'snow'
  | 'snow_hills'

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
  | 'reinforce_battlefield_recruitment'
  | 'reinforce_mass_boost'
  | 'reinforce_shrug_off'
  | 'reinforce_spikes'
  | 'reinforce_berserk'
  | 'reinforce_lightning_barrier'
  | 'move_forward'
  | 'move_any'
  | 'move_forward_face'
  | 'move_quickstep'
  | 'move_tandem'
  | 'move_double_steps'
  | 'move_converge'
  | 'move_dash'
  | 'move_teleport'
  | 'attack_line'
  | 'attack_chain_lightning'
  | 'attack_joint_attack'
  | 'attack_bash'
  | 'attack_ice_bolt'
  | 'attack_disarm'
  | 'attack_bleed'
  | 'attack_fwd_lr'
  | 'attack_fwd'
  | 'attack_arrow'
  | 'attack_fireball'
  | 'attack_pincer_attack'
  | 'attack_roundhouse_kick'
  | 'attack_volley'
  | 'attack_harpoon'
  | 'attack_execute'
  | 'attack_blade_dance'
  | 'attack_coordinated'
  | 'attack_charge'
  | 'attack_jab'
  | 'attack_shove'
  | 'attack_whirlwind'
  | 'attack_roguelike_basic'
  | 'attack_roguelike_slow'
  | 'attack_roguelike_stomp'
  | 'attack_roguelike_pack_hunt'
  | 'reinforce_roguelike_split'
  | 'reinforce_rage'
  | 'reinforce_bolster'
  | 'spell_lightning'
  | 'spell_petrify'
  | 'spell_brain_freeze'
  | 'spell_meteor'
  | 'spell_blizzard'
  | 'spell_invest'
  | 'spell_trip'
  | 'spell_snare'
  | 'spell_dispel'
  | 'spell_pitfall_trap'
  | 'spell_explosive_trap'
  | 'spell_divination'
  | 'spell_burn'
  | 'spell_roguelike_mark'
  | 'spell_roguelike_raise'
  | 'spell_roguelike_thunderstorm'
  | 'move_pivot'

export type EffectRef = 'unitId' | 'direction' | 'distance' | 'tile' | 'tile2' | 'tile3'

export type DirectionSource =
  | 'facing'
  | { type: 'param'; key: 'direction' | 'moveDirection' | 'faceDirection' }
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
      type: 'placeTrap'
      trapKind: TrapKind
      tileParam: 'tile'
    }
  | {
      type: 'spawnAdjacentFriendly'
      tileParam: 'tile'
      strength: number
      facingParam?: 'direction'
      mapToOrder?: boolean
    }
  | {
      type: 'boostAllFriendly'
      amount: number
    }
  | {
      type: 'teamAttackForward'
      damage: number
    }
  | {
      type: 'harpoon'
      unitParam: 'unitId'
      damage: number
    }
  | {
      type: 'executeForward'
      unitParam: 'unitId'
      leaderDamage: number
    }
  | {
      type: 'damageAdjacent'
      unitParam: 'unitId'
      amount: number
    }
  | {
      type: 'stunAdjacent'
      unitParam: 'unitId'
      turns: ModifierDuration
    }
  | {
      type: 'chainLightning'
      unitParam: 'unitId'
      damage: number
    }
  | {
      type: 'chainLightningAllFriendly'
      damage: number
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
      type: 'clearUnitDebuffs'
      unitParam: 'unitId'
    }
  | {
      type: 'applyPlayerModifier'
      modifier: 'extraDraw' | 'brainFreeze'
      amount: number
      turns: ModifierDuration
      target?: 'self' | 'opponent'
    }
  | {
      type: 'move'
      unitParam: 'unitId'
      direction: DirectionSource
      distance: number | { type: 'param'; key: 'distance' }
    }
  | {
      type: 'splitUnit'
      unitParam: 'unitId'
    }
  | {
      type: 'moveToTile'
      unitParam: 'unitId' | 'unitId2'
      tileParam: 'tile' | 'tile2'
      faceMovedDirection?: boolean
    }
  | {
      type: 'spawnSkeletonAdjacent'
      unitParam: 'unitId'
      tileParam: 'tile'
      strength: number
    }
  | {
      type: 'teleport'
      unitParam: 'unitId'
      tileParam: 'tile'
      maxDistance: number
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
      maxRange?: number
    }
  | {
      type: 'attackModifier'
      unitParam: 'unitId'
      mode: 'nearest' | 'line' | 'ray'
      directions: DirectionSource
      modifier: UnitModifierType
      turns: ModifierDuration
      maxRange?: number
    }
  | {
      type: 'shove'
      unitParam: 'unitId'
      direction: DirectionSource
      distance: number
      collisionDamage: number
      impactDamage?: number
    }
  | {
      type: 'whirlwind'
      unitParam: 'unitId'
      damage: number
      pushDistance: number
    }
  | {
      type: 'moveAdjacentFriendlyGroup'
      unitParam: 'unitId'
      direction: DirectionSource
      distance: number | { type: 'param'; key: 'distance' }
    }
  | {
      type: 'packHunt'
      unitParam: 'unitId'
      moveDistance: number
      damagePerAdjacent: number
    }
  | {
      type: 'lineSplash'
      unitParam: 'unitId'
      directions: DirectionSource
      damage: number
      splashRadius: number
      maxRange?: number
    }
  | {
      type: 'jointAttack'
      unitParam: 'unitId'
      tileParam: 'tile'
      damagePerAdjacentAlly: number
    }
  | {
      type: 'pincerAttack'
      damage: number
    }
  | {
      type: 'volley'
      unitParam: 'unitId'
      tileParam: 'tile'
      radius: number
      damage: number
    }
  | {
      type: 'markAdvanceToward'
      targetUnitParam: 'unitId'
      distance: number
    }
  | {
      type: 'convergeTowardTile'
      tileParam: 'tile'
      distance: number
      faceMovedDirection?: boolean
    }
  | {
      type: 'damageRadius'
      tileParam: 'tile'
      radius: number
      amount: number
      modifier?: UnitModifierType
      turns?: ModifierDuration
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
  tile3?: Hex
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

export type PlayerModifierType = 'extraDraw' | 'brainFreeze'

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
  traps: Trap[]
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
  playerClasses?: [PlayerClassId | null, PlayerClassId | null]
  leaderMovedLastTurn?: [boolean, boolean]
  turnStartLeaderPositions?: [Hex, Hex]
  archmageBonusApplied?: [number, number]
}

export type GameSettings = {
  boardRows: number
  boardCols: number
  leaderStrength: number
  deckSize: number
  drawPerTurn: number
  maxCopies: number
  actionBudgetP1: number
  actionBudgetP2: number
  randomizeFirstPlayer?: boolean
  victoryCondition?: VictoryCondition
  roguelikeMatchNumber?: number
  roguelikeEncounterId?: RoguelikeEncounterId
}
