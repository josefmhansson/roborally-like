import type {
  CardInstance,
  GameSettings,
  Order,
  Phase,
  PlayerId,
  Tile,
  Unit,
  UnitId,
} from '../../engine/types'

export type PlayerResourceCounts = {
  deck: number
  discard: number
  hand: number
  orders: number
}

export type PlayerView = {
  hand: CardInstance[] | null
  orders: Order[] | null
}

export type GameStateView = {
  boardRows: number
  boardCols: number
  tiles: Tile[]
  units: Record<UnitId, Unit>
  players: [PlayerView, PlayerView]
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

export type ViewMeta = {
  roomCode: string
  selfSeat: PlayerId
  paused: boolean
  reconnectDeadlineAt: number | null
  counts: [PlayerResourceCounts, PlayerResourceCounts]
}

export type PresenceState = {
  connected: [boolean, boolean]
  paused: boolean
  deadlineAt: number | null
}
