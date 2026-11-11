import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { crc32, deflateSync } from 'node:zlib'
import type {
	ActionComboEntry,
	AudioInputStatus,
	AudioMixStatus,
	AudioOutputStatus,
	AudioStatus,
	CaptureStatus,
	FollowStatus,
	LibraryEntry,
	LockStatus,
	MidiDeviceStatus,
	OutputsStatus,
	SchedulerStatus,
	ServiceTrackingStatus,
	ShowSection,
	ShowStatus,
	TimecodeStatus,
	TimerStatus,
	TransportRow,
	VideoInputStatus,
} from '../api/types.js'

/**
 * A stand-in for MxU Slides that speaks its Local API: the routes of API 1.0, and with
 * `apiVersion: '1.1'` the additions the Companion module was built against (recording and
 * streaming, the mixer and its meters, slide pictures, sections, timer adjust, state on
 * subscribe and the rest). It keeps a small service in memory, changes it the way Slides
 * would when commanded, and pushes each change to its subscribers.
 *
 * It exists so every action, feedback and variable can be exercised without the app.
 */

export interface FakeOptions {
	apiVersion?: '1.0' | '1.1'
	key?: string
	scope?: 'view' | 'control' | 'edit'
	port?: number
	product?: string
}

export interface FakeRequest {
	method: string
	path: string
	body: unknown
}

interface Deck {
	id: string
	name: string
	sections: ShowSection[]
	slideCount: number
}

interface Socket {
	stream: Duplex
	topics: Set<string>
	buffer: Buffer
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message)
	}
}

const notFound = (message: string): HttpError => new HttpError(404, 'not_found', message)
const badRequest = (message: string): HttpError => new HttpError(400, 'bad_request', message)

/** A body field as text; anything that is not text reads as the fallback. */
function word(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback
}

function section(id: string, name: string, colorHex: string, firstSlideIndex: number, slideCount: number): ShowSection {
	return { id, name, colorHex, firstSlideIndex, slideCount }
}

const DECKS: Deck[] = [
	{
		id: 'deck-goodness',
		name: 'Goodness of God',
		slideCount: 14,
		sections: [
			section('s-v1', 'Verse 1', '#40C8E0FF', 0, 2),
			section('s-ch', 'Chorus', '#FF9F0AFF', 2, 2),
			section('s-v2', 'Verse 2', '#40C8E0FF', 4, 2),
			section('s-ch2', 'Chorus', '#FF9F0AFF', 6, 2),
			section('s-br', 'Bridge', '#BF5AF2FF', 8, 4),
			section('s-end', 'Ending', '#30D158FF', 12, 2),
		],
	},
	{
		id: 'deck-sermon',
		name: 'Sermon: Hope',
		slideCount: 6,
		sections: [section('s-intro', 'Intro', '#0A84FFFF', 0, 2), section('s-points', 'Points', '#FFD60AFF', 2, 4)],
	},
]

function entry(id: string, name: string, folder?: string): LibraryEntry {
	return { id, name, ...(folder ? { folder } : {}) }
}

/** A small PNG that looks like a slide: a dark blue field with two white lines of "text". */
function slidePicture(width: number, seed: number): Buffer {
	const height = Math.round((width * 9) / 16)
	const row = width * 3 + 1
	const raw = Buffer.alloc(row * height)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const at = y * row + 1 + x * 3
			const inLine = (line: number, share: number): boolean =>
				Math.abs(y - height * line) < height * 0.045 && Math.abs(x - width / 2) < (width * share) / 2
			if (inLine(0.42, 0.55 + (seed % 3) * 0.1) || inLine(0.6, 0.4 + (seed % 4) * 0.08)) {
				raw.fill(0xf0, at, at + 3)
			} else {
				raw[at] = 28 + Math.round((46 * x) / width)
				raw[at + 1] = 42 - Math.round((11 * x) / width)
				raw[at + 2] = 82 + Math.round((10 * y) / height)
			}
		}
	}
	const chunk = (type: string, data: Buffer): Buffer => {
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
		const out = Buffer.alloc(body.length + 8)
		out.writeUInt32BE(data.length, 0)
		body.copy(out, 4)
		out.writeUInt32BE(crc32(body), body.length + 4)
		return out
	}
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header.set([8, 2, 0, 0, 0], 8)
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	])
}

export class FakeSlides {
	readonly options: Required<FakeOptions>
	/** Every command and read the fake received, oldest first. */
	readonly requests: FakeRequest[] = []
	port = 0

