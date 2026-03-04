import type { CardDefId, CardEffect, CardType, Direction, PlayerClassId } from './types'
import { DIRECTION_NAMES } from './hex'

export type CardTargetRequirement = {
  unit?: 'friendly' | 'enemy' | 'any'
  tile?: 'spawn' | 'any' | 'barricade'
  tile2?: 'barricade' | 'any'
  tile3?: 'any'
  direction?: boolean
  moveDirection?: boolean
  faceDirection?: boolean
  distanceOptions?: number[]
}

export type CardDef = {
  id: CardDefId
  name: string
  description: string
  type: CardType
  countsAs?: CardType[]
  classId?: PlayerClassId
  roguelikeOnly?: boolean
  requires: CardTargetRequirement
  keywords?: CardKeyword[]
  canTargetBarricades?: boolean
  actionCost?: number
  effects: CardEffect[]
}

export type CardKeyword = 'Priority' | 'Slow'

export type { CardEffect }
type CardTypeSource = CardDefId | Pick<CardDef, 'type' | 'countsAs'>

export const CARD_DEFS: Record<CardDefId, CardDef> = {
  reinforce_spawn: {
    id: 'reinforce_spawn',
    name: 'Recruit',
    description: 'Add a 1-strength unit to a spawning tile facing any direction.',
    type: 'reinforcement',
    requires: { tile: 'spawn', direction: true },
    effects: [
      {
        type: 'spawn',
        strength: 1,
        tileParam: 'tile',
        facingParam: 'direction',
        mapToOrder: true,
      },
    ],
  },
  reinforce_boost: {
    id: 'reinforce_boost',
    name: 'Boost',
    description: 'Add 1 strength to up to two different units.',
    type: 'reinforcement',
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'boost',
        amount: 1,
        unitParam: 'unitId',
      },
      {
        type: 'boost',
        amount: 1,
        unitParam: 'unitId2',
      },
    ],
  },
  reinforce_boost_spawn: {
    id: 'reinforce_boost_spawn',
    name: 'Train',
    description: 'Add 3 strength to an existing unit on a spawning tile.',
    type: 'reinforcement',
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'boost',
        amount: 3,
        unitParam: 'unitId',
        requireSpawnTile: true,
      },
    ],
  },
  reinforce_barricade: {
    id: 'reinforce_barricade',
    name: 'Barricade',
    description: 'Spawns 2 1-strength barricades adjacent to an existing unit or building.',
    type: 'reinforcement',
    classId: 'commander',
    requires: { tile: 'barricade', tile2: 'barricade' },
    effects: [
      {
        type: 'spawn',
        kind: 'barricade',
        strength: 1,
        tileParam: 'tile',
        facing: 0,
        mapToOrder: true,
      },
      {
        type: 'spawn',
        kind: 'barricade',
        strength: 1,
        tileParam: 'tile2',
        facing: 0,
        mapToOrder: true,
      },
    ],
  },
  reinforce_quick_boost: {
    id: 'reinforce_quick_boost',
    name: 'Quick Boost',
    description: 'Increase a unit strength by 1.',
    type: 'reinforcement',
    keywords: ['Priority'],
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'boost',
        amount: 1,
        unitParam: 'unitId',
      },
    ],
  },
  reinforce_rage: {
    id: 'reinforce_rage',
    name: 'Rage',
    description: 'Give a unit Vulnerable and Strong indefinitely.',
    type: 'reinforcement',
    classId: 'warleader',
    actionCost: 0,
    requires: { unit: 'friendly' },
    canTargetBarricades: false,
    effects: [
      {
        type: 'applyUnitModifier',
        unitParam: 'unitId',
        modifier: 'vulnerable',
        turns: 'indefinite',
      },
      {
        type: 'applyUnitModifier',
        unitParam: 'unitId',
        modifier: 'strong',
        turns: 'indefinite',
      },
    ],
  },
  reinforce_bolster: {
    id: 'reinforce_bolster',
    name: 'Bolster',
    description: 'Give a unit Strong this turn.',
    type: 'reinforcement',
    actionCost: 0,
    requires: { unit: 'friendly' },
    canTargetBarricades: false,
    effects: [
      {
        type: 'applyUnitModifier',
        unitParam: 'unitId',
        modifier: 'strong',
        turns: 1,
      },
    ],
  },
  reinforce_battlefield_recruitment: {
    id: 'reinforce_battlefield_recruitment',
    name: 'Battlefield Recruitment',
    description: 'Spawn a 1-strength unit adjacent to a friendly unit, facing a chosen direction.',
    type: 'reinforcement',
    classId: 'commander',
    requires: { tile: 'barricade', direction: true },
    effects: [
      {
        type: 'spawnAdjacentFriendly',
        tileParam: 'tile',
        strength: 1,
        facingParam: 'direction',
        mapToOrder: true,
      },
    ],
  },
  reinforce_mass_boost: {
    id: 'reinforce_mass_boost',
    name: 'Mass Boost',
    description: 'All friendly units gain +2 strength.',
    type: 'reinforcement',
    classId: 'commander',
    actionCost: 2,
    requires: {},
    effects: [
      {
        type: 'boostAllFriendly',
        amount: 2,
      },
    ],
  },
  move_forward: {
    id: 'move_forward',
    name: 'Advance',
    description: 'Move up to 5 steps in any direction, facing that direction.',
    type: 'movement',
    requires: { unit: 'friendly', distanceOptions: [1, 2, 3, 4, 5] },
    effects: [
      {
        type: 'move',
        unitParam: 'unitId',
        direction: { type: 'param', key: 'direction' },
        distance: { type: 'param', key: 'distance' },
      },
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
    ],
  },
  move_any: {
    id: 'move_any',
    name: 'Strafe',
    description: 'Move 1, 2, or 3 steps in any direction.',
    type: 'movement',
    requires: { unit: 'friendly', distanceOptions: [1, 2, 3] },
    effects: [
      {
        type: 'move',
        unitParam: 'unitId',
        direction: { type: 'param', key: 'direction' },
        distance: { type: 'param', key: 'distance' },
      },
    ],
  },
  move_forward_face: {
    id: 'move_forward_face',
    name: 'Step',
    description: 'Move 1 step in any direction, then face any direction.',
    type: 'movement',
    requires: { unit: 'friendly', tile: 'any', direction: true },
    effects: [
      {
        type: 'move',
        unitParam: 'unitId',
        direction: { type: 'param', key: 'moveDirection' },
        distance: 1,
      },
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
    ],
  },
  move_quickstep: {
    id: 'move_quickstep',
    name: 'Quickstep',
    description: 'Take one step in the forward direction.',
    type: 'movement',
    keywords: ['Priority'],
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'move',
        unitParam: 'unitId',
        direction: 'facing',
        distance: 1,
      },
    ],
  },
  move_tandem: {
    id: 'move_tandem',
    name: 'Tandem Movement',
    description: 'A unit and all adjacent friendly units move up to 3 tiles in one direction.',
    type: 'movement',
    classId: 'commander',
    requires: { unit: 'friendly', direction: true, distanceOptions: [1, 2, 3] },
    effects: [
      {
        type: 'move',
        unitParam: 'unitId',
        direction: { type: 'param', key: 'direction' },
        distance: { type: 'param', key: 'distance' },
      },
      {
        type: 'moveAdjacentFriendlyGroup',
        unitParam: 'unitId',
        direction: { type: 'param', key: 'direction' },
        distance: { type: 'param', key: 'distance' },
      },
    ],
  },
  move_teleport: {
    id: 'move_teleport',
    name: 'Teleport',
    description: 'Teleport to any unoccupied tile within 3 tiles. Does not move through intermediate tiles.',
    type: 'movement',
    classId: 'archmage',
    actionCost: 2,
    keywords: ['Priority'],
    requires: { unit: 'friendly', tile: 'any' },
    effects: [
      {
        type: 'teleport',
        unitParam: 'unitId',
        tileParam: 'tile',
        maxDistance: 3,
      },
    ],
  },
  attack_line: {
    id: 'attack_line',
    name: 'Death Ray',
    description: 'Fire a death ray forward, dealing 1 damage to every unit in line.',
    type: 'attack',
    classId: 'archmage',
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'ray',
        directions: 'facing',
        damage: 1,
      },
    ],
  },
  attack_chain_lightning: {
    id: 'attack_chain_lightning',
    name: 'Chain Lightning',
    description:
      'Deal 1 damage to a random adjacent unit, then jump to random adjacent units until no new targets remain.',
    type: 'attack',
    classId: 'archmage',
    actionCost: 1,
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'chainLightning',
        unitParam: 'unitId',
        damage: 1,
      },
    ],
  },
  attack_disarm: {
    id: 'attack_disarm',
    name: 'Disarm',
    description: 'Deal 1 damage to an adjacent tile and inflict Disarmed for 2 turns.',
    type: 'attack',
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: 'facing',
        damage: 1,
      },
      {
        type: 'attackModifier',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: 'facing',
        modifier: 'disarmed',
        turns: 2,
      },
    ],
  },
  attack_bleed: {
    id: 'attack_bleed',
    name: 'Bleed',
    description: 'Deal 1 damage to an adjacent tile and inflict Vulnerable for 2 turns.',
    type: 'attack',
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: 'facing',
        damage: 1,
      },
      {
        type: 'attackModifier',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: 'facing',
        modifier: 'vulnerable',
        turns: 2,
      },
    ],
  },
  attack_fwd_lr: {
    id: 'attack_fwd_lr',
    name: 'Cleave',
    description: 'Deal 2 damage to the nearest tile in the forward, left and right directions.',
    type: 'attack',
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: { type: 'relative', offsets: [0, -1, 1] },
        damage: 2,
      },
    ],
  },
  attack_fwd: {
    id: 'attack_fwd',
    name: 'Strike',
    description: 'Face any direction, then deal damage equal to unit strength to the nearest tile.',
    type: 'attack',
    actionCost: 2,
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: 'facing',
        damage: { type: 'unitStrength' },
      },
    ],
  },
  attack_arrow: {
    id: 'attack_arrow',
    name: 'Arrow',
    description: 'Deal 2 damage to the nearest unit in the facing direction.',
    type: 'attack',
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'line',
        directions: 'facing',
        damage: 2,
      },
    ],
  },
  attack_harpoon: {
    id: 'attack_harpoon',
    name: 'Harpoon',
    description: 'Deal 1 damage to the first unit forward, then pull it toward you.',
    type: 'attack',
    classId: 'warleader',
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'harpoon',
        unitParam: 'unitId',
        damage: 1,
      },
    ],
  },
  attack_execute: {
    id: 'attack_execute',
    name: 'Execute',
    description: 'Destroy a non-leader unit in front. Leaders take 3 damage instead.',
    type: 'attack',
    classId: 'warleader',
    actionCost: 2,
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'executeForward',
        unitParam: 'unitId',
        leaderDamage: 3,
      },
    ],
  },
  attack_blade_dance: {
    id: 'attack_blade_dance',
    name: 'Blade Dance',
    description: 'Chain 3 moves: each move 1 tile, then deal 1 to all adjacent units.',
    type: 'attack',
    countsAs: ['movement'],
    classId: 'warleader',
    actionCost: 3,
    requires: { unit: 'friendly', tile: 'any', tile2: 'any', tile3: 'any' },
    effects: [
      {
        type: 'move',
        unitParam: 'unitId',
        direction: { type: 'param', key: 'direction' },
        distance: 1,
      },
      {
        type: 'damageAdjacent',
        unitParam: 'unitId',
        amount: 1,
      },
      {
        type: 'move',
        unitParam: 'unitId',
        direction: { type: 'param', key: 'moveDirection' },
        distance: 1,
      },
      {
        type: 'damageAdjacent',
        unitParam: 'unitId',
        amount: 1,
      },
      {
        type: 'move',
        unitParam: 'unitId',
        direction: { type: 'param', key: 'faceDirection' },
        distance: 1,
      },
      {
        type: 'damageAdjacent',
        unitParam: 'unitId',
        amount: 1,
      },
    ],
  },
  attack_charge: {
    id: 'attack_charge',
    name: 'Charge',
    description: 'Face a direction, move up to 5 tiles, then deal 2 damage to the tile in front.',
    type: 'attack',
    countsAs: ['movement'],
    classId: 'warleader',
    actionCost: 2,
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
      {
        type: 'move',
        unitParam: 'unitId',
        direction: { type: 'param', key: 'direction' },
        distance: 5,
      },
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: 'facing',
        damage: 2,
      },
    ],
  },
  attack_jab: {
    id: 'attack_jab',
    name: 'Jab',
    description: 'Face a direction, then deal 2 damage to an adjacent unit.',
    type: 'attack',
    keywords: ['Priority'],
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: 'facing',
        damage: 2,
      },
    ],
  },
  attack_shove: {
    id: 'attack_shove',
    name: 'Shove',
    description: 'Push an adjacent unit backwards 1 tile. If occupied, deal 3 damage to both.',
    type: 'attack',
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
      {
        type: 'shove',
        unitParam: 'unitId',
        direction: 'facing',
        distance: 1,
        collisionDamage: 3,
      },
    ],
  },
  attack_whirlwind: {
    id: 'attack_whirlwind',
    name: 'Whirlwind',
    description: 'Deal 3 damage to surrounding units and push them back 1 tile if possible.',
    type: 'attack',
    classId: 'warleader',
    actionCost: 2,
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'whirlwind',
        unitParam: 'unitId',
        damage: 3,
        pushDistance: 1,
      },
    ],
  },
  attack_coordinated: {
    id: 'attack_coordinated',
    name: 'Coordinated Attack',
    description: 'All friendly units deal 2 damage to the tile in front of them.',
    type: 'attack',
    classId: 'commander',
    actionCost: 2,
    requires: {},
    effects: [
      {
        type: 'teamAttackForward',
        damage: 2,
      },
    ],
  },
  attack_roguelike_basic: {
    id: 'attack_roguelike_basic',
    name: 'Attack',
    description: 'Face a direction, then deal damage to an adjacent unit.',
    type: 'attack',
    roguelikeOnly: true,
    actionCost: 1,
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: 'facing',
        damage: 1,
      },
    ],
  },
  attack_roguelike_slow: {
    id: 'attack_roguelike_slow',
    name: 'Slow Attack',
    description: 'Face a direction, then deal heavy damage to an adjacent unit.',
    type: 'attack',
    roguelikeOnly: true,
    actionCost: 1,
    keywords: ['Slow'],
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
      {
        type: 'attack',
        unitParam: 'unitId',
        mode: 'nearest',
        directions: 'facing',
        damage: 5,
      },
    ],
  },
  attack_roguelike_stomp: {
    id: 'attack_roguelike_stomp',
    name: 'Stomp',
    description: 'Deal 1 damage and Stun all adjacent units for the rest of the turn.',
    type: 'attack',
    roguelikeOnly: true,
    actionCost: 1,
    requires: { unit: 'friendly' },
    effects: [
      {
        type: 'damageAdjacent',
        unitParam: 'unitId',
        amount: 1,
      },
      {
        type: 'stunAdjacent',
        unitParam: 'unitId',
        turns: 1,
      },
    ],
  },
  attack_roguelike_pack_hunt: {
    id: 'attack_roguelike_pack_hunt',
    name: 'Pack Hunt',
    description:
      'Move 1 tile in any direction, then attack the tile in front for each allied unit adjacent to that tile.',
    type: 'attack',
    countsAs: ['movement'],
    roguelikeOnly: true,
    actionCost: 1,
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'packHunt',
        unitParam: 'unitId',
        moveDistance: 1,
        damagePerAdjacent: 2,
      },
    ],
  },
  spell_roguelike_mark: {
    id: 'spell_roguelike_mark',
    name: 'Mark',
    description: 'Target an enemy unit. All allied units move 1 tile toward it.',
    type: 'spell',
    countsAs: ['movement'],
    roguelikeOnly: true,
    actionCost: 1,
    requires: { unit: 'enemy' },
    effects: [
      {
        type: 'markAdvanceToward',
        targetUnitParam: 'unitId',
        distance: 1,
      },
    ],
  },
  spell_pitfall_trap: {
    id: 'spell_pitfall_trap',
    name: 'Pitfall Trap',
    description:
      'Place a hidden pitfall trap adjacent to a friendly unit. Trigger: 2 damage and Snare for 2 turns; movement stops.',
    type: 'spell',
    classId: 'commander',
    requires: { tile: 'barricade' },
    effects: [
      {
        type: 'placeTrap',
        trapKind: 'pitfall',
        tileParam: 'tile',
      },
    ],
  },
  spell_explosive_trap: {
    id: 'spell_explosive_trap',
    name: 'Explosive Trap',
    description:
      'Place a hidden explosive trap adjacent to a friendly unit. Trigger: 3 damage; does not stop movement.',
    type: 'spell',
    classId: 'commander',
    requires: { tile: 'barricade' },
    effects: [
      {
        type: 'placeTrap',
        trapKind: 'explosive',
        tileParam: 'tile',
      },
    ],
  },
  spell_lightning: {
    id: 'spell_lightning',
    name: 'Lightning',
    description: 'Deal 1 damage to any unit on the board.',
    type: 'spell',
    classId: 'archmage',
    requires: { unit: 'any' },
    effects: [
      {
        type: 'damage',
        amount: 1,
        unitParam: 'unitId',
      },
    ],
  },
  spell_meteor: {
    id: 'spell_meteor',
    name: 'Meteor',
    description: 'Deal 5 damage to a chosen tile and 1 damage to adjacent tiles (units only).',
    type: 'spell',
    classId: 'archmage',
    actionCost: 3,
    requires: { tile: 'any' },
    effects: [
      {
        type: 'damageTileArea',
        centerAmount: 5,
        splashAmount: 1,
        tileParam: 'tile',
      },
    ],
  },
  move_pivot: {
    id: 'move_pivot',
    name: 'Pivot',
    description: 'Change a unit’s facing to any direction.',
    type: 'movement',
    actionCost: 0,
    requires: { unit: 'friendly', direction: true },
    effects: [
      {
        type: 'face',
        unitParam: 'unitId',
        directionParam: 'direction',
      },
    ],
  },
  spell_invest: {
    id: 'spell_invest',
    name: 'Invest',
    description: 'Permanently increase your action budget by 1.',
    type: 'spell',
    actionCost: 2,
    requires: {},
    effects: [
      {
        type: 'budget',
        amount: 1,
      },
    ],
  },
  spell_trip: {
    id: 'spell_trip',
    name: 'Trip',
    description: "Target unit can't move for 2 turns.",
    type: 'spell',
    actionCost: 0,
    requires: { unit: 'any' },
    effects: [
      {
        type: 'applyUnitModifier',
        unitParam: 'unitId',
        modifier: 'cannotMove',
        turns: 2,
      },
    ],
  },
  spell_snare: {
    id: 'spell_snare',
    name: 'Snare',
    description: "Target unit can't move for 4 turns.",
    type: 'spell',
    requires: { unit: 'any' },
    effects: [
      {
        type: 'applyUnitModifier',
        unitParam: 'unitId',
        modifier: 'cannotMove',
        turns: 4,
      },
    ],
  },
  spell_dispel: {
    id: 'spell_dispel',
    name: 'Dispel',
    description: 'Remove all buffs and debuffs from a target unit.',
    type: 'spell',
    requires: { unit: 'any' },
    canTargetBarricades: true,
    effects: [
      {
        type: 'clearUnitModifiers',
        unitParam: 'unitId',
      },
    ],
  },
  spell_divination: {
    id: 'spell_divination',
    name: 'Divination',
    description: 'Draw 3 extra cards next turn.',
    type: 'spell',
    classId: 'archmage',
    requires: {},
    effects: [
      {
        type: 'applyPlayerModifier',
        modifier: 'extraDraw',
        amount: 3,
        turns: 1,
      },
    ],
  },
  spell_burn: {
    id: 'spell_burn',
    name: 'Burn',
    description: 'Apply Burn to a unit (stackable; deals 1 damage per stack at end of each turn).',
    type: 'spell',
    requires: { unit: 'any' },
    effects: [
      {
        type: 'applyUnitModifier',
        unitParam: 'unitId',
        modifier: 'burn',
        turns: 'indefinite',
      },
    ],
  },
}

export function getCardTypes(defOrId: CardTypeSource): CardType[] {
  const def = typeof defOrId === 'string' ? CARD_DEFS[defOrId] : defOrId
  const combined = [def.type, ...(def.countsAs ?? [])]
  return combined.filter((type, index) => combined.indexOf(type) === index)
}

export function cardCountsAsType(defOrId: CardTypeSource, type: CardType): boolean {
  return getCardTypes(defOrId).includes(type)
}

export const STARTING_DECK: CardDefId[] = [
  'reinforce_spawn',
  'reinforce_boost',
  'reinforce_boost_spawn',
  'reinforce_quick_boost',
  'reinforce_bolster',
  'move_forward',
  'move_any',
  'move_forward_face',
  'move_quickstep',
  'move_pivot',
  'attack_disarm',
  'attack_bleed',
  'attack_fwd_lr',
  'attack_fwd',
  'attack_arrow',
  'attack_jab',
  'attack_shove',
  'spell_invest',
  'spell_trip',
  'spell_snare',
  'spell_dispel',
  'spell_burn',
]

export const DIRECTION_LABELS: { label: string; value: Direction }[] = DIRECTION_NAMES.map((name, index) => ({
  label: name,
  value: index as Direction,
}))
