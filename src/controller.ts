import {
	InstanceStatus,
	type CompanionActionDefinitions,
	type CompanionFeedbackDefinitions,
	type CompanionGraphicsCompositeElementDefinitions,
	type CompanionPresetDefinitions,
	type CompanionPresetSection,
	type CompanionVariableDefinitions,
	type LogLevel,
} from '@companion-module/base'
import { GetActions, type ActionsSchema } from './actions.js'
import { LinkError, SlidesClient, SlidesError, type ClientStatus, type ClientTiming } from './api/client.js'
import {
	LIBRARY_KINDS,
	type ActionComboEntry,
	type FireEvent,
	type LibraryEntry,
	type ServerInfo,
} from './api/types.js'
import { target, type ModuleConfig, type ModuleSecrets } from './config.js'
import type { Refreshable, SlidesContext } from './context.js'
import { GetCompositeElements, type CompositeElementsSchema } from './elements.js'
import { CLOCK_FEEDBACKS, feedbacksFor, GetFeedbacks, type FeedbackId, type FeedbacksSchema } from './feedbacks.js'
import { GetPresets } from './presets.js'
import { shapeKey, SlidesState, type Aspect } from './state.js'
import { timerIsTicking } from './time.js'
import type { ModuleSchema } from './main.js'
import {
	changedValues,
	GetVariableDefinitions,
	GetVariableValues,
	type VariablesSchema,
	type VariableValue,
} from './variables.js'

/**
 * What the controller needs from Companion. The module instance is one; the tests pass their own
 * and read back what was defined, set and rechecked.
 */
export interface ModuleHost {
	log(level: LogLevel, message: string): void
	updateStatus(status: InstanceStatus, message?: string | null): void
	setActionDefinitions(actions: CompanionActionDefinitions<ActionsSchema>): void
	setFeedbackDefinitions(feedbacks: CompanionFeedbackDefinitions<FeedbacksSchema>): void
	setCompositeElementDefinitions(elements: CompanionGraphicsCompositeElementDefinitions<CompositeElementsSchema>): void
	setVariableDefinitions(variables: CompanionVariableDefinitions<VariablesSchema>): void
	setPresetDefinitions(
		sections: CompanionPresetSection<ModuleSchema>[],
		presets: CompanionPresetDefinitions<ModuleSchema>,
	): void
	setVariableValues(values: Partial<VariablesSchema>): void
	checkFeedbacks(first: FeedbackId, ...rest: FeedbackId[]): void
	checkAllFeedbacks(): void
}

/** What each topic's state is read from when MxU Slides does not send it on subscribe. */
const TOPIC_READS: [topic: string, path: string, needs?: string][] = [
	['show', '/v1/status'],
	['timers', '/v1/timers'],
	['audio', '/v1/audio'],
	['transport', '/v1/transport'],
	['outputs', '/v1/outputs'],
	['scheduler', '/v1/scheduler'],
	['timecode', '/v1/timecode'],
	['inputs', '/v1/inputs/video'],
	['capture', '/v1/capture', '1.1'],
	['mixer', '/v1/audio/mixer', '1.1'],
	['serviceTracking', '/v1/service-tracking', '1.1'],
]

/** State MxU Slides has no topic for: read once on connect, and again after the module changes it. */
const PLAIN_READS: Record<Exclude<Refreshable, 'mixer'>, [topic: string, path: string]> = {
	lock: ['lock', '/v1/show/lock'],
	follow: ['follow', '/v1/follow'],
	midi: ['midi', '/v1/midi/devices'],
}

/** Every topic the module listens to. A Slides that does not know one of them leaves it out. */
const TOPICS = ['show', 'timers', 'audio', 'transport', 'outputs', 'library', 'scheduler', 'timecode', 'fires']
const TOPICS_1_1 = ['inputs', 'capture', 'mixer', 'serviceTracking']

const PICTURE_WIDTH = 288
const PICTURE_RETRIES = 3
const PICTURE_RETRY_MS = 700
const PICTURE_CACHE = 6
/** A run of quick slide changes ends in one read of the Lock, not one per slide. */
const LOCK_READ_MS = 300
/** How long a burst of changes is gathered before feedbacks and variables are updated once. */
const FLUSH_MS = 15
const REDEFINE_MS = 150
const LIBRARY_MS = 400
const SNAPSHOT_GRACE_MS = 1500
const METER_VARIABLES_MS = 500

