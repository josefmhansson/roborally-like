import { planOrder, resolveAllActions, startActionPhase } from '../src/engine/game'
import { cloneGameState } from '../src/engine/clone'
import type { Direction, GameState, OrderParams, PlayerId } from '../src/engine/types'
import type { ClientGameCommand } from '../src/shared/net/protocol'
import type { Room } from './roomManager'
import {
  canRoomUpdateLoadout,
  recordRoomUnplayedHandCards,
  requestRoomRematch,
  updateRoomSeatLoadout,
} from './roomManager'

type ResolutionReplayPayload = {
  actionStartState: GameState
  finalState: GameState
}

export type CommandApplyResult =
  | { ok: true; message?: string; resolutionReplay?: ResolutionReplayPayload }
  | { ok: false; errorCode: string; message: string }

export function applyRoomCommand(room: Room, seat: PlayerId, command: ClientGameCommand): CommandApplyResult {
  if (room.paused) {
    return { ok: false, errorCode: 'room_paused', message: 'Match is paused while waiting for reconnect.' }
  }

  switch (command.type) {
    case 'update_loadout': {
      if (!canRoomUpdateLoadout(room)) {
        return {
          ok: false,
          errorCode: 'loadout_locked',
          message: 'Loadout can only be changed before match start or after match end.',
        }
      }
      updateRoomSeatLoadout(room, seat, command.loadout, command.playerClass)
      return { ok: true, message: 'Loadout updated.' }
    }
    case 'rematch': {
      if (!(room.ended || room.state.winner !== null)) {
        return {
          ok: false,
          errorCode: 'match_not_ended',
          message: 'Rematch is only available after match end.',
        }
      }
      const rematch = requestRoomRematch(room, seat)
      if (rematch.started) {
        return { ok: true, message: 'Rematch started.' }
      }
      return { ok: true, message: 'Rematch requested. Waiting for opponent.' }
    }
    case 'queue_order': {
      if (room.ended || room.state.winner !== null) {
        return { ok: false, errorCode: 'match_ended', message: 'Match has already ended.' }
      }
      if (room.state.phase !== 'planning') {
        return { ok: false, errorCode: 'invalid_phase', message: 'Orders can only be queued during planning.' }
      }
      if (room.state.ready[seat]) {
        return { ok: false, errorCode: 'already_ready', message: 'You are already marked ready for this turn.' }
      }
      const params = sanitizeOrderParams(command.params)
      const next = planOrder(room.state, seat, command.cardId, params)
      if (!next) {
        return { ok: false, errorCode: 'invalid_order', message: 'Unable to queue order (AP, ownership, or target invalid).' }
      }
      return { ok: true, message: 'Order queued.' }
    }
    case 'remove_order': {
      if (room.ended || room.state.winner !== null) {
        return { ok: false, errorCode: 'match_ended', message: 'Match has already ended.' }
      }
      if (room.state.phase !== 'planning') {
        return { ok: false, errorCode: 'invalid_phase', message: 'Orders can only be edited during planning.' }
      }
      if (room.state.ready[seat]) {
        return { ok: false, errorCode: 'already_ready', message: 'Ready players cannot edit orders.' }
      }
      const playerState = room.state.players[seat]
      const index = playerState.orders.findIndex((order) => order.id === command.orderId)
      if (index === -1) {
        return { ok: false, errorCode: 'order_not_found', message: 'Order not found for your seat.' }
      }
      const [removed] = playerState.orders.splice(index, 1)
      playerState.hand.push({ id: removed.cardId, defId: removed.defId })
      return { ok: true, message: 'Order removed.' }
    }
    case 'reorder_order': {
      if (room.ended || room.state.winner !== null) {
        return { ok: false, errorCode: 'match_ended', message: 'Match has already ended.' }
      }
      if (room.state.phase !== 'planning') {
        return { ok: false, errorCode: 'invalid_phase', message: 'Orders can only be edited during planning.' }
      }
      if (room.state.ready[seat]) {
        return { ok: false, errorCode: 'already_ready', message: 'Ready players cannot edit orders.' }
      }
      const playerState = room.state.players[seat]
      const fromIndex = playerState.orders.findIndex((order) => order.id === command.fromOrderId)
      const toIndex = playerState.orders.findIndex((order) => order.id === command.toOrderId)
      if (fromIndex === -1 || toIndex === -1) {
        return { ok: false, errorCode: 'order_not_found', message: 'Both orders must exist in your queue.' }
      }
      if (fromIndex !== toIndex) {
        const [moved] = playerState.orders.splice(fromIndex, 1)
        playerState.orders.splice(toIndex, 0, moved)
      }
      return { ok: true, message: 'Order moved.' }
    }
    case 'ready': {
      if (room.ended || room.state.winner !== null) {
        return { ok: false, errorCode: 'match_ended', message: 'Match has already ended.' }
      }
      if (room.state.phase !== 'planning') {
        return { ok: false, errorCode: 'invalid_phase', message: 'Ready is only valid during planning.' }
      }
      if (room.state.ready[seat]) {
        return { ok: false, errorCode: 'already_ready', message: 'You are already ready.' }
      }
      room.state.ready[seat] = true
      let resolutionReplay: ResolutionReplayPayload | undefined
      if (room.state.ready[0] && room.state.ready[1]) {
        recordRoomUnplayedHandCards(room, room.state)
        startActionPhase(room.state)
        const actionStartState = cloneGameState(room.state)
        resolveAllActions(room.state)
        resolutionReplay = {
          actionStartState,
          finalState: cloneGameState(room.state),
        }
      }
      if (room.state.winner !== null) {
        room.ended = true
        room.endReason = 'victory'
      }
      return { ok: true, message: 'Ready set.', resolutionReplay }
    }
    default: {
      return { ok: false, errorCode: 'unknown_command', message: 'Unknown command type.' }
    }
  }
}

function sanitizeOrderParams(input: OrderParams): OrderParams {
  const out: OrderParams = {}
  if (typeof input.unitId === 'string') out.unitId = input.unitId
  if (typeof input.unitId2 === 'string') out.unitId2 = input.unitId2
  if (isDirection(input.direction)) out.direction = input.direction
  if (isDirection(input.moveDirection)) out.moveDirection = input.moveDirection
  if (isDirection(input.faceDirection)) out.faceDirection = input.faceDirection
  if (typeof input.distance === 'number' && Number.isFinite(input.distance)) {
    out.distance = Math.max(0, Math.floor(input.distance))
  }
  if (
    input.tile &&
    typeof input.tile.q === 'number' &&
    typeof input.tile.r === 'number' &&
    Number.isFinite(input.tile.q) &&
    Number.isFinite(input.tile.r)
  ) {
    out.tile = {
      q: Math.floor(input.tile.q),
      r: Math.floor(input.tile.r),
    }
  }
  if (
    input.tile2 &&
    typeof input.tile2.q === 'number' &&
    typeof input.tile2.r === 'number' &&
    Number.isFinite(input.tile2.q) &&
    Number.isFinite(input.tile2.r)
  ) {
    out.tile2 = {
      q: Math.floor(input.tile2.q),
      r: Math.floor(input.tile2.r),
    }
  }
  if (
    input.tile3 &&
    typeof input.tile3.q === 'number' &&
    typeof input.tile3.r === 'number' &&
    Number.isFinite(input.tile3.q) &&
    Number.isFinite(input.tile3.r)
  ) {
    out.tile3 = {
      q: Math.floor(input.tile3.q),
      r: Math.floor(input.tile3.r),
    }
  }
  return out
}

function isDirection(value: unknown): value is Direction {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 5
  )
}