	// The service in memory. Tests may change any of it and call `push`.
	deck: Deck | undefined = DECKS[0]
	slideIndex = 2
	serviceItemId: string | undefined = 'item-song-1'
	itemIndex = 1
	readonly items = ['Welcome', 'Goodness of God', 'Announcements', 'Sermon: Hope']
	mediaLayers: ShowStatus['mediaLayers'] = {}
	overlays: ShowStatus['overlays'] = []
	alert: ShowStatus['alert']
	confidenceLayout: string | undefined
	timers: TimerStatus[] = []
	lengths = new Map<string, number>()
	audio: AudioStatus = { buses: [] }
	transport: TransportRow[] = []
	outputs: OutputsStatus = {
		screens: [
			{ id: 'screen-audience', name: 'Audience', role: 'audience', backed: true },
			{ id: 'screen-stage', name: 'Stage', role: 'confidence', backed: true },
		],
		presets: [
			{ id: 'look-worship', name: 'Worship', active: true },
			{ id: 'look-sermon', name: 'Sermon', active: false },
		],
	}
	scheduler: SchedulerStatus = {
		enabled: true,
		nextFire: { triggerId: 'trigger-preservice', name: 'Preservice', at: '2026-11-15T14:45:00Z' },
		triggers: [
			{
				id: 'trigger-preservice',
				name: 'Preservice',
				enabled: true,
				folderEnabled: true,
				nextFire: '2026-11-15T14:45:00Z',
			},
			{ id: 'trigger-doors', name: 'Doors Open', enabled: false, folderEnabled: true },
		],
	}
	timecode: TimecodeStatus = {
		hasInput: false,
		source: 'ltc',
		follows: false,
		state: 'noInput',
		reverse: false,
		offsetFrames: 0,
	}
	lock: LockStatus = { locked: false, automatic: true, waitingUpdates: 0 }
	follow: FollowStatus = { role: 'none' }
	midi: MidiDeviceStatus[] = [
		{ id: 'midi-lights', name: 'Lighting Console', enabled: true, direction: 'output', connected: true },
	]
	videoInputs: VideoInputStatus[] = [
		{ id: 'cam-1', name: 'Camera 1', kind: 'camera', live: false },
		{ id: 'cam-2', name: 'Camera 2', kind: 'ndi', live: false },
	]
	inputs: AudioInputStatus[] = [
		{ id: 'in-pastor', name: 'Pastor', live: true, enabled: true, gain: 0.5, muted: false, mixId: 'mix-stream' },
		{ id: 'in-host', name: 'Host', live: true, enabled: true, gain: 0.33, muted: false, mixId: 'mix-stream' },
		{ id: 'in-video', name: 'Video', live: true, enabled: true, gain: 0.71, muted: true, mixId: 'mix-room' },
		{ id: 'in-lobby', name: 'Lobby', live: false, enabled: false, gain: 1, muted: false, mixId: 'mix-room' },
	]
	mixes: AudioMixStatus[] = [
		{ id: 'mix-stream', name: 'Stream', gain: 0.63, muted: false, outputIds: ['out-stream'] },
		{ id: 'mix-room', name: 'Room', gain: 0.25, muted: false, outputIds: ['out-main'] },
	]
	audioOutputs: AudioOutputStatus[] = [
		{ id: 'out-main', name: 'Main', gain: 1, muted: false },
		{ id: 'out-stream', name: 'Stream Out', gain: 0.8, muted: false },
	]
	capture: CaptureStatus = { recording: { active: false }, streaming: { active: false } }
	serviceTracking: ServiceTrackingStatus = { state: 'preService', plannedStart: '2026-11-15T15:00:00Z' }
	timeline: 'stopped' | 'playing' = 'stopped'
	currentServiceId = 'service-sunday'
	library: Record<string, LibraryEntry[]> = {
		presentations: DECKS.map((deck) => entry(deck.id, deck.name, 'Songs')),
		services: [entry('service-sunday', 'Sunday 9 AM'), entry('service-wednesday', 'Wednesday Night')],
		media: [entry('media-welcome', 'Welcome Loop', 'Loops'), entry('media-bumper', 'Sermon Bumper')],
		audio: [entry('audio-sting', 'Sting')],
		playlists: [entry('playlist-pre', 'Pre-Service'), entry('playlist-walkout', 'Walk Out')],
		overlays: [entry('overlay-lower', 'Lower Third'), entry('overlay-bug', 'Logo Bug')],
		'alert-presets': [entry('alert-nursery', 'Nursery'), entry('alert-wrap', 'Wrap Up')],
		'stream-presets': [entry('stream-youtube', 'YouTube 1080p')],
		'action-combos': [
			entry('combo-pre', 'Preservice'),
			entry('combo-live', 'Go Live'),
			entry('combo-house', 'House Lights'),
		],
		'confidence-layouts': [entry('layout-lyrics', 'Lyrics Layout'), entry('layout-notes', 'Sermon Notes')],
		themes: [],
		'output-presets': [entry('look-worship', 'Worship'), entry('look-sermon', 'Sermon')],
		'schedule-triggers': [entry('trigger-preservice', 'Preservice'), entry('trigger-doors', 'Doors Open')],
	}
	combos: ActionComboEntry[] = [
		{ id: 'combo-pre', name: 'Preservice', colorHex: '#64D2FFFF', iconName: 'combos' },
		{ id: 'combo-live', name: 'Go Live', colorHex: '#FF375FFF', iconName: 'broadcast' },
		{ id: 'combo-house', name: 'House Lights', iconName: 'light' },
	]

	#server: Server | undefined
	#sockets = new Set<Socket>()
	#beat = 0
	#frozen = false
	#silent = false
	#meterTimer: NodeJS.Timeout | undefined
	#pictureSeed = 1
	#fireSeq = 0

	constructor(options: FakeOptions = {}) {
		this.options = {
			apiVersion: options.apiVersion ?? '1.1',
			key: options.key ?? 'mxu_fake_key',
			scope: options.scope ?? 'control',
			port: options.port ?? 0,
			product: options.product ?? 'MxU Slides',
		}
		const now = Date.now()
		this.timers = [
			this.#timer('timer-service', 'Service', 'countUp', { runningSince: new Date(now - 768_000).toISOString() }),
			this.#timer('timer-sermon', 'Sermon', 'countdown', { durationSeconds: 2100 }),
			this.#timer('timer-countdown', 'Countdown', 'countdown', { durationSeconds: 300 }),
		]
	}

	get v11(): boolean {
		return this.options.apiVersion === '1.1'
	}

	async start(): Promise<number> {
		const server = createServer((request, response) => void this.#http(request, response))
		server.on('upgrade', (request: IncomingMessage, stream: Duplex) => this.#upgrade(request, stream))
		this.#server = server
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(this.options.port, '127.0.0.1', resolve)
		})
		this.port = (server.address() as AddressInfo).port
		return this.port
	}