/**
 * The module's working part: one connection to MxU Slides, the state it reports, and what
 * Companion is told about it. It never polls. Everything it starts (the client, timers) ends in
 * `stop()`.
 */
export class SlidesController implements SlidesContext {
	readonly state = new SlidesState()
	readonly #host: ModuleHost
	readonly #timing: Partial<ClientTiming> | undefined
	#config: ModuleConfig = {}
	#secrets: ModuleSecrets = {}
	#client: SlidesClient | undefined
	#pending = new Set<Aspect>()
	#flushTimer: NodeJS.Timeout | undefined
	#redefineTimer: NodeJS.Timeout | undefined
	#libraryTimer: NodeJS.Timeout | undefined
	#snapshotTimer: NodeJS.Timeout | undefined
	#lockTimer: NodeJS.Timeout | undefined
	#clock: NodeJS.Timeout | undefined
	#sent: Record<string, VariableValue> = {}
	#shape = ''
	#seenTopics = new Set<string>()
	#pictureVersions: { live?: string; next?: string } = {}
	#meterVariablesAt = 0
	#scope = ''
	#warned = new Set<string>()
	#pictureTimers = new Set<NodeJS.Timeout>()
	#pictureCache = new Map<string, string>()
	#librarySnapshotDue = false

	constructor(host: ModuleHost, timing?: Partial<ClientTiming>) {
		this.#host = host
		this.#timing = timing
	}

	/** Defines everything (with empty lists until Slides answers) and connects. */
	start(config: ModuleConfig, secrets: ModuleSecrets | undefined): void {
		this.#config = config
		this.#secrets = secrets ?? {}
		this.#define()
		this.#connect()
	}

	/** The configuration changed: drop the old connection and what it reported, and connect again. */
	restart(config: ModuleConfig, secrets: ModuleSecrets | undefined): void {
		this.#config = config
		this.#secrets = secrets ?? {}
		this.#disconnect()
		this.#forget()
		this.#connect()
	}

	/** Closes the connection and stops every timer. */
	stop(): void {
		this.#disconnect()
	}

	log(level: LogLevel, message: string): void {
		this.#host.log(level, message)
	}

	// MARK: SlidesContext

	async run(name: string, needs: string | undefined, command: (client: SlidesClient) => Promise<void>): Promise<void> {
		const client = this.#client
		if (!client?.connected) {
			this.log('warn', `${name}: not connected to MxU Slides.`)
			return
		}
		if (needs && !client.supports(needs)) {
			this.log('warn', `${name} needs a newer MxU Slides (this one has API ${client.info?.apiVersion ?? '1.0'}).`)
			return
		}
		try {
			await command(client)
		} catch (error) {
			const hint =
				error instanceof SlidesError && error.status === 403
					? ' Use an Operate key from Settings › Network & API in MxU Slides.'
					: ''
			// MxU Slides (or the module) declining in a sentence is a warning; an exchange that failed is an error.
			const failed = error instanceof LinkError || (error instanceof SlidesError && error.status >= 500)
			this.log(failed ? 'error' : 'warn', `${name}: ${error instanceof Error ? error.message : String(error)}${hint}`)
		}
	}

	refresh(what: Refreshable): void {
		const client = this.#client
		if (!client?.connected) return
		if (what === 'mixer') {
			// From API 1.1 the mixer pushes its own changes.
			if (client.supports('1.1')) return
			void this.#readMixer(client)
			return
		}
		const [topic, path] = PLAIN_READS[what]
		void this.#read(client, topic, path)
	}

	// MARK: Connection

