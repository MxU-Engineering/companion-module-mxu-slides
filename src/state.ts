import type {
	ActionComboEntry,
	AudioInputStatus,
	AudioMixStatus,
	AudioOutputStatus,
	AudioStatus,
	CaptureStatus,
	FollowStatus,
	LibraryEntry,
	LibraryKind,
	LockStatus,
	MeterLevels,
	MetersFrame,
	MidiDeviceStatus,
	MixerKind,
	MixerStatus,
	OutputsStatus,
	SchedulerStatus,
	ServerInfo,
	ServiceTrackingStatus,
	ShowStatus,
	TimecodeStatus,
	TimerStatus,
	TransportRow,
	VideoInputStatus,
} from './api/types.js'
import { LIBRARY_KINDS } from './api/types.js'
import { clockCorrection } from './time.js'

/**
 * A part of what MxU Slides reports. Each push is split into these so the module rechecks only
 * the feedbacks that read the part that actually changed.
 */
export type Aspect =
	| 'slide'
	| 'next'
	| 'sections'
	| 'layers'
	| 'overlays'
	| 'alert'
	| 'service'
	| 'confidence'
	| 'timers'
	| 'music'
	| 'transport'
	| 'outputs'
	| 'scheduler'
	| 'timecode'
	| 'lock'
	| 'follow'
	| 'midi'
	| 'videoInputs'
	| 'mixer'
	| 'meters'
	| 'capture'
	| 'serviceTracking'
	| 'library'
	| 'pictures'
	| 'health'

export interface MixerStrip {
	id: string
	name: string
	gain: number
	gainDb?: number
	muted: boolean
	/** Inputs only: switched on and heard through the mixer right now. */
	live?: boolean
	/** Inputs only: the operator's own on-air switch. */
	enabled?: boolean
}

const FLOOR_DB = -90

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

function emptyLibrary(): Record<LibraryKind, LibraryEntry[]> {
	const library = {} as Record<LibraryKind, LibraryEntry[]>
	for (const kind of LIBRARY_KINDS) library[kind] = []
	return library
}

/** Everything the module knows about one MxU Slides, and what changed with each update. */
export class SlidesState {
	info: ServerInfo | undefined
	scope = ''
	show: ShowStatus | undefined
	timers: TimerStatus[] = []
	audio: AudioStatus | undefined
	audioAt = 0
	transport: TransportRow[] = []
	transportAt = 0
	outputs: OutputsStatus | undefined
	scheduler: SchedulerStatus | undefined
	timecode: TimecodeStatus | undefined
	lock: LockStatus | undefined
	follow: FollowStatus | undefined
	midi: MidiDeviceStatus[] = []
	videoInputs: VideoInputStatus[] = []
	inputs: AudioInputStatus[] = []
	mixes: AudioMixStatus[] = []
	audioOutputs: AudioOutputStatus[] = []
	meters: MetersFrame = {}
	capture: CaptureStatus | undefined
	serviceTracking: ServiceTrackingStatus | undefined
	library: Record<LibraryKind, LibraryEntry[]> = emptyLibrary()
	combos: ActionComboEntry[] = []
	pictures: { live: string | null; next: string | null } = { live: null, next: null }
	responding = true
	/** Milliseconds to add to this computer's clock to read the clock Slides runs on. */
	clockOffset = 0

	/** The time on the clock MxU Slides stamps its anchors with. */
	now(): number {
		return Date.now() + this.clockOffset
	}

	/** Takes one topic's push (or the matching read) and returns the parts that changed. */
	apply(topic: string, data: unknown, receivedAt = Date.now()): Aspect[] {
		switch (topic) {
			case 'show':
				return this.#applyShow(data as ShowStatus)
			case 'timers': {
				const timers = (data as TimerStatus[] | undefined) ?? []
				const correction = clockCorrection(timers, receivedAt)
				if (correction !== undefined) this.clockOffset = correction
				if (same(timers, this.timers)) return []
				this.timers = timers
				return ['timers']
			}
			case 'audio': {
				const audio = data as AudioStatus
				const changed = !same(audio, this.audio)
				this.audio = audio
				this.audioAt = receivedAt
				return changed ? ['music'] : []
			}
			case 'transport': {
				const rows = (data as TransportRow[] | undefined) ?? []
				const changed = !same(rows, this.transport)
				this.transport = rows
				this.transportAt = receivedAt
				return changed ? ['transport'] : []
			}
			case 'outputs':
				return this.#set('outputs', data as OutputsStatus, 'outputs')
			case 'scheduler':
				return this.#set('scheduler', data as SchedulerStatus, 'scheduler')
			case 'timecode':
				return this.#set('timecode', data as TimecodeStatus, 'timecode')
			case 'capture':
				return this.#set('capture', data as CaptureStatus, 'capture')
			case 'serviceTracking':
				return this.#set('serviceTracking', data as ServiceTrackingStatus, 'serviceTracking')
			case 'lock':
				return this.#set('lock', data as LockStatus, 'lock')
			case 'follow':
				return this.#set('follow', data as FollowStatus, 'follow')
			case 'midi':
				return this.#set('midi', (data as MidiDeviceStatus[] | undefined) ?? [], 'midi')
			case 'inputs':
				return this.#set('videoInputs', (data as VideoInputStatus[] | undefined) ?? [], 'videoInputs')
			case 'mixer': {
				const mixer = data as Partial<MixerStatus>
				return this.applyMixer(mixer.inputs, mixer.mixes, mixer.outputs)
			}
			case 'meters':
				this.meters = (data as MetersFrame | undefined) ?? {}
				return ['meters']
			default:
				return []
		}
	}

