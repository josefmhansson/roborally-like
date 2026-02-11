import type { ClientMessage, ServerMessage } from '../shared/net/protocol'

export type OnlineClientHandlers = {
  onOpen?: () => void
  onClose?: (event: CloseEvent) => void
  onError?: () => void
  onMessage?: (message: ServerMessage) => void
}

export class OnlineClient {
  private socket: WebSocket | null = null
  private handlers: OnlineClientHandlers
  private readonly url: string

  constructor(url: string, handlers: OnlineClientHandlers = {}) {
    this.url = url
    this.handlers = handlers
  }

  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return
    }
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.addEventListener('open', () => {
      this.handlers.onOpen?.()
    })

    socket.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as ServerMessage
        this.handlers.onMessage?.(parsed)
      } catch {
        // Ignore malformed payloads.
      }
    })

    socket.addEventListener('error', () => {
      this.handlers.onError?.()
    })

    socket.addEventListener('close', (event) => {
      this.handlers.onClose?.(event)
    })
  }

  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false
    }
    this.socket.send(JSON.stringify(message))
    return true
  }

  close(): void {
    if (!this.socket) return
    this.socket.close()
    this.socket = null
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }
}
