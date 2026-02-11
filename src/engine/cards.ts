import type { CardDefId, CardEffect, CardType, Direction } from './types'
import { DIRECTION_NAMES } from './hex'

export type CardTargetRequirement = {
  unit?: 'friendly' | 'any'
  tile?: 'spawn' | 'any'
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
  requires: CardTargetRequirement
  actionCost?: number
  effects: CardEffect[]
}

export type { CardEffect }

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
    requires: { unit: 'friendly', moveDirection: true, faceDirection: true },
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
        directionParam: 'faceDirection',
      },
    ],
  },
  attack_line: {
    id: 'attack_line',
    name: 'Sweeping Line',
    description: 'Deal 1 damage to every tile in the forward direction.',
    type: 'attack',
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
  spell_lightning: {
    id: 'spell_lightning',
    name: 'Lightning',
    description: 'Deal 1 damage to any unit on the board.',
    type: 'spell',
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
}

export const STARTING_DECK: CardDefId[] = [
  'reinforce_spawn',
  'reinforce_boost',
  'reinforce_boost_spawn',
  'move_forward',
  'move_any',
  'move_forward_face',
  'attack_line',
  'attack_fwd_lr',
  'attack_fwd',
  'attack_arrow',
  'spell_lightning',
  'spell_meteor',
  'move_pivot',
  'spell_invest',
]

export const DIRECTION_LABELS: { label: string; value: Direction }[] = DIRECTION_NAMES.map((name, index) => ({
  label: name,
  value: index as Direction,
}))