	/** Any of the three mixer lists; an absent list is left as it is. */
	applyMixer(inputs?: AudioInputStatus[], mixes?: AudioMixStatus[], outputs?: AudioOutputStatus[]): Aspect[] {
		let changed = false
		if (inputs && !same(inputs, this.inputs)) {
			this.inputs = inputs
			changed = true
		}
		if (mixes && !same(mixes, this.mixes)) {
			this.mixes = mixes
			changed = true
		}
		if (outputs && !same(outputs, this.audioOutputs)) {
			this.audioOutputs = outputs
			changed = true
		}
		return changed ? ['mixer'] : []
	}

	applyLibrary(kind: LibraryKind, entries: LibraryEntry[]): Aspect[] {
		if (same(entries, this.library[kind])) return []
		this.library[kind] = entries
		return ['library']
	}

	applyCombos(combos: ActionComboEntry[]): Aspect[] {
		if (same(combos, this.combos)) return []
		this.combos = combos
		return ['library']
	}

	applyPicture(which: 'live' | 'next', picture: string | null): Aspect[] {
		if (this.pictures[which] === picture) return []
		this.pictures[which] = picture
		return ['pictures']
	}

	applyResponding(responding: boolean): Aspect[] {
		if (this.responding === responding) return []
		this.responding = responding
		return ['health']
	}

	/** Forgets everything, as on a disconnect. */
	reset(): void {
		Object.assign(this, new SlidesState())
	}

	strips(kind: MixerKind): MixerStrip[] {
		return kind === 'input' ? this.inputs : kind === 'mix' ? this.mixes : this.audioOutputs
	}

	strip(kind: MixerKind, id: string): MixerStrip | undefined {
		return this.strips(kind).find((strip) => strip.id === id)
	}

	/** A strip's meter in dBFS: the loudest channel, or one channel when asked. Floor when silent. */
	meter(kind: MixerKind, id: string, channel?: number, measure: 'peak' | 'rms' = 'peak'): number {
		const group = kind === 'input' ? this.meters.inputs : kind === 'mix' ? this.meters.mixes : this.meters.outputs
		const levels: MeterLevels | undefined = group?.[id]
		const values = levels?.[measure]
		if (!values?.length) return FLOOR_DB
		if (channel !== undefined) return values[Math.min(channel, values.length - 1)] ?? FLOOR_DB
		return Math.max(...values)
	}

	#applyShow(show: ShowStatus | undefined): Aspect[] {
		const before = this.show
		this.show = show
		const changed: Aspect[] = []
		if (!same(show?.liveSlide, before?.liveSlide)) changed.push('slide')
		if (!same([show?.nextSlide, show?.nextSlideText], [before?.nextSlide, before?.nextSlideText])) changed.push('next')
		if (!same(show?.sections, before?.sections)) changed.push('sections')
		if (!same(show?.mediaLayers, before?.mediaLayers)) changed.push('layers')
		if (!same(show?.overlays, before?.overlays)) changed.push('overlays')
		if (!same(show?.alert, before?.alert)) changed.push('alert')
		if (
			!same(
				[show?.service, show?.currentServiceId, show?.position],
				[before?.service, before?.currentServiceId, before?.position],
			)
		) {
			changed.push('service')
		}
		if (!same(show?.confidence, before?.confidence)) changed.push('confidence')
		return changed
	}

	#set<K extends keyof SlidesState>(key: K, value: SlidesState[K], aspect: Aspect): Aspect[] {
		return assign(this, key, value) ? [aspect] : []
	}
}

/** Stores one field; false when it already held the same value. */
function assign<K extends keyof SlidesState>(state: SlidesState, key: K, value: SlidesState[K]): boolean {
	if (same(value, state[key])) return false
	state[key] = value
	return true
}

/** Fader position (0 to 1) as dB, the way a mixer strip reads it. Slides sends `gainDb` from 1.1. */
export function stripDb(strip: { gain: number; gainDb?: number }): number {
	if (typeof strip.gainDb === 'number') return strip.gainDb
	return strip.gain <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(strip.gain))
}

export function dbToGain(db: number): number {
	return db <= -60 ? 0 : Math.min(1, 10 ** (db / 20))
}

/** `-6.0`, `0.0`, and `-inf` for a fader all the way down. */
export function formatDb(db: number): string {
	if (db <= -60) return '-inf'
	const rounded = Math.round(db * 10) / 10
	return Object.is(rounded, -0) ? '0.0' : rounded.toFixed(1)
}

/** What a strip's pill says. */
export function stripState(strip: MixerStrip): 'on' | 'muted' | 'off' {
	if (strip.muted) return 'muted'
	return strip.live === false ? 'off' : 'on'
}

/**
 * The ids and names every list of choices, variable definition and preset is built from. When
 * this string changes, the lists are rebuilt; when it does not, nothing is redefined.
 */
export function shapeKey(state: SlidesState): string {
	const names = (items: { id: string; name: string }[] | undefined): string[][] =>
		(items ?? []).map((item) => [item.id, item.name])
	return JSON.stringify([
		state.info?.apiVersion,
		names(state.timers),
		names(state.inputs),
		names(state.mixes),
		names(state.audioOutputs),
		names(state.videoInputs),
		names(state.midi),
		names(state.outputs?.presets),
		names(state.outputs?.screens),
		names(state.show?.confidence?.screens),
		names(state.scheduler?.triggers),
		state.library,
		state.combos,
	])
}