	#connect(): void {
		const where = target(this.#config)
		const apiKey = this.#secrets.apiKey?.trim()
		if (!where) {
			this.#host.updateStatus(InstanceStatus.BadConfig, 'Choose MxU Slides on the network, or enter its address')
			return
		}
		if (!apiKey) {
			this.#host.updateStatus(InstanceStatus.BadConfig, 'Paste the API key from Settings › Network & API in MxU Slides')
			return
		}
		const topics = [...TOPICS, ...TOPICS_1_1]
		// Meters are a stream, sent only to a client that names them.
		if (this.#config.meters !== false) topics.push('meters')
		const client = new SlidesClient({
			host: where.host,
			port: where.port,
			apiKey,
			topics,
			onStatus: (status) => this.#status(client, status),
			onEvent: (topic, data) => this.#event(client, topic, data),
			onReady: (info, snapshots) => this.#ready(client, info, snapshots),
			onResponding: (responding) => {
				if (client !== this.#client) return
				this.changed(this.state.applyResponding(responding))
				this.#showConnected()
			},
			debug: (message) => this.log('debug', message),
			...(this.#timing ? { timing: this.#timing } : {}),
		})
		this.#client = client
		client.start()
	}

	/** Stops the client and every timer the module holds. */
	#disconnect(): void {
		this.#client?.stop()
		this.#client = undefined
		for (const timer of [
			this.#flushTimer,
			this.#redefineTimer,
			this.#libraryTimer,
			this.#snapshotTimer,
			this.#lockTimer,
		]) {
			clearTimeout(timer)
		}
		for (const timer of this.#pictureTimers) clearTimeout(timer)
		this.#pictureTimers.clear()
		clearInterval(this.#clock)
		this.#flushTimer =
			this.#redefineTimer =
			this.#libraryTimer =
			this.#snapshotTimer =
			this.#lockTimer =
			this.#clock =
				undefined
		this.#pending.clear()
	}

	/** Drops everything known about MxU Slides and empties every variable. */
	#forget(): void {
		this.state.reset()
		this.#seenTopics.clear()
		this.#pictureVersions = {}
		this.#pictureCache.clear()
		this.#warned.clear()
		clearInterval(this.#clock)
		this.#clock = undefined
		const cleared: Record<string, VariableValue> = {}
		for (const id of Object.keys(this.#sent)) cleared[id] = ''
		if (Object.keys(cleared).length) this.#host.setVariableValues(cleared)
		this.#sent = {}
		this.#host.checkAllFeedbacks()
	}

	#status(client: SlidesClient, status: ClientStatus): void {
		if (client !== this.#client) return
		switch (status.kind) {
			case 'connecting':
				this.#host.updateStatus(InstanceStatus.Connecting)
				return
			case 'connected':
				this.#scope = status.scope
				this.#showConnected()
				return
			case 'unauthorized':
				this.#host.updateStatus(InstanceStatus.AuthenticationFailure, 'MxU Slides did not accept the API key')
				break
			case 'wrong-product':
				this.#host.updateStatus(
					InstanceStatus.ConnectionFailure,
					`That address answers as ${status.product}, not MxU Slides`,
				)
				break
			case 'unreachable':
				this.#host.updateStatus(InstanceStatus.ConnectionFailure, `Cannot reach MxU Slides (${status.reason})`)
				break
			case 'disconnected':
				this.#host.updateStatus(InstanceStatus.Disconnected, status.reason)
				break
		}
		if (this.state.info) this.#forget()
	}

	#showConnected(): void {
		if (!this.state.responding) {
			this.#host.updateStatus(InstanceStatus.UnknownWarning, 'MxU Slides is not responding')
		} else if (this.#scope === 'view') {
			this.#host.updateStatus(
				InstanceStatus.InsufficientPermissions,
				'This is a Watch key, which can only show state. Buttons need an Operate key from Settings › Network & API in MxU Slides.',
			)
		} else {
			this.#host.updateStatus(InstanceStatus.Ok)
		}
	}

	#ready(client: SlidesClient, info: ServerInfo, snapshots: boolean): void {
		if (client !== this.#client) return
		this.state.info = info
		this.state.scope = this.#scope
		this.#librarySnapshotDue = snapshots
		this.log('info', `Connected to MxU Slides on ${info.stationName ?? info.name} (API ${info.apiVersion})`)

		const readTopics = (): void => {
			for (const [topic, path, needs] of TOPIC_READS) {
				if (this.#seenTopics.has(topic) || (needs && !client.supports(needs))) continue
				void this.#read(client, topic, path)
			}
		}
		if (snapshots) {
			// Slides sends each topic's state on subscribe; read only what has not arrived after a moment.
			this.#snapshotTimer = setTimeout(readTopics, SNAPSHOT_GRACE_MS)
		} else {
			readTopics()
			void this.#readMixer(client)
		}
		for (const [topic, path] of Object.values(PLAIN_READS)) void this.#read(client, topic, path)
		void this.#readLibrary(client)
		this.changed(['health'])
	}

	async #read(client: SlidesClient, topic: string, path: string): Promise<void> {
		try {
			const data = await client.get<unknown>(path)
			if (client !== this.#client) return
			this.#seenTopics.add(topic)
			this.changed(this.state.apply(topic, data))
		} catch (error) {
			if (client === this.#client)
				this.log('debug', `Reading ${path}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/** The mixer as API 1.0 serves it: inputs and mixes, each from its own route. */
	async #readMixer(client: SlidesClient): Promise<void> {
		try {
			const [inputs, mixes] = await Promise.all([
				client.get<never[]>('/v1/inputs/audio'),
				client.get<never[]>('/v1/audio/mixes'),
			])
			if (client !== this.#client) return
			this.changed(this.state.applyMixer(inputs, mixes))
		} catch (error) {
			if (client === this.#client)
				this.log('debug', `Reading the mixer: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	async #readLibrary(client: SlidesClient): Promise<void> {
		const reads = LIBRARY_KINDS.map(async (kind) => {
			const entries = await client.get<LibraryEntry[]>(`/v1/library/${kind}`)
			if (client === this.#client) this.changed(this.state.applyLibrary(kind, entries ?? []))
		})
		if (client.supports('1.1')) {
			reads.push(
				client.get<ActionComboEntry[]>('/v1/action-combos').then((combos) => {
					if (client === this.#client) this.changed(this.state.applyCombos(combos ?? []))
				}),
			)
		}
		const results = await Promise.allSettled(reads)
		const failed = results.find((result) => result.status === 'rejected')
		if (failed && client === this.#client) this.log('debug', `Reading the library: ${String(failed.reason)}`)
	}

	#event(client: SlidesClient, topic: string, data: unknown): void {
		if (client !== this.#client) return
		if (topic === 'library') {
			// The first frame after subscribing is the state on subscribe; the lists were read on connect.
			if (this.#librarySnapshotDue) {
				this.#librarySnapshotDue = false
				return
			}
			// The push says only that the library changed; gather a burst, then read the lists once.
			clearTimeout(this.#libraryTimer)
			this.#libraryTimer = setTimeout(() => {
				void this.#readLibrary(client)
				// Updates held behind the Lock arrive with library changes.
				this.refresh('lock')
			}, LIBRARY_MS)
			return
		}
		if (topic === 'fires') {
			const fire = data as FireEvent | undefined
			if (fire?.kind === 'lock') this.refresh('lock')
			if (fire?.kind === 'role') this.refresh('follow')
			return
		}
		this.#seenTopics.add(topic)
		this.changed(this.state.apply(topic, data))
	}

	// MARK: Updates

	/** Notes what changed; feedbacks and variables are updated once for the whole burst. */
	changed(aspects: Aspect[]): void {
		if (!aspects.length) return
		for (const aspect of aspects) this.#pending.add(aspect)
		this.#flushTimer ??= setTimeout(() => this.#flush(), FLUSH_MS)
	}

	#flush(): void {
		this.#flushTimer = undefined
		const aspects = [...this.#pending]
		this.#pending.clear()
		if (aspects.includes('slide') || aspects.includes('next')) this.#updatePictures()
		// The Lock follows the service by itself and Slides does not push it: read it when the show moves.
		if (aspects.includes('slide') || aspects.includes('service')) {
			clearTimeout(this.#lockTimer)
			this.#lockTimer = setTimeout(() => this.refresh('lock'), LOCK_READ_MS)
		}

		const shape = shapeKey(this.state)
		if (shape !== this.#shape) {
			this.#shape = shape
			clearTimeout(this.#redefineTimer)
			this.#redefineTimer = setTimeout(() => this.#define(), REDEFINE_MS)
		}

		const feedbacks = feedbacksFor(aspects)
		if (feedbacks.length) this.#check(feedbacks)

		// Meters arrive ten times a second; their variables follow at an easier pace.
		const onlyMeters = aspects.length === 1 && aspects[0] === 'meters'
		if (!onlyMeters || Date.now() - this.#meterVariablesAt >= METER_VARIABLES_MS) {
			this.#meterVariablesAt = Date.now()
			this.#updateVariables()
		}
		this.#updateClock()
	}

	#check(ids: FeedbackId[]): void {
		const [first, ...rest] = ids
		if (first) this.#host.checkFeedbacks(first, ...rest)
	}

	#updateVariables(): void {
		const values = GetVariableValues(this.state)
		const changed = changedValues(values, this.#sent)
		if (!Object.keys(changed).length) return
		this.#host.setVariableValues(changed)
		Object.assign(this.#sent, changed)
	}

	/** Lists changed: actions, feedbacks, variables and presets are rebuilt from what Slides has now. */
	#define(): void {
		this.#redefineTimer = undefined
		this.#host.setActionDefinitions(GetActions(this))
		this.#host.setFeedbackDefinitions(GetFeedbacks(this))
		this.#host.setCompositeElementDefinitions(GetCompositeElements())
		this.#host.setVariableDefinitions(GetVariableDefinitions(this.state))
		const { sections, presets } = GetPresets(this.state)
		this.#host.setPresetDefinitions(sections, presets)
		// A variable that went away with its timer or strip is forgotten; the rest are sent afresh.
		this.#sent = {}
		this.#updateVariables()
	}

	/** One clock for everything that counts: it runs only while something is counting. */
	#updateClock(): void {
		const state = this.state
		const counting =
			state.timers.some(timerIsTicking) ||
			state.transport.some((row) => row.playing) ||
			state.audio?.buses.some((bus) => bus.playing) === true ||
			state.capture?.recording.active === true ||
			state.capture?.streaming.active === true ||
			state.timecode?.anchor?.running === true
		if (counting && !this.#clock) {
			this.#clock = setInterval(() => {
				this.#check(CLOCK_FEEDBACKS)
				this.#updateVariables()
			}, 1000)
		} else if (!counting && this.#clock) {
			clearInterval(this.#clock)
			this.#clock = undefined
		}
	}

	/** Fetches a slide picture again only when Slides says it would look different. */
	#updatePictures(): void {
		const client = this.#client
		if (!client?.connected || this.#config.pictures === false || !client.supports('1.1')) return
		const show = this.state.show
		const versions = { live: show?.liveSlide?.thumbnailVersion, next: show?.nextSlide?.thumbnailVersion }
		for (const which of ['live', 'next'] as const) {
			const version = versions[which]
			if (version === this.#pictureVersions[which]) continue
			this.#pictureVersions[which] = version
			if (version === undefined) {
				this.changed(this.state.applyPicture(which, null))
				continue
			}
			// A version names one picture whether the slide is live or next, so the picture that was
			// next a moment ago is reused when its slide goes live.
			const known = this.#pictureCache.get(version)
			if (known !== undefined) {
				this.changed(this.state.applyPicture(which, known))
				continue
			}
			this.#fetchPicture(client, which, version, 0)
		}
	}

	/** Slides answers 503 while it is still drawing the picture: ask again a few times, a little later. */
	#fetchPicture(client: SlidesClient, which: 'live' | 'next', version: string, attempt: number): void {
		const current = (): boolean => client === this.#client && this.#pictureVersions[which] === version
		client
			.fetchImage(`/v1/show/thumbnail/${which}?width=${PICTURE_WIDTH}`)
			.then((picture) => {
				if (picture !== null) this.#remember(version, picture)
				// A newer slide may have gone live while this one was on its way.
				if (current()) this.changed(this.state.applyPicture(which, picture))
			})
			.catch((error: unknown) => {
				if (!current()) return
				if (error instanceof SlidesError && error.status === 503 && attempt < PICTURE_RETRIES) {
					const timer = setTimeout(() => {
						this.#pictureTimers.delete(timer)
						if (current()) this.#fetchPicture(client, which, version, attempt + 1)
					}, PICTURE_RETRY_MS)
					this.#pictureTimers.add(timer)
					return
				}
				this.#warnOnce(`picture-${which}`, 'debug', `Slide picture: ${String(error)}`)
			})
	}

	/** Keeps the last few pictures by version; the oldest goes first. */
	#remember(version: string, picture: string): void {
		this.#pictureCache.delete(version)
		this.#pictureCache.set(version, picture)
		for (const oldest of this.#pictureCache.keys()) {
			if (this.#pictureCache.size <= PICTURE_CACHE) break
			this.#pictureCache.delete(oldest)
		}
	}

	#warnOnce(key: string, level: LogLevel, message: string): void {
		if (this.#warned.has(key)) return
		this.#warned.add(key)
		this.log(level, message)
	}
}
