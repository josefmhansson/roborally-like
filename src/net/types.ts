import type { PlayerId } from '../engine/types'
import type { PresenceState, ViewMeta } from '../shared/net/view'

export type PlayMode = 'local' | 'online'

export type OnlineSessionState = {
  roomCode: string
  seat: PlayerId
  seatToken: string
  connected: boolean
  presence: PresenceState
  viewMeta: ViewMeta | null
}
