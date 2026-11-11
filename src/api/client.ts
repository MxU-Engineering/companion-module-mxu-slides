import type { ApiErrorBody, ServerInfo } from './types.js'

/** A command MxU Slides answered with an error. */
export class SlidesError extends Error {
	readonly status: number
	readonly code: string

	constructor(status: number, code: string, message: string) {
		super(message)
		this.name = 'SlidesError'
		this.status = status
		this.code = code
	}
}

export type ClientStatus =
	| { kind: 'connecting' }
	| { kind: 'connected'; info: ServerInfo; scope: string }
	| { kind: 'disconnected'; reason: string }
	| { kind: 'unreachable'; reason: string }
	| { kind: 'unauthorized' }
	| { kind: 'wrong-product'; product: string }

export interface ClientOptions {
	host: string
	port: number
	apiKey: string
	/** Topics to subscribe to once the socket opens. */
	topics: string[]
	onStatus: (status: ClientStatus) => void
	/** A subscribed topic pushed its state. */
	onEvent: (topic: string, data: unknown) => void
	/** The socket is open and subscribed; `snapshots` says whether Slides sends state on subscribe. */
	onReady: (info: ServerInfo, snapshots: boolean) => void
	/** Slides answers pings but its window has stopped moving (or started again). */
	onResponding: (responding: boolean) => void
	debug: (message: string) => void
	/** Test seam: overrides for the waits, all in milliseconds. */
	timing?: Partial<ClientTiming>
}

export interface ClientTiming {
	requestTimeout: number
	pingInterval: number
	pongTimeout: number
	reconnectFirst: number
	reconnectMax: number
}

const DEFAULT_TIMING: ClientTiming = {
	requestTimeout: 5000,
	pingInterval: 5000,
	pongTimeout: 12000,
	reconnectFirst: 1000,
	reconnectMax: 30000,
}

interface Pending {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
	timer: NodeJS.Timeout
}

/** Compares `1.10` with `1.9` the way versions read, not the way strings sort. */
export function versionAtLeast(version: string | undefined, wanted: string): boolean {
	const have = (version ?? '0').split('.').map((part) => Number.parseInt(part, 10) || 0)
	const need = wanted.split('.').map((part) => Number.parseInt(part, 10) || 0)
	for (let index = 0; index < Math.max(have.length, need.length); index++) {
		const left = have[index] ?? 0
		const right = need[index] ?? 0
		if (left !== right) return left > right
	}
	return true
}

/**
 * One connection to a MxU Slides Local API: a single WebSocket for state pushes and commands,
 * plus plain HTTP for the two things the socket does not carry (the unauthenticated ping and
 * slide pictures). Reconnects on its own with growing waits; `stop()` ends everything.
 */
export class SlidesClient {
	readonly #options: ClientOptions
	readonly #timing: ClientTiming
	#socket: WebSocket | undefined
	#stopped = true
	#attempt = 0
	#reconnectTimer: NodeJS.Timeout | undefined
	#pingTimer: NodeJS.Timeout | undefined
	#connectAbort: AbortController | undefined
	#pending = new Map<string, Pending>()
	#nextId = 1
	#info: ServerInfo | undefined
	#ready = false
	#lastPong = 0
	#lastBeat: number | undefined
	#stalledPongs = 0
	#responding = true

	constructor(options: ClientOptions) {
		this.#options = options
		this.#timing = { ...DEFAULT_TIMING, ...options.timing }
	}

	get info(): ServerInfo | undefined {
		return this.#info
	}

	get connected(): boolean {
		return this.#ready
	}

	get baseUrl(): string {
		const host = this.#options.host.includes(':') ? `[${this.#options.host}]` : this.#options.host
		return `http://${host}:${this.#options.port}`
	}

