import type { CardDefId, GameSettings, OrderParams, PlayerId } from '../../engine/types'
import type { GameStateView, PresenceState, ViewMeta } from './view'

export type RoomSetup = {
  settings: GameSettings
  loadouts: { p1: CardDefId[]; p2: CardDefId[] }
}

export type QueueOrderCommand = {
  type: 'queue_order'
  cardId: string
  params: OrderParams
}

export type RemoveOrderCommand = {
  type: 'remove_order'
  orderId: string
}

export type ReorderOrderCommand = {
  type: 'reorder_order'
  fromOrderId: string
  toOrderId: string
}

export type ReadyCommand = {
  type: 'ready'
}

export type ClientGameCommand = QueueOrderCommand | RemoveOrderCommand | ReorderOrderCommand | ReadyCommand

export type CreateRoomMessage = {
  type: 'create_room'
  setup?: RoomSetup
}

export type JoinRoomMessage = {
  type: 'join_room'
  roomCode: string
  seatToken: string
}

export type CommandMessage = {
  type: 'command'
  cmdId: string
  command: ClientGameCommand
}

export type ClientMessage = CreateRoomMessage | JoinRoomMessage | CommandMessage

export type RoomCreatedMessage = {
  type: 'room_created'
  roomCode: string
  seat: PlayerId
  seatToken: string
  inviteLinks: {
    seat0: string
    seat1: string
  }
}

export type JoinedMessage = {
  type: 'joined'
  roomCode: string
  seat: PlayerId
}

export type SnapshotMessage = {
  type: 'snapshot'
  stateView: GameStateView
  viewMeta: ViewMeta
  presence: PresenceState
  serverTime: number
}

export type ResolutionBundleMessage = {
  type: 'resolution_bundle'
  actionStartStateView: GameStateView
  actionStartViewMeta: ViewMeta
  finalStateView: GameStateView
  finalViewMeta: ViewMeta
  presence: PresenceState
  serverTime: number
}

export type CommandResultMessage = {
  type: 'command_result'
  cmdId: string
  ok: boolean
  errorCode?: string
  message?: string
}

export type PresenceUpdateMessage = {
  type: 'presence_update'
  connected: [boolean, boolean]
  paused: boolean
  deadlineAt: number | null
}

export type MatchEndMessage = {
  type: 'match_end'
  winner: PlayerId | null
  reason: string
}

export type ErrorMessage = {
  type: 'error'
  code: string
  message: string
}

export type ServerMessage =
  | RoomCreatedMessage
  | JoinedMessage
  | SnapshotMessage
  | ResolutionBundleMessage
  | CommandResultMessage
  | PresenceUpdateMessage
  | MatchEndMessage
  | ErrorMessage
