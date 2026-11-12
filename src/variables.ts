import type { CompanionVariableDefinitions } from '@companion-module/base'
import type { MixerKind } from './api/types.js'
import { videoRow } from './actions/media.js'
import { meterValue } from './feedbacks/audio.js'
import { showValue, slideNumber } from './feedbacks/show.js'
import { captureClock, inCharge } from './feedbacks/system.js'
import { formatDb, stripDb, stripState, type SlidesState } from './state.js'
import {
	busPosition,
	formatClock,
	formatHms,
	formatMs,
	timecodeClock,
	timerState,
	timerValue,
	transportPosition,
	wholeSeconds,
} from './time.js'

export type VariableValue = string | number | boolean
export type VariablesSchema = Record<string, VariableValue | undefined>

/** How many sections get a `section_N_name` variable, for buttons that rename themselves. */
export const SECTION_SLOTS = 8

const VIDEO_SLOTS: [slot: string, target: string, label: string][] = [
	['video', 'any', 'Video'],
	['video_foreground', 'videos', 'Foreground video'],
	['video_background', 'loopingVideos', 'Background media'],
]

const STRIP_LABEL: Record<MixerKind, string> = { input: 'Input', mix: 'Mix', output: 'Output' }

/** A name as a variable id: lowercase letters, digits and underscores. */
export function slug(name: string): string {
	return (
		name
			.normalize('NFKD')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '') || 'unnamed'
	)
}

/**
 * One id per item from its name; a second item with the same name gets `_2`, and so on.
 * `suffixes` are the endings each id gets in its variables: an id that would give a variable
 * another item already has (a timer "Sermon Name" and timer "Sermon"'s `_name`) gets a number too.
 */
export function slugs(items: { id: string; name: string }[], suffixes = ['']): Map<string, string> {
	const taken = new Set<string>()
	const result = new Map<string, string>()
	for (const item of items) {
		const base = slug(item.name)
		let id = base
		for (let count = 2; suffixes.some((suffix) => taken.has(id + suffix)); count++) id = `${base}_${count}`
		for (const suffix of suffixes) taken.add(id + suffix)
		result.set(item.id, id)
	}
	return result
}

/** The endings of a timer's variables, after `timer_<name>`. */
const TIMER_SUFFIXES = ['', '_hms', '_ms', '_seconds', '_state', '_name', '_length']

interface Entry {
	id: string
	name: string
	value: VariableValue
}

