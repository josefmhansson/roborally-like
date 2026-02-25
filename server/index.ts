import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { URL } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import type { ClientMessage, ClientGameCommand, RoomSetup, ServerMessage } from '../src/shared/net/protocol'
import { applyRoomCommand } from './commandHandlers'
import { buildPresence, buildStateView, buildStateViewForState } from './redaction'
import { RoomManager, buildRoomTelemetrySubmission, markRoomTelemetrySubmitted, recordRoomPlayedCards } from './roomManager'
import { TelemetryStore } from './telemetryStore'
import type { GameState, OrderParams, PlayerId } from '../src/engine/types'

type SocketSession = {
  roomCode: string
  seat: PlayerId
}

const PORT = Number(process.env.PORT ?? 8080)
const WS_PATH = '/ws'
const TELEMETRY_MATCH_PATH = '/telemetry/match'
const TELEMETRY_CARDS_PATH = '/telemetry/cards'
const TELEMETRY_MATCHES_PATH = '/telemetry/matches'
const manager = new RoomManager(10 * 60 * 1000)
const telemetryStore = new TelemetryStore()
const sessions = new Map<WebSocket, SocketSession>()

const server = createServer((req, res) => {
  void handleHttpRequest(req, res).catch(() => {
    if (!res.headersSent) {
      writeJson(res, 500, { ok: false, errorCode: 'internal_error', message: 'Unexpected server error.' })
    } else {
      res.end()
    }
  })
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

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost')
  const pathname = requestUrl.pathname

  if (pathname.startsWith('/telemetry/')) {
    applyTelemetryCorsHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
  }

  if (pathname === '/health' && req.method === 'GET') {
    writeJson(res, 200, { ok: true })
    return
  }

  if (pathname === TELEMETRY_MATCH_PATH && req.method === 'POST') {
    const body = await readJsonBody(req, 512 * 1024)
    if (!body.ok) {
      writeJson(res, body.statusCode, { ok: false, errorCode: body.errorCode, message: body.message })
      return
    }
    const result = telemetryStore.ingest(body.value, 'client_report')
    if (!result.ok) {
      writeJson(res, 400, { ok: false, errorCode: result.errorCode, message: result.message })
      return
    }
    writeJson(res, 202, { ok: true, matchId: result.record.matchId })
    return
  }

  if (pathname === TELEMETRY_CARDS_PATH && req.method === 'GET') {
    writeJson(res, 200, telemetryStore.getCardBalanceSummary())
    return
  }

  if (pathname === TELEMETRY_MATCHES_PATH && req.method === 'GET') {
    const limit = Number.parseInt(requestUrl.searchParams.get('limit') ?? '50', 10)
    writeJson(res, 200, {
      ok: true,
      matches: telemetryStore.listRecentMatches(Number.isFinite(limit) ? limit : 50),
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
}

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
    manager.applySeatLoadoutOnFirstJoin(room, seat, message.loadout)
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
      recordRoomPlayedCards(room, result.resolutionReplay.actionStartState)
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
  flushRoomTelemetry(room.code)
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

function flushRoomTelemetry(roomCode: string): void {
  const room = manager.getRoom(roomCode)
  if (!room) return
  const submission = buildRoomTelemetrySubmission(room)
  if (!submission) return
  try {
    telemetryStore.ingestSubmission(submission, 'server_online')
    markRoomTelemetrySubmitted(room)
  } catch {
    // eslint-disable-next-line no-console
    console.error(`Failed to persist telemetry for room ${room.code}.`)
  }
}

function applyTelemetryCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; statusCode: number; errorCode: string; message: string }
> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let tooLarge = false

    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      bytes += chunk.length
      if (bytes > maxBytes) {
        tooLarge = true
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (tooLarge) {
        resolve({
          ok: false,
          statusCode: 413,
          errorCode: 'payload_too_large',
          message: 'Telemetry payload exceeds limit.',
        })
        return
      }
      if (chunks.length === 0) {
        resolve({
          ok: false,
          statusCode: 400,
          errorCode: 'empty_payload',
          message: 'Expected JSON payload.',
        })
        return
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        resolve({ ok: true, value: JSON.parse(raw) as unknown })
      } catch {
        resolve({
          ok: false,
          statusCode: 400,
          errorCode: 'invalid_json',
          message: 'Malformed JSON payload.',
        })
      }
    })

    req.on('error', () => {
      resolve({
        ok: false,
        statusCode: 400,
        errorCode: 'read_error',
        message: 'Failed to read request body.',
      })
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
      const loadout = parseJoinLoadout(value.loadout)
      if (value.loadout !== undefined && !loadout) return null
      return {
        type: 'join_room',
        roomCode: value.roomCode,
        seatToken: value.seatToken,
        loadout: loadout ?? undefined,
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
  if (!isObject(value.loadouts)) return null
  const settings = parseRoomSettings(value.settings)
  if (!settings) return null
  const p1 = parseJoinLoadout(value.loadouts.p1)
  const p2 = parseJoinLoadout(value.loadouts.p2)
  if (!p1 || !p2) return null
  return {
    settings,
    loadouts: {
      p1,
      p2,
    },
  }
}

function parseRoomSettings(value: unknown): RoomSetup['settings'] | null {
  if (!isObject(value)) return null
  const boardRows = parseFiniteNumber(value.boardRows)
  const boardCols = parseFiniteNumber(value.boardCols)
  const strongholdStrength = parseFiniteNumber(value.strongholdStrength)
  const deckSize = parseFiniteNumber(value.deckSize)
  const drawPerTurn = parseFiniteNumber(value.drawPerTurn)
  const maxCopies = parseFiniteNumber(value.maxCopies)
  const actionBudgetP1 = parseFiniteNumber(value.actionBudgetP1)
  const actionBudgetP2 = parseFiniteNumber(value.actionBudgetP2)
  if (
    boardRows === null ||
    boardCols === null ||
    strongholdStrength === null ||
    deckSize === null ||
    drawPerTurn === null ||
    maxCopies === null ||
    actionBudgetP1 === null ||
    actionBudgetP2 === null
  ) {
    return null
  }
  return {
    boardRows,
    boardCols,
    strongholdStrength,
    deckSize,
    drawPerTurn,
    maxCopies,
    actionBudgetP1,
    actionBudgetP2,
  }
}

function parseJoinLoadout(value: unknown): RoomSetup['loadouts']['p1'] | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) return null
  const cards = value.filter((item): item is string => typeof item === 'string')
  if (cards.length !== value.length) return null
  return cards as RoomSetup['loadouts']['p1']
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
  if (value.type === 'update_loadout') {
    const loadout = parseJoinLoadout(value.loadout)
    if (!loadout) return null
    return {
      type: 'update_loadout',
      loadout,
    }
  }
  if (value.type === 'rematch') {
    return { type: 'rematch' }
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
  const forwardedHost = (request.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim()
  const isTls = Boolean((request.socket as { encrypted?: boolean }).encrypted)
  const forwardedProto = normalizeInviteProto(
    (request.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim()
  )
  const proto =
    forwardedProto ??
    (isTls ? 'https' : 'http')
  const rawHost = forwardedHost || request.headers.host || `localhost:${PORT}`
  const host = normalizeInviteHost(rawHost)
  const base = explicitBase && explicitBase.length > 0 ? explicitBase.replace(/\/+$/, '') : `${proto}://${host}`
  return {
    seat0: `${base}/join/${encodeURIComponent(roomCode)}/${encodeURIComponent(seatToken0)}`,
    seat1: `${base}/join/${encodeURIComponent(roomCode)}/${encodeURIComponent(seatToken1)}`,
  }
}

function normalizeInviteProto(value: string | undefined): 'http' | 'https' | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'http' || normalized === 'ws') return 'http'
  if (normalized === 'https' || normalized === 'wss') return 'https'
  return null
}

function normalizeInviteHost(hostHeader: string): string {
  const parsed = parseHostHeader(hostHeader)
  if (!parsed) return hostHeader
  if (!isLocalHostname(parsed.hostname)) return hostHeader
  const lanIpv4 = detectLanIpv4()
  if (!lanIpv4) return hostHeader
  return parsed.port ? `${lanIpv4}:${parsed.port}` : lanIpv4
}

function parseHostHeader(hostHeader: string): { hostname: string; port: string } | null {
  try {
    const parsed = new URL(`http://${hostHeader.trim()}`)
    return {
      hostname: parsed.hostname,
      port: parsed.port,
    }
  } catch {
    return null
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '0.0.0.0'
}

function detectLanIpv4(): string | null {
  const interfaces = networkInterfaces()
  const preferred: string[] = []
  const fallback: string[] = []
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (isPrivateIpv4(entry.address)) {
        preferred.push(entry.address)
      } else {
        fallback.push(entry.address)
      }
    }
  }
  return preferred[0] ?? fallback[0] ?? null
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number(part))
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false
  }
  if (octets[0] === 10) return true
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
  if (octets[0] === 192 && octets[1] === 168) return true
  return false
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}