	async stop(): Promise<void> {
		clearInterval(this.#meterTimer)
		this.#meterTimer = undefined
		this.dropConnections()
		const server = this.#server
		this.#server = undefined
		if (!server) return
		server.closeAllConnections()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}

	/** Closes every live connection, as when Slides quits. */
	dropConnections(): void {
		for (const socket of this.#sockets) socket.stream.destroy()
		this.#sockets.clear()
	}

	/** Stops answering anything on the socket, as a computer that fell off the network would. */
	silence(silent: boolean): void {
		this.#silent = silent
	}

	/** Makes the app look frozen: it still answers pings, but its beat stops moving. */
	freeze(frozen: boolean): void {
		this.#frozen = frozen
	}

	get connections(): number {
		return this.#sockets.size
	}

	/** Sends a topic's current state to everyone subscribed to it. */
	push(topic: string): void {
		this.#publish(topic, this.snapshot(topic))
	}

	/** The commands received, without the reads, as `METHOD path`. */
	commands(): string[] {
		return this.requests
			.filter((request) => request.method !== 'GET')
			.map((request) => `${request.method} ${request.path}`)
	}

	lastBody(path: string): unknown {
		return this.requests.findLast((request) => request.path === path && request.method !== 'GET')?.body
	}

	/** One topic's state, in the shape its GET returns. */
	snapshot(topic: string): unknown {
		switch (topic) {
			case 'show':
				return this.#show()
			case 'timers':
				return this.timers.map((timer) => this.#stamped(timer))
			case 'audio':
				return this.audio
			case 'transport':
				return this.transport
			case 'outputs':
				return this.outputs
			case 'scheduler':
				return this.scheduler
			case 'timecode':
				return { ...this.timecode, ...(this.#timelineStatus() ? { timeline: this.#timelineStatus() } : {}) }
			case 'library':
				return { counts: Object.fromEntries(Object.entries(this.library).map(([kind, list]) => [kind, list.length])) }
			case 'capture':
				return this.capture
			case 'inputs':
				return this.videoInputs
			case 'serviceTracking':
				return this.serviceTracking
			case 'mixer':
				return {
					inputs: this.#strips(this.inputs),
					mixes: this.#strips(this.mixes),
					outputs: this.#strips(this.audioOutputs),
				}
			default:
				return undefined
		}
	}

	// MARK: State

	#timer(id: string, name: string, mode: TimerStatus['mode'], extra: Partial<TimerStatus> = {}): TimerStatus {
		const running = !!extra.runningSince
		if (extra.durationSeconds !== undefined) this.lengths.set(id, extra.durationSeconds)
		return {
			id,
			name,
			mode,
			running,
			displaySeconds: 0,
			overrun: false,
			bankedSeconds: 0,
			durationSeconds: 0,
			warnings: [
				{ remainingSeconds: 30, colorHex: '#FFB826FF' },
				{ remainingSeconds: 0, colorHex: '#FF4739FF' },
			],
			...(this.v11 ? { started: running } : {}),
			...extra,
		}
	}

	#elapsed(timer: TimerStatus): number {
		const since = timer.runningSince ? Date.parse(timer.runningSince) : Date.now()
		return (timer.bankedSeconds ?? 0) + (timer.running ? Math.max(0, (Date.now() - since) / 1000) : 0)
	}

	#value(timer: TimerStatus): number {
		if (timer.mode === 'countUp') return this.#elapsed(timer)
		if (timer.mode === 'countdownToTime')
			return timer.targetTime ? (Date.parse(timer.targetTime) - Date.now()) / 1000 : 0
		return (timer.durationSeconds ?? 0) - this.#elapsed(timer)
	}

	/** A timer as Slides sends it: with the whole seconds it shows at this instant. */
	#stamped(timer: TimerStatus): TimerStatus {
		const value = this.#value(timer)
		return {
			...timer,
			displaySeconds: Math.round(value),
			overrun: timer.mode !== 'countUp' && value <= 0 && timer.running,
		}
	}

	#strips<T extends { gain: number }>(strips: T[]): T[] {
		if (!this.v11) return strips
		return strips.map((strip) => ({
			...strip,
			gainDb: strip.gain <= 0 ? -90 : Math.round(200 * Math.log10(strip.gain)) / 10,
		}))
	}

