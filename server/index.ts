import { createServer, type IncomingMessage } from 'node:http'
import { URL } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import type { ClientMessage, ClientGameCommand, RoomSetup, ServerMessage } from '../src/shared/net/protocol'
import { applyRoomCommand } from './commandHandlers'
import { buildPresence, buildStateView, buildStateViewForState } from './redaction'
import { RoomManager } from './roomManager'
import type { GameState, OrderParams, PlayerId } from '../src/engine/types'

type SocketSession = {
  roomCode: string
  seat: PlayerId
}

const PORT = Number(process.env.PORT ?? 8080)
const WS_PATH = '/ws'
const manager = new RoomManager(10 * 60 * 1000)
const sessions = new Map<WebSocket, SocketSession>()

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname !== WS_PATH) {
    socket.destroy()
    return
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request)
  })
})

wss.on('connection', (ws, request) => {
  ws.on('message', (raw) => {
    const parsed = parseClientMessage(raw)
    if (!parsed) {
      send(ws, { type: 'error', code: 'bad_message', message: 'Malformed client message.' })
      return
    }
    handleClientMessage(ws, request, parsed)
  })

  ws.on('close', () => {
    const session = sessions.get(ws)
    if (!session) return
    sessions.delete(ws)
    const room = manager.detachSeat(session.roomCode, session.seat)
    if (!room) return
    broadcastPresence(room.code)
    broadcastSnapshots(room.code)
  })

  ws.on('error', () => {
    // Ignore socket errors; close handler manages session state.
  })
})

setInterval(() => {
  const forfeitedRooms = manager.tick()
  forfeitedRooms.forEach((room) => {
    broadcastPresence(room.code)
    broadcastSnapshots(room.code)
    broadcastMatchEnd(room.code, room.endReason ?? 'disconnect_timeout')
  })
}, 1000)

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`PvP server listening on :${PORT}`)
})

function handleClientMessage(ws: WebSocket, request: IncomingMessage, message: ClientMessage): void {
  if (message.type === 'create_room') {
    if (sessions.has(ws)) {
      send(ws, { type: 'error', code: 'already_joined', message: 'Socket is already attached to a room.' })
      return
    }
    const room = manager.createRoom(message.setup)
    const seat: PlayerId = 0
    const previousSocket = room.seats[seat].socket
    if (previousSocket) {
      sessions.delete(previousSocket)
    }
    manager.attachSeat(room, seat, ws)
    sessions.set(ws, { roomCode: room.code, seat })

    const inviteLinks = buildInviteLinks(request, room.code, room.seats[0].token, room.seats[1].token)
    send(ws, {
      type: 'room_created',
      roomCode: room.code,
      seat,
      seatToken: room.seats[seat].token,
      inviteLinks,
    })
    send(ws, { type: 'joined', roomCode: room.code, seat })
    broadcastPresence(room.code)
    broadcastSnapshots(room.code)
    return
  }

  if (message.type === 'join_room') {
    if (sessions.has(ws)) {
      send(ws, { type: 'error', code: 'already_joined', message: 'Socket is already attached to a room.' })
      return
    }
    const roomCode = message.roomCode.trim().toUpperCase()
    const room = manager.getRoom(roomCode)
    if (!room) {
      send(ws, { type: 'error', code: 'room_not_found', message: 'Room code not found.' })
      return
    }
    const seat = manager.getSeatByToken(room, message.seatToken.trim())
    if (seat === null) {
      send(ws, { type: 'error', code: 'invalid_token', message: 'Seat token is invalid.' })
      return
    }
    const previousSocket = room.seats[seat].socket
    if (previousSocket && previousSocket !== ws) {
      sessions.delete(previousSocket)
    }
    manager.attachSeat(room, seat, ws)
    sessions.set(ws, { roomCode: room.code, seat })
    send(ws, { type: 'joined', roomCode: room.code, seat })
    broadcastPresence(room.code)
    broadcastSnapshots(room.code)
    if (room.ended) {
      broadcastMatchEnd(room.code, room.endReason ?? 'ended')
    }
    return
  }

  if (message.type === 'command') {
    const session = sessions.get(ws)
    if (!session) {
      send(ws, { type: 'error', code: 'not_joined', message: 'Join a room before sending commands.' })
      return
    }
    const room = manager.getRoom(session.roomCode)
    if (!room) {
      send(ws, { type: 'error', code: 'room_not_found', message: 'Room no longer exists.' })
      return
    }
    const wasEnded = room.ended
    const result = applyRoomCommand(room, session.seat, message.command)
    send(ws, {
      type: 'command_result',
      cmdId: message.cmdId,
      ok: result.ok,
      errorCode: result.ok ? undefined : result.errorCode,
      message: result.message,
    })
    if (!result.ok) return

    if (result.resolutionReplay) {
      broadcastResolutionBundle(room.code, result.resolutionReplay.actionStartState, result.resolutionReplay.finalState)
    } else {
      broadcastSnapshots(room.code)
    }
    broadcastPresence(room.code)

    if (!wasEnded && (room.ended || room.state.winner !== null)) {
      room.ended = true
      room.endReason = room.endReason ?? 'victory'
      broadcastMatchEnd(room.code, room.endReason)
    }
  }
}