	/** Whether the connected Slides speaks at least this API version. */
	supports(version: string): boolean {
		return versionAtLeast(this.#info?.apiVersion, version)
	}

	start(): void {
		if (!this.#stopped) return
		this.#stopped = false
		this.#attempt = 0
		void this.#connect()
	}

	/** Closes the socket, stops every timer and fails whatever was still waiting. */
	stop(): void {
		this.#stopped = true
		clearTimeout(this.#reconnectTimer)
		this.#reconnectTimer = undefined
		this.#connectAbort?.abort()
		this.#teardown('Connection closed')
	}

	/** Runs one API operation over the socket and resolves with its response body. */
	async command(method: string, path: string, body?: unknown): Promise<unknown> {
		const socket = this.#socket
		if (!socket || !this.#ready || socket.readyState !== WebSocket.OPEN) {
			throw new Error('Not connected to MxU Slides')
		}
		const id = String(this.#nextId++)
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id)
				reject(new Error('MxU Slides did not answer in time'))
			}, this.#timing.requestTimeout)
			this.#pending.set(id, { resolve, reject, timer })
			try {
				socket.send(JSON.stringify({ type: 'command', id, method, path, ...(body === undefined ? {} : { body }) }))
			} catch (error) {
				clearTimeout(timer)
				this.#pending.delete(id)
				reject(error instanceof Error ? error : new Error(String(error)))
			}
		})
	}

	async get<T>(path: string): Promise<T> {
		return (await this.command('GET', path)) as T
	}

	async post(path: string, body?: unknown): Promise<void> {
		await this.command('POST', path, body ?? {})
	}