/** Every variable with its name and its value now. Definitions and values come from this one list. */
function entries(state: SlidesState, clock: number): Entry[] {
	const list: Entry[] = []
	const add = (id: string, name: string, value: VariableValue | undefined): void => {
		list.push({ id, name, value: value ?? '' })
	}
	const now = state.now()
	const show = state.show
	const live = show?.liveSlide
	const next = show?.nextSlide

	add('deck_name', 'Live presentation name', live?.presentationName)
	add('slide_number', 'Live slide number (the first slide is 1)', live ? slideNumber(state) : '')
	add('slide_count', 'Slides in the live presentation', live?.slideCount)
	add('slides_left', 'Slides left after the live one', showValue(state, 'slides_left'))
	add('slide_name', 'Live slide name', live?.slideName)
	add('slide_text', 'Live slide text', live?.text)
	add('slide_notes', 'Live slide notes', live?.notes)
	add('next_slide_text', 'Next slide text', next?.text ?? show?.nextSlideText)
	add('next_slide_notes', 'Next slide notes', next?.notes)
	add('build_step', 'Builds shown on the live slide', live?.stepIndex)
	add('build_count', 'Builds on the live slide', live?.stepCount)
	add('section_name', 'Live section name', live?.sectionName)
	add('section_color', 'Live section color', live?.sectionColorHex?.slice(0, 7))
	add('next_section_name', 'Next slide section name', next?.sectionName)
	for (let slot = 1; slot <= SECTION_SLOTS; slot++) {
		add(`section_${slot}_name`, `Name of section ${slot} of the live presentation`, show?.sections?.[slot - 1]?.name)
	}
	add('service_name', 'Service name', show?.service?.name)
	add('service_state', 'Service state (idle, preService, running, ended)', state.serviceTracking?.state)
	add('current_item', 'Current service item', show?.position?.currentItemName)
	add('next_item', 'Next service item', show?.position?.nextItemName)
	add('fired_by', 'Who or what fired the live slide', live?.firedBy?.name ?? live?.firedBy?.kind)

	const timerIds = slugs(state.timers, TIMER_SUFFIXES)
	for (const timer of state.timers) {
		const id = `timer_${timerIds.get(timer.id)}`
		const value = timerValue(timer, now)
		add(id, `Timer ${timer.name}: time`, formatClock(value))
		add(`${id}_hms`, `Timer ${timer.name}: time as h:mm:ss`, formatHms(value))
		add(`${id}_ms`, `Timer ${timer.name}: time as m:ss`, formatMs(value))
		add(`${id}_seconds`, `Timer ${timer.name}: seconds`, wholeSeconds(value))
		add(`${id}_state`, `Timer ${timer.name}: state (idle, running, paused, warning, over)`, timerState(timer, now))
		add(`${id}_name`, `Timer ${timer.name}: name`, timer.name)
		add(`${id}_length`, `Timer ${timer.name}: length in seconds`, timer.durationSeconds ?? 0)
	}

	for (const [slot, target, label] of VIDEO_SLOTS) {
		const row = videoRow(state, target)
		const position = row ? transportPosition(row, state.transportAt, clock) : 0
		add(`${slot}_name`, `${label}: name`, row?.name)
		add(`${slot}_position`, `${label}: position`, row ? formatClock(position) : '')
		add(`${slot}_remaining`, `${label}: time left`, row ? formatClock(Math.max(0, row.duration - position)) : '')
		add(`${slot}_length`, `${label}: length`, row ? formatClock(row.duration) : '')
		add(`${slot}_playing`, `${label}: playing`, row ? row.playing : '')
	}

	const bus = state.audio?.buses.find((candidate) => candidate.playing) ?? state.audio?.buses[0]
	const busAt = bus ? busPosition(bus, state.audioAt, clock) : 0
	const playlist = state.library.playlists.find((candidate) => candidate.id === bus?.playlistId)
	add('music_playlist', 'Music: playlist', playlist?.name)
	add('music_track', 'Music: track', bus?.trackName)
	add('music_position', 'Music: position', bus ? formatClock(busAt) : '')
	add('music_remaining', 'Music: time left', bus?.duration ? formatClock(Math.max(0, bus.duration - busAt)) : '')
	add('music_playing', 'Music: playing', bus ? bus.playing : '')

	for (const kind of ['input', 'mix', 'output'] as const) {
		const strips = state.strips(kind)
		const ids = slugs(strips)
		for (const strip of strips) {
			const id = `${kind}_${ids.get(strip.id)}`
			const label = `${STRIP_LABEL[kind]} ${strip.name}`
			add(`${id}_name`, `${label}: name`, strip.name)
			add(`${id}_db`, `${label}: level in dB`, formatDb(stripDb(strip)))
			add(`${id}_muted`, `${label}: muted`, strip.muted)
			if (kind === 'input') add(`${id}_on`, `${label}: on`, stripState(strip) === 'on')
			add(`${id}_meter`, `${label}: meter level in dB`, meterValue(state, kind, strip.id, 'max'))
		}
	}

	add('output_preset', 'Active Output Preset', state.outputs?.presets.find((preset) => preset.active)?.name)
	const screens = show?.confidence?.screens ?? []
	const screenIds = slugs(screens)
	for (const screen of screens) {
		const layout = state.library['confidence-layouts'].find((candidate) => candidate.id === screen.layoutId)
		const name = screen.layoutId ? (layout?.name ?? '') : 'Built-in Layout'
		add(`confidence_${screenIds.get(screen.id)}_layout`, `Confidence Monitor ${screen.name}: layout`, name)
	}

	add('alert_text', 'Alert on screen', show?.alert?.message)
	add('alert_target', 'Where the alert shows (audience, confidence, both)', show?.alert?.target)

	add('recording', 'Recording', state.capture ? state.capture.recording.active : '')
	add('recording_time', 'Recording: time running', captureClock(state, 'recording', now))
	add('streaming', 'Streaming', state.capture ? state.capture.streaming.active : '')
	add('streaming_time', 'Stream: time running', captureClock(state, 'streaming', now))

	add('timecode', 'Timecode in (HH:MM:SS)', timecodeClock(state.timecode, now))
	add('timecode_state', 'Timecode state (noInput, locking, locked, freewheel, stopped)', state.timecode?.state)
	add('timecode_rate', 'Timecode frame rate', state.timecode?.rate)

	const upcoming = state.scheduler?.nextFire
	add('scheduler', 'Scheduler is on', state.scheduler ? state.scheduler.enabled : '')
	add('scheduler_next_name', 'Scheduler: next trigger', upcoming?.name)
	add('scheduler_next_time', 'Scheduler: time of the next trigger', upcoming ? clockTime(upcoming.at) : '')

	add('api_version', 'MxU Slides API version', state.info?.apiVersion)
	add('computer_name', 'Name of the computer running MxU Slides', state.info?.stationName ?? state.info?.name)
	add('lock', 'Lock is on', state.lock ? state.lock.locked : '')
	add('updates_waiting', 'Updates waiting behind the Lock', state.lock ? state.lock.waitingUpdates : '')
	add('in_charge', 'This computer is in charge', state.info ? inCharge(state) : '')
	add(
		'health',
		'Connection health (ok, not responding)',
		state.info ? (state.responding ? 'ok' : 'not responding') : '',
	)

	return list
}

function clockTime(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return ''
	return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function GetVariableDefinitions(state: SlidesState): CompanionVariableDefinitions<VariablesSchema> {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {}
	for (const entry of entries(state, Date.now())) definitions[entry.id] = { name: entry.name }
	return definitions
}

/** The value of every variable now. `clock` is this computer's own time, for what it counts itself. */
export function GetVariableValues(state: SlidesState, clock = Date.now()): Record<string, VariableValue> {
	const values: Record<string, VariableValue> = {}
	for (const entry of entries(state, clock)) values[entry.id] = entry.value
	return values
}

/** Only the values that differ from the ones last sent. */
export function changedValues(
	values: Record<string, VariableValue>,
	sent: Record<string, VariableValue>,
): Record<string, VariableValue> {
	const changed: Record<string, VariableValue> = {}
	for (const [id, value] of Object.entries(values)) {
		if (sent[id] !== value) changed[id] = value
	}
	return changed
}

/** The variable that carries a timer's time, as presets name it. */
export function timerVariable(state: SlidesState, timerId: string): string {
	return `timer_${slugs(state.timers, TIMER_SUFFIXES).get(timerId) ?? 'unnamed'}`
}

/** The id prefix of a mixer strip's variables. */
export function stripVariable(state: SlidesState, kind: MixerKind, stripId: string): string {
	return `${kind}_${slugs(state.strips(kind)).get(stripId) ?? 'unnamed'}`
}