function broadcastResolutionBundle(roomCode: string, actionStartState: GameState, finalState: GameState): void {
  const room = manager.getRoom(roomCode)
  if (!room) return
  const presence = buildPresence(room)
  const serverTime = Date.now()
  ;([0, 1] as PlayerId[]).forEach((seat) => {
    const socket = room.seats[seat].socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    const actionStart = buildStateViewForState(room, actionStartState, seat)
    const final = buildStateViewForState(room, finalState, seat)
    send(socket, {
      type: 'resolution_bundle',
      actionStartStateView: actionStart.stateView,
      actionStartViewMeta: actionStart.viewMeta,
      finalStateView: final.stateView,
      finalViewMeta: final.viewMeta,
      presence,
      serverTime,
    })
  })
}

function broadcastSnapshots(roomCode: string): void {
  const room = manager.getRoom(roomCode)
  if (!room) return
  ;([0, 1] as PlayerId[]).forEach((seat) => {
    const socket = room.seats[seat].socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    const { stateView, viewMeta } = buildStateView(room, seat)
    send(socket, {
      type: 'snapshot',
      stateView,
      viewMeta,
      presence: buildPresence(room),
      serverTime: Date.now(),
    })
  })
}

function broadcastPresence(roomCode: string): void {
  const room = manager.getRoom(roomCode)
  if (!room) return
  ;([0, 1] as PlayerId[]).forEach((seat) => {
    const socket = room.seats[seat].socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    send(socket, {
      type: 'presence_update',
      connected: [room.seats[0].connected, room.seats[1].connected],
      paused: room.paused,
      deadlineAt: room.reconnectDeadlineAt,
    })
  })
}

function broadcastMatchEnd(roomCode: string, reason: string): void {
  const room = manager.getRoom(roomCode)
  if (!room) return
  ;([0, 1] as PlayerId[]).forEach((seat) => {
    const socket = room.seats[seat].socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    send(socket, {
      type: 'match_end',
      winner: room.state.winner,
      reason,
    })
  })
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(message))
}

function parseClientMessage(raw: WebSocket.RawData): ClientMessage | null {
  try {
    const value = JSON.parse(String(raw)) as unknown
    if (!isObject(value) || typeof value.type !== 'string') return null
    if (value.type === 'create_room') {
      const setup = parseRoomSetup(value.setup)
      return setup ? { type: 'create_room', setup } : { type: 'create_room' }
    }
    if (value.type === 'join_room') {
      if (typeof value.roomCode !== 'string' || typeof value.seatToken !== 'string') return null
      return {
        type: 'join_room',
        roomCode: value.roomCode,
        seatToken: value.seatToken,
      }
    }
    if (value.type === 'command') {
      if (typeof value.cmdId !== 'string') return null
      const command = parseGameCommand(value.command)
      if (!command) return null
      return {
        type: 'command',
        cmdId: value.cmdId,
        command,
      }
    }
    return null
  } catch {
    return null
  }
}

function parseRoomSetup(value: unknown): RoomSetup | null {
  if (!isObject(value)) return null
  if (!isObject(value.settings)) return null
  if (!isObject(value.loadouts)) return null
  if (!Array.isArray(value.loadouts.p1) || !Array.isArray(value.loadouts.p2)) return null
  return {
    settings: value.settings as RoomSetup['settings'],
    loadouts: {
      p1: value.loadouts.p1 as RoomSetup['loadouts']['p1'],
      p2: value.loadouts.p2 as RoomSetup['loadouts']['p2'],
    },
  }
}

function parseGameCommand(value: unknown): ClientGameCommand | null {
  if (!isObject(value) || typeof value.type !== 'string') return null
  if (value.type === 'queue_order') {
    if (typeof value.cardId !== 'string' || !isObject(value.params)) return null
    return {
      type: 'queue_order',
      cardId: value.cardId,
      params: value.params as OrderParams,
    }
  }
  if (value.type === 'remove_order') {
    if (typeof value.orderId !== 'string') return null
    return { type: 'remove_order', orderId: value.orderId }
  }
  if (value.type === 'reorder_order') {
    if (typeof value.fromOrderId !== 'string' || typeof value.toOrderId !== 'string') return null
    return {
      type: 'reorder_order',
      fromOrderId: value.fromOrderId,
      toOrderId: value.toOrderId,
    }
  }
  if (value.type === 'ready') {
    return { type: 'ready' }
  }
  return null
}

function buildInviteLinks(
  request: IncomingMessage,
  roomCode: string,
  seatToken0: string,
  seatToken1: string
): { seat0: string; seat1: string } {
  const explicitBase = process.env.INVITE_BASE_URL?.trim()
  const isTls = Boolean((request.socket as { encrypted?: boolean }).encrypted)
  const proto =
    (request.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ||
    (isTls ? 'https' : 'http')
  const host = request.headers.host ?? `localhost:${PORT}`
  const base = explicitBase && explicitBase.length > 0 ? explicitBase.replace(/\/+$/, '') : `${proto}://${host}`
  return {
    seat0: `${base}/?room=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(seatToken0)}`,
    seat1: `${base}/?room=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(seatToken1)}`,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}
