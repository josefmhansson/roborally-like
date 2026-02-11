import type { CardInstance, GameState, Order, PlayerId, Tile, Unit, UnitId } from '../src/engine/types'
import type { GameStateView, PresenceState, ViewMeta } from '../src/shared/net/view'
import type { Room } from './roomManager'

export function buildPresence(room: Room): PresenceState {
  return {
    connected: [room.seats[0].connected, room.seats[1].connected],
    paused: room.paused,
    deadlineAt: room.reconnectDeadlineAt,
  }
}

export function buildStateView(room: Room, seat: PlayerId): { stateView: GameStateView; viewMeta: ViewMeta } {
  return buildStateViewForState(room, room.state, seat)
}

export function buildStateViewForState(
  room: Room,
  sourceState: GameState,
  seat: PlayerId
): { stateView: GameStateView; viewMeta: ViewMeta } {
  const revealOpponentOrders = sourceState.phase === 'action'
  const players: GameStateView['players'] = [
    {
      hand: seat === 0 ? cloneCards(sourceState.players[0].hand) : null,
      orders: seat === 0 || revealOpponentOrders ? cloneOrders(sourceState.players[0].orders) : null,
    },
    {
      hand: seat === 1 ? cloneCards(sourceState.players[1].hand) : null,
      orders: seat === 1 || revealOpponentOrders ? cloneOrders(sourceState.players[1].orders) : null,
    },
  ]

  const units: Record<UnitId, Unit> = {}
  Object.entries(sourceState.units).forEach(([unitId, unit]) => {
    units[unitId] = {
      ...unit,
      pos: { ...unit.pos },
    }
  })

  const stateView: GameStateView = {
    boardRows: sourceState.boardRows,
    boardCols: sourceState.boardCols,
    tiles: cloneTiles(sourceState.tiles),
    units,
    players,
    ready: [sourceState.ready[0], sourceState.ready[1]],
    actionBudgets: [sourceState.actionBudgets[0], sourceState.actionBudgets[1]],
    activePlayer: sourceState.activePlayer,
    phase: sourceState.phase,
    actionQueue: cloneOrders(sourceState.actionQueue),
    actionIndex: sourceState.actionIndex,
    turn: sourceState.turn,
    nextUnitId: sourceState.nextUnitId,
    nextOrderId: sourceState.nextOrderId,
    log: [...sourceState.log],
    winner: sourceState.winner,
    spawnedByOrder: { ...sourceState.spawnedByOrder },
    settings: { ...sourceState.settings },
  }

  const viewMeta: ViewMeta = {
    roomCode: room.code,
    selfSeat: seat,
    paused: room.paused,
    reconnectDeadlineAt: room.reconnectDeadlineAt,
    counts: [
      {
        deck: sourceState.players[0].deck.length,
        discard: sourceState.players[0].discard.length,
        hand: sourceState.players[0].hand.length,
        orders: sourceState.players[0].orders.length,
      },
      {
        deck: sourceState.players[1].deck.length,
        discard: sourceState.players[1].discard.length,
        hand: sourceState.players[1].hand.length,
        orders: sourceState.players[1].orders.length,
      },
    ],
  }

  return { stateView, viewMeta }
}

function cloneTiles(tiles: Tile[]): Tile[] {
  return tiles.map((tile) => ({ ...tile }))
}

function cloneCards(cards: CardInstance[]): CardInstance[] {
  return cards.map((card) => ({ ...card }))
}

function cloneOrders(orders: Order[]): Order[] {
  return orders.map((order) => ({
    ...order,
    params: {
      ...order.params,
      tile: order.params.tile ? { ...order.params.tile } : undefined,
    },
  }))
}