	/** A slide picture as a data URL, or null when Slides has none (nothing live, no next slide). */
	async fetchImage(path: string): Promise<string | null> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			headers: { Authorization: `Bearer ${this.#options.apiKey}` },
			signal: AbortSignal.timeout(this.#timing.requestTimeout),
		})
		if (response.status === 404) return null
		if (!response.ok) throw new SlidesError(response.status, 'http', `Slide picture: HTTP ${response.status}`)
		const type = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
		const bytes = Buffer.from(await response.arrayBuffer())
		return `data:${type};base64,${bytes.toString('base64')}`
	}

	async #connect(): Promise<void> {
		if (this.#stopped) return
		// A retry keeps the status that says why it is retrying; only a first try reads as connecting.
		if (this.#attempt === 0) this.#options.onStatus({ kind: 'connecting' })
		const abort = new AbortController()
		this.#connectAbort = abort
		let info: ServerInfo
		try {
			const response = await fetch(`${this.baseUrl}/v1/ping`, {
				signal: AbortSignal.any([abort.signal, AbortSignal.timeout(this.#timing.requestTimeout)]),
			})
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			info = (await response.json()) as ServerInfo
		} catch (error) {
			if (this.#stopped || abort.signal.aborted) return
			this.#fail({ kind: 'unreachable', reason: describe(error) })
			return
		}
		if (this.#stopped) return
		if (info.product !== 'MxU Slides') {
			this.#fail({ kind: 'wrong-product', product: String(info.product) })
			return
		}
		this.#info = info
		this.#open(info)
	}

	#open(info: ServerInfo): void {
		let opened = false
		const url = `${this.baseUrl.replace(/^http/, 'ws')}/v1/ws`
		let socket: WebSocket
		try {
			socket = new WebSocket(url, { headers: { Authorization: `Bearer ${this.#options.apiKey}` } })
		} catch (error) {
			this.#fail({ kind: 'unreachable', reason: describe(error) })
			return
		}
		this.#socket = socket

		socket.addEventListener('open', () => {
			opened = true
			this.#lastPong = Date.now()
			socket.send(JSON.stringify({ type: 'subscribe', topics: this.#options.topics }))
			this.#pingTimer = setInterval(() => this.#ping(), this.#timing.pingInterval)
		})
		socket.addEventListener('message', (event) => {
			if (socket !== this.#socket || typeof event.data !== 'string') return
			this.#receive(event.data, info)
		})
		socket.addEventListener('close', () => {
			if (socket !== this.#socket) return
			this.#teardown('Connection closed')
			if (this.#stopped) return
			if (opened) {
				this.#fail({ kind: 'disconnected', reason: 'MxU Slides closed the connection' })
			} else {
				void this.#explainRefusal()
			}
		})
		// The close event always follows and carries the handling; this only keeps the error quiet.
		socket.addEventListener('error', () => undefined)
	}

	/** The socket never opened: tell a bad key from an unreachable app with one signed request. */
	async #explainRefusal(): Promise<void> {
		try {
			const response = await fetch(`${this.baseUrl}/v1/timers`, {
				headers: { Authorization: `Bearer ${this.#options.apiKey}` },
				signal: AbortSignal.timeout(this.#timing.requestTimeout),
			})
			if (this.#stopped) return
			if (response.status === 401) {
				this.#fail({ kind: 'unauthorized' })
				return
			}
			this.#fail({ kind: 'unreachable', reason: 'The live connection was refused' })
		} catch (error) {
			if (this.#stopped) return
			this.#fail({ kind: 'unreachable', reason: describe(error) })
		}
	}

	#receive(text: string, info: ServerInfo): void {
		let frame: Record<string, unknown>
		try {
			frame = JSON.parse(text) as Record<string, unknown>
		} catch {
			return
		}
		switch (frame.type) {
			case 'hello':
				this.#options.onStatus({ kind: 'connected', info, scope: word(frame.scope) })
				break
			case 'subscribed':
				if (this.#ready) break
				this.#ready = true
				this.#attempt = 0
				this.#options.onReady(info, versionAtLeast(info.apiVersion, '1.1'))
				break
			case 'event':
				if (typeof frame.topic === 'string') this.#options.onEvent(frame.topic, frame.data)
				break
			case 'result':
				this.#settle(frame)
				break
			case 'pong':
				this.#pong(frame.beat)
				break
			case 'error':
				this.#options.debug(`MxU Slides: ${word(frame.message) || 'error'}`)
				break
		}
	}

	#settle(frame: Record<string, unknown>): void {
		const id = word(frame.id)
		const pending = this.#pending.get(id)
		if (!pending) return
		this.#pending.delete(id)
		clearTimeout(pending.timer)
		const status = Number(frame.status ?? 0)
		if (status >= 200 && status < 300) {
			pending.resolve(frame.data)
			return
		}
		const body = (frame.data ?? {}) as ApiErrorBody
		pending.reject(new SlidesError(status, body.code ?? 'error', body.message ?? `MxU Slides answered ${status}`))
	}

	#ping(): void {
		const socket = this.#socket
		if (!socket || socket.readyState !== WebSocket.OPEN) return
		if (Date.now() - this.#lastPong > this.#timing.pongTimeout) {
			this.#options.debug('No answer to pings; reconnecting')
			socket.close()
			// A socket that is truly dead may never report its own close.
			if (socket === this.#socket) {
				this.#teardown('MxU Slides stopped answering')
				this.#fail({ kind: 'disconnected', reason: 'MxU Slides stopped answering' })
			}
			return
		}
		socket.send(JSON.stringify({ type: 'ping' }))
	}

	/** `beat` counts up while the Slides window is alive; two pongs without movement means it froze. */
	#pong(beat: unknown): void {
		this.#lastPong = Date.now()
		if (typeof beat !== 'number') return
		this.#stalledPongs = beat === this.#lastBeat ? this.#stalledPongs + 1 : 0
		this.#lastBeat = beat
		const responding = this.#stalledPongs < 2
		if (responding !== this.#responding) {
			this.#responding = responding
			this.#options.onResponding(responding)
		}
	}

	#teardown(reason: string): void {
		clearInterval(this.#pingTimer)
		this.#pingTimer = undefined
		const socket = this.#socket
		this.#socket = undefined
		this.#ready = false
		this.#lastBeat = undefined
		this.#stalledPongs = 0
		this.#responding = true
		if (socket && socket.readyState !== WebSocket.CLOSED) {
			try {
				socket.close()
			} catch {
				// Already gone.
			}
		}
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer)
			pending.reject(new Error(reason))
		}
		this.#pending.clear()
	}

	#fail(status: ClientStatus): void {
		if (this.#stopped) return
		this.#options.onStatus(status)
		clearTimeout(this.#reconnectTimer)
		const wait = Math.min(this.#timing.reconnectMax, this.#timing.reconnectFirst * 2 ** this.#attempt)
		this.#attempt++
		this.#options.debug(`Trying again in ${Math.round(wait / 100) / 10}s`)
		this.#reconnectTimer = setTimeout(() => void this.#connect(), wait)
	}
}

/** A frame field as text; anything that is not text reads as empty. */
function word(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

function describe(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === 'TimeoutError') return 'No answer'
		const cause = (error as { cause?: { code?: string; message?: string } }).cause
		return cause?.code ?? cause?.message ?? error.message
	}
	return String(error)
}
