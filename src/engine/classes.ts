import { CARD_DEFS } from './cards'
import type { CardDefId, PlayerClassId, PlayerId } from './types'

export type PlayerClasses = {
  p1: PlayerClassId
  p2: PlayerClassId
}

export type PlayerClassDef = {
  id: PlayerClassId
  name: string
  color: string
  unitName: string
  unitBaseAsset: string
  unitTeamAsset: string
  commanderBaseAsset: string
  commanderTeamAsset: string
}

export const PLAYER_CLASS_IDS: PlayerClassId[] = ['commander', 'warleader', 'archmage']

export const PLAYER_CLASS_DEFS: Record<PlayerClassId, PlayerClassDef> = {
  commander: {
    id: 'commander',
    name: 'Commander',
    color: '#b13a2f',
    unitName: 'Soldier',
    unitBaseAsset: 'assets/units/unit_soldier_base.png',
    unitTeamAsset: 'assets/units/unit_soldier_team.png',
    commanderBaseAsset: 'assets/units/unit_commander_base.png',
    commanderTeamAsset: 'assets/units/unit_commander_team.png',
  },
  warleader: {
    id: 'warleader',
    name: 'Warleader',
    color: '#2f8f45',
    unitName: 'Warrior',
    unitBaseAsset: 'assets/units/unit_warrior_base.png',
    unitTeamAsset: 'assets/units/unit_warrior_team.png',
    commanderBaseAsset: 'assets/units/unit_warleader_base.png',
    commanderTeamAsset: 'assets/units/unit_warleader_team.png',
  },
  archmage: {
    id: 'archmage',
    name: 'Archmage',
    color: '#2f6fbf',
    unitName: 'Mage',
    unitBaseAsset: 'assets/units/unit_mage_base.png',
    unitTeamAsset: 'assets/units/unit_mage_team.png',
    commanderBaseAsset: 'assets/units/unit_archmage_base.png',
    commanderTeamAsset: 'assets/units/unit_archmage_team.png',
  },
}

export const DEFAULT_PLAYER_CLASSES: PlayerClasses = {
  p1: 'commander',
  p2: 'commander',
}

const ALL_CARD_IDS = Object.keys(CARD_DEFS) as CardDefId[]

export function isPlayerClassId(value: unknown): value is PlayerClassId {
  return value === 'commander' || value === 'warleader' || value === 'archmage'
}

export function getCardClassId(cardId: CardDefId): PlayerClassId | null {
  return CARD_DEFS[cardId].classId ?? null
}

export function isCardAllowedForClass(cardId: CardDefId, classId: PlayerClassId): boolean {
  const cardClassId = getCardClassId(cardId)
  return cardClassId === null || cardClassId === classId
}

export function getCardPoolForClass(classId: PlayerClassId): CardDefId[] {
  return ALL_CARD_IDS.filter((cardId) => isCardAllowedForClass(cardId, classId))
}

export function getPlayerClassForSeat(classes: PlayerClasses, seat: PlayerId): PlayerClassId {
  return seat === 0 ? classes.p1 : classes.p2
}

export function pickRandomPlayerClass(randomValue = Math.random()): PlayerClassId {
  const index = Math.floor(randomValue * PLAYER_CLASS_IDS.length)
  return PLAYER_CLASS_IDS[Math.max(0, Math.min(index, PLAYER_CLASS_IDS.length - 1))]
}