	#sectionAt(index: number): ShowSection | undefined {
		return this.deck?.sections.find(
			(candidate) => index >= candidate.firstSlideIndex && index < candidate.firstSlideIndex + candidate.slideCount,
		)
	}

	#timelineStatus(): TimecodeStatus['timeline'] {
		if (!this.v11 || !this.serviceItemId) return undefined
		return {
			serviceItemId: this.serviceItemId,
			position: 0,
			anchoredAt: new Date().toISOString(),
			running: this.timeline === 'playing',
			length: 240,
		}
	}

	#show(): ShowStatus {
		const deck = this.deck
		const live = this.#sectionAt(this.slideIndex)
		const nextIndex = deck && this.slideIndex + 1 < deck.slideCount ? this.slideIndex + 1 : undefined
		const upcoming = nextIndex === undefined ? undefined : this.#sectionAt(nextIndex)
		const v11 = this.v11
		return {
			...(deck
				? {
						liveSlide: {
							presentationId: deck.id,
							presentationName: deck.name,
							slideId: `${deck.id}-slide-${this.slideIndex}`,
							slideIndex: this.slideIndex,
							slideName: `Slide ${this.slideIndex + 1}`,
							...(this.serviceItemId ? { serviceItemId: this.serviceItemId } : {}),
							occurrence: this.slideIndex,
							text: `Line ${this.slideIndex + 1} of ${deck.name}`,
							slideCount: deck.slideCount,
							firedBy: { kind: 'api', name: 'Companion' },
							...(v11
								? {
										sectionId: live?.id,
										sectionName: live?.name,
										sectionColorHex: live?.colorHex,
										notes: `Notes for slide ${this.slideIndex + 1}`,
										thumbnailVersion: `${deck.id}-${this.slideIndex}-${this.#pictureSeed}`,
									}
								: {}),
						},
					}
				: {}),
			nextSlideText: nextIndex === undefined ? undefined : `Line ${nextIndex + 1} of ${deck?.name}`,
			nextSlide:
				nextIndex === undefined
					? {}
					: {
							text: `Line ${nextIndex + 1} of ${deck?.name}`,
							...(v11
								? {
										presentationId: deck?.id,
										slideId: `${deck?.id}-slide-${nextIndex}`,
										slideIndex: nextIndex,
										sectionName: upcoming?.name,
										sectionColorHex: upcoming?.colorHex,
										notes: `Notes for slide ${nextIndex + 1}`,
										thumbnailVersion: `${deck?.id}-${nextIndex}-${this.#pictureSeed}`,
									}
								: {}),
						},
			mediaLayers: this.mediaLayers,
			overlays: this.overlays,
			...(this.alert ? { alert: this.alert } : {}),
			currentServiceId: this.currentServiceId,
			service: {
				id: this.currentServiceId,
				name: this.library.services.find((service) => service.id === this.currentServiceId)?.name ?? '',
			},
			position: {
				currentItemName: this.items[this.itemIndex],
				nextItemName: this.items[this.itemIndex + 1],
				...(v11
					? {
							currentItemId: `item-${this.itemIndex}`,
							nextItemId: this.itemIndex + 1 < this.items.length ? `item-${this.itemIndex + 1}` : undefined,
							currentItemIndex: this.itemIndex,
							itemCount: this.items.length,
						}
					: {}),
			},
			confidence: {
				screens: [
					{ id: 'screen-stage', name: 'Stage', ...(this.confidenceLayout ? { layoutId: this.confidenceLayout } : {}) },
				],
			},
			...(v11 ? { sections: deck?.sections ?? [] } : {}),
		}
	}

	// MARK: Routes

	/** Runs one operation and returns its response body. Throws `HttpError` as Slides answers errors. */
	#route(method: string, path: string, body: Record<string, unknown>): unknown {
		const parts = path.split('?')[0].split('/').filter(Boolean)
		const [, area, a, b, c] = parts
		const key = `${method} ${parts.slice(1).join('/')}`
		const need11 = (): void => {
			if (!this.v11) throw notFound('No such endpoint. The contract is served at /openapi.json.')
		}
		const ok = { ok: true }

		if (method === 'GET') {
			switch (key) {
				case 'GET status':
					return this.snapshot('show')
				case 'GET timers':
					return this.snapshot('timers')
				case 'GET audio':
					return this.audio
				case 'GET transport':
					return this.transport
				case 'GET outputs':
					return this.outputs
				case 'GET scheduler':
					return this.scheduler
				case 'GET timecode':
					return this.snapshot('timecode')
				case 'GET show/lock':
					return this.lock
				case 'GET follow':
					return this.follow
				case 'GET midi/devices':
					return this.midi
				case 'GET inputs/video':
					return this.v11 ? this.videoInputs : this.videoInputs.map(({ live: _live, ...input }) => input)
				case 'GET inputs/audio':
					return this.#strips(this.inputs)
				case 'GET audio/mixes':
					return this.#strips(this.mixes)
				case 'GET library':
					return this.snapshot('library')
				case 'GET capture':
					need11()
					return this.capture
				case 'GET audio/mixer':
					need11()
					return this.snapshot('mixer')
				case 'GET service-tracking':
					need11()
					return this.serviceTracking
				case 'GET action-combos':
					need11()
					return this.combos
			}
			if (area === 'library' && a) {
				const list = this.library[a]
				if (!list) throw badRequest(`Unknown document kind '${a}'.`)
				return list
			}
			throw notFound('No such endpoint. The contract is served at /openapi.json.')
		}

		if (method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.')
		if (this.options.scope === 'view')
			throw new HttpError(403, 'insufficient_scope', 'This endpoint requires the control scope.')

		switch (area) {
			case 'show':
				return this.#showCommand(a, body, need11) ?? ok
			case 'media': {
				const media = this.library.media.find((candidate) => candidate.id === a)
				if (!media || b !== 'fire') throw notFound(`No media item '${a}'.`)
				this.mediaLayers = { ...this.mediaLayers, videos: { mediaId: media.id, mediaName: media.name, loops: false } }
				this.transport = [
					{
						mediaId: media.id,
						name: media.name,
						layer: 'videos',
						playing: true,
						looping: false,
						position: 0,
						duration: 120,
					},
				]
				this.push('show')
				this.push('transport')
				return ok
			}
			case 'transport': {
				const row = this.transport.find((candidate) => candidate.mediaId === a)
				if (!row) throw notFound(`No playing video '${a}'.`)
				const action = word(body.action)
				if (action === 'pause') row.playing = false
				else if (action === 'resume') row.playing = true
				else if (action === 'toggle') row.playing = !row.playing
				else if (action === 'reset') row.position = 0
				else if (action === 'seek') row.position = Number(body.position ?? 0)
				else throw badRequest(`Unknown action '${action}'.`)
				this.push('transport')
				return ok
			}
			case 'overlays': {
				const overlay = this.library.overlays.find((candidate) => candidate.id === a)
				if (!overlay) throw notFound(`No overlay '${a}'.`)
				const live = this.overlays.some((candidate) => candidate.id === a)
				if (b === 'toggle') need11()
				else if (b !== 'fire' && b !== 'dismiss') throw notFound('No such endpoint.')
				const show = b === 'fire' || (b === 'toggle' && !live)
				this.overlays = this.overlays.filter((candidate) => candidate.id !== a)
				if (show) this.overlays.push({ id: overlay.id, name: overlay.name, layer: 'overlays' })
				this.push('show')
				return ok
			}
			case 'alerts':
				if (a === 'dismiss') {
					this.alert = undefined
				} else if (a === 'fire') {
					const preset = this.library['alert-presets'].find((candidate) => candidate.id === body.presetId)
					if (body.presetId && !preset) throw notFound(`No alert preset '${word(body.presetId)}'.`)
					const tokens = (body.tokens ?? {}) as Record<string, string>
					const filled = Object.values(tokens).join(' ')
					this.alert = {
						id: preset?.id ?? 'adhoc',
						message: preset ? `${preset.name}${filled ? ` ${filled}` : ''}` : word(body.message),
						behavior: word(body.behavior, 'persist'),
						target: word(body.target, 'confidence'),
						layer: 'alerts',
					}
				} else {
					throw notFound('No such endpoint.')
				}
				this.push('show')
				return ok
			case 'timers':
				this.#timerCommand(a, b, body, need11)
				this.push('timers')
				return ok
			case 'audio':
				return this.#audioCommand(a, b, c, body, need11) ?? ok
			case 'inputs':
				if (a === 'video' && c === 'fire') {
					need11()
					if (!this.videoInputs.some((input) => input.id === b)) throw notFound(`No video input '${b}'.`)
					this.videoInputs = this.videoInputs.map((input) => ({ ...input, live: input.id === b }))
					this.mediaLayers = { ...this.mediaLayers, videoInput: { mediaId: b, mediaName: 'Input' } }
					this.push('show')
					this.push('inputs')
					return ok
				}
				if (a === 'audio' && c === 'mixer') {
					this.#mixerCommand(this.inputs, b, body, 'audio input')
					return ok
				}
				throw notFound('No such endpoint.')
			case 'output-presets': {
				if (b !== 'activate') throw notFound('No such endpoint.')
				if (a !== 'none' && !this.outputs.presets.some((preset) => preset.id === a))
					throw notFound(`No output preset '${a}'.`)
				this.outputs = {
					...this.outputs,
					presets: this.outputs.presets.map((preset) => ({ ...preset, active: preset.id === a })),
				}
				this.push('outputs')
				return ok
			}
			case 'outputs':
				need11()
				if (a !== 'identify') throw notFound('No such endpoint.')
				return ok
			case 'confidence': {
				need11()
				if (a !== 'screens' || c !== 'layout') throw notFound('No such endpoint.')
				if (b !== 'screen-stage') throw notFound(`No Confidence Monitor screen '${b}'.`)
				const layout = body.layoutId
				if (layout && !this.library['confidence-layouts'].some((candidate) => candidate.id === layout)) {
					throw notFound(`No confidence layout with id '${word(layout)}'.`)
				}
				this.confidenceLayout = typeof layout === 'string' ? layout : undefined
				this.push('show')
				return ok
			}
			case 'capture': {
				need11()
				const side = a === 'recording' ? this.capture.recording : a === 'streaming' ? this.capture.streaming : undefined
				if (!side || !['start', 'stop', 'toggle'].includes(b)) throw notFound('No such endpoint.')
				const active = b === 'start' || (b === 'toggle' && !side.active)
				const preset = this.library['stream-presets'].find((candidate) => candidate.id === body.presetId)
				const next = active
					? {
							active: true,
							startedAt: side.active ? side.startedAt : new Date().toISOString(),
							presetId: preset?.id ?? 'stream-youtube',
							presetName: preset?.name ?? 'YouTube 1080p',
						}
					: { active: false }
				this.capture = { ...this.capture, [a]: next }
				this.push('capture')
				return ok
			}
			case 'action-combos':
				if (b !== 'fire' || !this.library['action-combos'].some((combo) => combo.id === a))
					throw notFound(`No action combo '${a}'.`)
				return ok
			case 'scheduler':
				if (a === 'enabled') {
					this.scheduler = { ...this.scheduler, enabled: body.enabled === true }
				} else if (a === 'triggers') {
					const trigger = this.scheduler.triggers.find((candidate) => candidate.id === b)
					if (!trigger) throw notFound(`No trigger '${b}'.`)
					if (c === 'enabled') trigger.enabled = body.enabled === true
					else if (c !== 'fire') throw notFound('No such endpoint.')
				} else {
					throw notFound('No such endpoint.')
				}
				this.push('scheduler')
				return ok
			case 'midi': {
				const device = this.midi.find((candidate) => candidate.id === b)
				if (a !== 'devices' || c !== 'enabled' || !device) throw notFound(`No MIDI device '${b}'.`)
				device.enabled = body.enabled === true
				return ok
			}
			case 'services':
				if (b !== 'select' || !this.library.services.some((service) => service.id === a))
					throw notFound(`No service '${a}'.`)
				this.currentServiceId = a
				this.push('show')
				return ok
			case 'service-tracking':
				need11()
				if (a !== 'start') throw notFound('No such endpoint.')
				this.serviceTracking = { ...this.serviceTracking, state: 'running', startedAt: new Date().toISOString() }
				this.push('serviceTracking')
				return ok
			case 'timeline': {
				need11()
				const action = word(body.action)
				if (!['play', 'stop', 'rewind'].includes(action)) throw badRequest(`Unknown action '${action}'.`)
				this.timeline = action === 'play' ? 'playing' : 'stopped'
				this.push('timecode')
				return ok
			}
			case 'follow':
				if (a === 'takeover') this.follow = { role: 'inCharge', name: 'Booth Mac' }
				else if (a === 'handback') this.follow = { role: 'backingUp', name: 'Booth Mac', health: 'live' }
				else if (a === 'takeback') this.follow = { role: 'none' }
				else throw notFound('No such endpoint.')
				this.#fire('role')
				return ok
		}
		throw notFound('No such endpoint. The contract is served at /openapi.json.')
	}

	#showCommand(command: string, body: Record<string, unknown>, need11: () => void): unknown {
		const deck = this.deck
		switch (command) {
			case 'advance': {
				const steps = Number(body.steps ?? 1)
				if (!deck) throw badRequest('Nothing to advance.')
				this.slideIndex = Math.max(0, Math.min(deck.slideCount - 1, this.slideIndex + steps))
				break
			}
			case 'slide': {
				const target = body.serviceItemId ? this.deck : DECKS.find((candidate) => candidate.id === body.presentationId)
				if (!target) throw notFound('Provide serviceItemId, or a presentationId that exists.')
				const index = Number(body.occurrence ?? body.slideIndex ?? 0)
				if (!(index >= 0 && index < target.slideCount)) {
					throw badRequest(`Slide index ${index} is out of range (${target.slideCount} slides).`)
				}
				this.deck = target
				this.slideIndex = index
				if (!body.serviceItemId) this.serviceItemId = undefined
				break
			}
			case 'clear': {
				const target = word(body.function ?? body.layer)
				if (!this.#clear(target, body.function === undefined)) {
					throw badRequest(`Unknown ${body.function === undefined ? 'layer' : 'function'} '${target}'.`)
				}
				break
			}
			case 'clear-all':
				for (const target of ['slides', 'media', 'overlays', 'audio', 'alerts', 'inputs']) this.#clear(target, false)
				break
			case 'lock':
				if (typeof body.locked === 'boolean') {
					this.lock = { ...this.lock, locked: body.locked, automatic: false }
					this.#fire('lock', { locked: body.locked })
				}
				if (body.pullUpdates === true) {
					this.lock = { ...this.lock, waitingUpdates: 0, waiting: undefined }
					this.#fire('lock', { locked: this.lock.locked })
				}
				return undefined
			case 'advance-item':
				need11()
				this.itemIndex = Math.max(0, Math.min(this.items.length - 1, this.itemIndex + Number(body.steps ?? 1)))
				break
			case 'service-item':
				need11()
				break
			default:
				throw notFound('No such endpoint. The contract is served at /openapi.json.')
		}
		this.push('show')
		return undefined
	}

	#clear(target: string, isLayer: boolean): boolean {
		const dropLayers = (keep: (layer: string) => boolean): void => {
			this.mediaLayers = Object.fromEntries(Object.entries(this.mediaLayers).filter(([layer]) => keep(layer)))
		}
		if (isLayer) {
			if (!['videoInput', 'loopingVideos', 'stillGraphics', 'videos', 'slide', 'overlays', 'alerts'].includes(target))
				return false
			if (target === 'slide') this.deck = undefined
			else if (target === 'overlays') this.overlays = []
			else if (target === 'alerts') this.alert = undefined
			else dropLayers((layer) => layer !== target)
			if (target === 'videos' || target === 'loopingVideos') {
				this.transport = this.transport.filter((row) => row.layer !== target)
				this.push('transport')
			}
			return true
		}
		switch (target) {
			case 'slides':
				this.deck = undefined
				return true
			case 'media':
				dropLayers((layer) => layer === 'videoInput')
				this.transport = []
				this.push('transport')
				return true
			case 'overlays':
				this.overlays = []
				return true
			case 'audio':
				this.audio = { buses: [] }
				this.push('audio')
				return true
			case 'alerts':
				this.alert = undefined
				return true
			case 'inputs':
				dropLayers((layer) => layer !== 'videoInput')
				this.videoInputs = this.videoInputs.map((input) => ({ ...input, live: false }))
				this.push('inputs')
				return true
		}
		return false
	}

	#timerCommand(id: string, command: string, body: Record<string, unknown>, need11: () => void): void {
		const timer = this.timers.find((candidate) => candidate.id === id)
		if (!timer) throw notFound(`No timer '${id}'.`)
		const now = new Date().toISOString()
		const play = (): void => {
			if (timer.running) return
			timer.running = true
			timer.runningSince = now
			if (this.v11) timer.started = true
		}
		const pause = (): void => {
			if (!timer.running) return
			timer.bankedSeconds = this.#elapsed(timer)
			timer.running = false
			timer.runningSince = undefined
		}
		switch (command) {
			case 'play':
				play()
				return
			case 'pause':
				pause()
				return
			case 'toggle':
				need11()
				if (timer.running) pause()
				else play()
				return
			case 'reset':
				timer.running = false
				timer.runningSince = undefined
				timer.bankedSeconds = 0
				// Reset returns to the length the timer had before it was started.
				timer.durationSeconds = this.lengths.get(id) ?? timer.durationSeconds
				if (this.v11) timer.started = false
				return
			case 'configure': {
				need11()
				if (typeof body.mode === 'string') timer.mode = body.mode as TimerStatus['mode']
				if (typeof body.durationSeconds === 'number') {
					timer.durationSeconds = body.durationSeconds
					this.lengths.set(id, body.durationSeconds)
				}
				if (typeof body.hour === 'number') {
					const target = new Date()
					target.setHours(body.hour, typeof body.minute === 'number' ? body.minute : 0, 0, 0)
					if (target.getTime() < Date.now()) target.setDate(target.getDate() + 1)
					timer.targetTime = target.toISOString()
					timer.armedAt = now
				}
				return
			}
			case 'adjust': {
				need11()
				const seconds = Number(body.seconds)
				if (!Number.isFinite(seconds)) throw badRequest('Provide seconds.')
				if (id === 'timer-service')
					throw new HttpError(409, 'permanent_timer', 'A service-tracking timer cannot be adjusted.')
				const length = Math.max(this.#elapsed(timer), (timer.durationSeconds ?? 0) + seconds)
				timer.durationSeconds = length
				// Before the timer is started the change is its new length; while it runs, it is for this run only.
				if (!timer.started) this.lengths.set(id, length)
				return
			}
		}
		throw notFound('No such endpoint.')
	}

	#audioCommand(a: string, b: string, c: string, body: Record<string, unknown>, need11: () => void): unknown {
		if (a === 'playlists' && c === 'fire') {
			const playlist = this.library.playlists.find((candidate) => candidate.id === b)
			if (!playlist) throw notFound(`No playlist '${b}'.`)
			this.audio = {
				buses: [
					{
						playlistId: b,
						trackName: `${playlist.name} 1`,
						playing: true,
						position: 0,
						duration: 200,
						entryId: 'entry-1',
					},
				],
			}
		} else if (a === 'items' && c === 'fire') {
			const item = this.library.audio.find((candidate) => candidate.id === b)
			if (!item) throw notFound(`No audio item '${b}'.`)
			this.audio = { buses: [{ audioItemId: b, trackName: item.name, playing: true, position: 0, duration: 8 }] }
		} else if (a === 'stop') {
			this.audio = { buses: [] }
		} else if (a === 'transport') {
			const bus = this.audio.buses[0]
			const action = word(body.action)
			if (!['playPause', 'next', 'previous', 'seek'].includes(action)) throw badRequest(`Unknown action '${action}'.`)
			if (bus) {
				if (action === 'playPause') bus.playing = !bus.playing
				else if (action === 'seek') bus.position = Number(body.position ?? 0)
				else bus.trackName = `${bus.trackName?.replace(/ \d+$/, '')} ${action === 'next' ? 2 : 1}`
			}
		} else if (a === 'mixes' && c === 'mixer') {
			need11()
			this.#mixerCommand(this.mixes, b, body, 'mix')
			return undefined
		} else if (a === 'outputs' && c === 'mixer') {
			need11()
			this.#mixerCommand(this.audioOutputs, b, body, 'audio output')
			return undefined
		} else {
			throw notFound('No such endpoint.')
		}
		this.push('audio')
		return undefined
	}

	#mixerCommand(
		strips: { id: string; gain: number; muted: boolean; enabled?: boolean; live?: boolean }[],
		id: string,
		body: Record<string, unknown>,
		what: string,
	): void {
		const strip = strips.find((candidate) => candidate.id === id)
		if (!strip) throw notFound(`No ${what} '${id}'.`)
		if (typeof body.gain === 'number') strip.gain = Math.min(1, Math.max(0, body.gain))
		if (typeof body.muted === 'boolean') strip.muted = body.muted
		if (typeof body.enabled === 'boolean') {
			strip.enabled = body.enabled
			strip.live = body.enabled
		}
		this.push('mixer')
	}

	#fire(kind: string, extra: Record<string, unknown> = {}): void {
		this.#publish('fires', { seq: ++this.#fireSeq, at: Date.now() / 1000, source: { kind: 'api' }, kind, ...extra })
	}

	// MARK: HTTP

	#authorised(request: IncomingMessage): boolean {
		return request.headers.authorization === `Bearer ${this.options.key}`
	}

	async #http(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const send = (status: number, body: unknown): void => {
			response.writeHead(status, { 'Content-Type': 'application/json' })
			response.end(JSON.stringify(body))
		}
		const url = new URL(request.url ?? '/', 'http://fake')
		if (url.pathname === '/v1/ping') {
			send(200, {
				name: 'Fake Booth Mac',
				product: this.options.product,
				apiVersion: this.options.apiVersion,
				schemaVersion: 130,
			})
			return
		}
		if (!this.#authorised(request)) {
			send(401, { status: 401, code: 'unauthorized', message: 'Missing or invalid token.' })
			return
		}
		const picture = /^\/v1\/show\/thumbnail\/(live|next)$/.exec(url.pathname)
		if (picture && this.v11) {
			const show = this.#show()
			const present = picture[1] === 'live' ? !!show.liveSlide : show.nextSlide?.slideIndex !== undefined
			if (!present) {
				send(404, { status: 404, code: 'not_found', message: 'Nothing to picture.' })
				return
			}
			const width = Math.max(96, Math.min(960, Number(url.searchParams.get('width') ?? 480)))
			const index = picture[1] === 'live' ? this.slideIndex : this.slideIndex + 1
			this.requests.push({ method: 'GET', path: url.pathname, body: undefined })
			response.writeHead(200, { 'Content-Type': 'image/png' })
			response.end(slidePicture(width, index))
			return
		}
		const chunks: Buffer[] = []
		for await (const chunk of request) chunks.push(chunk as Buffer)
		let body: Record<string, unknown> = {}
		try {
			if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
		} catch {
			send(400, { status: 400, code: 'bad_request', message: 'Body is not JSON.' })
			return
		}
		const result = this.#run(request.method ?? 'GET', url.pathname, body)
		send(result.status, result.data)
	}

	#run(method: string, path: string, body: Record<string, unknown>): { status: number; data: unknown } {
		this.requests.push({ method, path, body })
		try {
			return { status: 200, data: this.#route(method, path, body) }
		} catch (error) {
			if (error instanceof HttpError) {
				return { status: error.status, data: { status: error.status, code: error.code, message: error.message } }
			}
			return { status: 500, data: { status: 500, code: 'internal', message: String(error) } }
		}
	}

	// MARK: WebSocket

	#upgrade(request: IncomingMessage, stream: Duplex): void {
		const key = request.headers['sec-websocket-key']
		if (!request.url?.startsWith('/v1/ws') || !key) {
			stream.end('HTTP/1.1 404 Not Found\r\n\r\n')
			return
		}
		if (!this.#authorised(request)) {
			stream.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n')
			return
		}
		const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
		stream.write(
			`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
		)
		const socket: Socket = { stream, topics: new Set(), buffer: Buffer.alloc(0) }
		this.#sockets.add(socket)
		stream.on('data', (chunk: Buffer) => this.#read(socket, chunk))
		stream.on('error', () => undefined)
		stream.on('close', () => {
			this.#sockets.delete(socket)
			this.#updateMeters()
		})
		this.#send(socket, { type: 'hello', scope: this.options.scope })
	}

	/** Reads whole frames from what has arrived; a frame split across chunks waits for the rest. */
	#read(socket: Socket, chunk: Buffer): void {
		socket.buffer = Buffer.concat([socket.buffer, chunk])
		for (;;) {
			const data = socket.buffer
			if (data.length < 2) return
			const opcode = data[0] & 0x0f
			const masked = (data[1] & 0x80) !== 0
			let length = data[1] & 0x7f
			let offset = 2
			if (length === 126) {
				if (data.length < 4) return
				length = data.readUInt16BE(2)
				offset = 4
			} else if (length === 127) {
				if (data.length < 10) return
				length = Number(data.readBigUInt64BE(2))
				offset = 10
			}
			const maskAt = offset
			if (masked) offset += 4
			if (data.length < offset + length) return
			const payload = Buffer.from(data.subarray(offset, offset + length))
			if (masked) {
				for (let index = 0; index < payload.length; index++) payload[index] ^= data[maskAt + (index % 4)]
			}
			socket.buffer = data.subarray(offset + length)
			if (opcode === 0x8) {
				socket.stream.end(Buffer.from([0x88, 0x00]))
				return
			}
			if (opcode === 0x9) socket.stream.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]))
			if (opcode === 0x1) this.#message(socket, payload.toString('utf8'))
		}
	}

	#send(socket: Socket, frame: object): void {
		if (socket.stream.destroyed) return
		const payload = Buffer.from(JSON.stringify(frame), 'utf8')
		let header: Buffer
		if (payload.length < 126) {
			header = Buffer.from([0x81, payload.length])
		} else if (payload.length < 65536) {
			header = Buffer.alloc(4)
			header[0] = 0x81
			header[1] = 126
			header.writeUInt16BE(payload.length, 2)
		} else {
			header = Buffer.alloc(10)
			header[0] = 0x81
			header[1] = 127
			header.writeBigUInt64BE(BigInt(payload.length), 2)
		}
		socket.stream.write(Buffer.concat([header, payload]))
	}

	#publish(topic: string, data: unknown): void {
		for (const socket of this.#sockets) {
			if (socket.topics.has(topic)) this.#send(socket, { type: 'event', topic, data })
		}
	}

	#message(socket: Socket, text: string): void {
		let frame: {
			type?: string
			topics?: string[]
			id?: string
			method?: string
			path?: string
			body?: Record<string, unknown>
		}
		try {
			frame = JSON.parse(text) as typeof frame
		} catch {
			this.#send(socket, { type: 'error', message: 'Unparseable frame.' })
			return
		}
		if (this.#silent) return
		switch (frame.type) {
			case 'ping':
				if (!this.#frozen) this.#beat++
				this.#send(socket, { type: 'pong', beat: this.#beat })
				return
			case 'subscribe':
			case 'unsubscribe': {
				const known = ['show', 'timers', 'audio', 'transport', 'outputs', 'library', 'scheduler', 'timecode', 'fires']
				if (this.v11) known.push('inputs', 'capture', 'mixer', 'serviceTracking', 'meters')
				const topics = (frame.topics ?? known).filter((topic) => known.includes(topic))
				for (const topic of topics) {
					if (frame.type === 'subscribe') socket.topics.add(topic)
					else socket.topics.delete(topic)
				}
				this.#send(socket, { type: 'subscribed', topics: [...socket.topics] })
				// From 1.1, each subscribed topic's state follows at once (not the two that are streams).
				if (this.v11 && frame.type === 'subscribe') {
					for (const topic of topics) {
						if (topic !== 'fires' && topic !== 'meters')
							this.#send(socket, { type: 'event', topic, data: this.snapshot(topic) })
					}
				}
				this.#updateMeters()
				return
			}
			case 'command': {
				const result = this.#run(frame.method ?? '', frame.path ?? '', frame.body ?? {})
				this.#send(socket, { type: 'result', id: frame.id ?? '', status: result.status, data: result.data })
				return
			}
			default:
				this.#send(socket, { type: 'error', message: `Unknown frame type '${frame.type}'.` })
		}
	}

	/** Meters run only while someone is subscribed to them, about ten times a second. */
	#updateMeters(): void {
		const wanted = [...this.#sockets].some((socket) => socket.topics.has('meters'))
		if (wanted && !this.#meterTimer) {
			this.#meterTimer = setInterval(() => this.#publish('meters', this.meters(Date.now())), 100)
		} else if (!wanted && this.#meterTimer) {
			clearInterval(this.#meterTimer)
			this.#meterTimer = undefined
		}
	}

	/** Levels that move like speech and music: one frame of the `meters` topic. */
	meters(now: number): Record<string, Record<string, { peak: number[]; rms: number[] }>> {
		const level = (seed: number, base: number, channels: number): { peak: number[]; rms: number[] } => {
			const peak = Array.from({ length: channels }, (_, channel) => {
				const wave = Math.sin(now / 310 + seed * 1.7 + channel) + Math.sin(now / 127 + seed * 3.1)
				return Math.round((base + wave * 7) * 10) / 10
			})
			return { peak, rms: peak.map((value) => value - 9) }
		}
		const group = (
			strips: { id: string; muted: boolean; live?: boolean }[],
			base: number,
			channels: number,
		): Record<string, { peak: number[]; rms: number[] }> =>
			Object.fromEntries(
				strips.map((strip, index) => [
					strip.id,
					strip.muted || strip.live === false
						? { peak: Array(channels).fill(-90) as number[], rms: Array(channels).fill(-90) as number[] }
						: level(index + 1, base - index * 4, channels),
				]),
			)
		return {
			inputs: group(this.inputs, -14, 1),
			mixes: group(this.mixes, -10, 2),
			outputs: group(this.audioOutputs, -12, 2),
		}
	}
}
