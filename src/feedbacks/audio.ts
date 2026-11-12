import type { CompanionFeedbackDefinitions, DropdownChoice } from '@companion-module/base'
import { ALL_STRIPS } from '../actions/audio.js'
import type { MixerKind } from '../api/types.js'
import { Choices, text, type SlidesContext } from '../context.js'
import { formatDb, stripDb, stripState, type SlidesState } from '../state.js'
import { FAMILY } from '../style.js'

type StripOptions = { strip: string }
type ValueOptions = StripOptions & { field: string }
type MeterOptions = StripOptions & { channel: string }

export type AudioFeedbacks = {
	input_on_air: { type: 'boolean'; options: StripOptions }
	input_muted: { type: 'boolean'; options: StripOptions }
	mix_muted: { type: 'boolean'; options: StripOptions }
	output_muted: { type: 'boolean'; options: StripOptions }
	input_value: { type: 'value'; options: ValueOptions }
	mix_value: { type: 'value'; options: ValueOptions }
	output_value: { type: 'value'; options: ValueOptions }
	input_meter: { type: 'value'; options: MeterOptions }
	mix_meter: { type: 'value'; options: MeterOptions }
	output_meter: { type: 'value'; options: MeterOptions }
}

const KIND_LABEL: Record<MixerKind, string> = { input: 'Input', mix: 'Mix', output: 'Output' }

const VALUE_FIELDS: DropdownChoice<string>[] = [
	{ id: 'db', label: 'Level in dB (-6.0)' },
	{ id: 'fader', label: 'Fader position, 0 (off) to 100 (full level)' },
	{ id: 'state', label: 'State: on, muted or off' },
	{ id: 'name', label: 'Name' },
]

const CHANNELS: DropdownChoice<string>[] = [
	{ id: 'max', label: 'Loudest channel' },
	{ id: 'left', label: 'Left (channel 1)' },
	{ id: 'right', label: 'Right (channel 2)' },
]

/** Meters read from -60 to 0 dB on a button; quieter than that is the bottom of the bar. */
export const METER_MIN = -60

/**
 * Where the knob sits on a button's fader, 0 to 100. Half the dB range of a real fader would
 * crowd every usable level into the top of a rail this short, so the knob follows the square
 * root of the gain: -6 dB sits at 71, -12 dB at 50, -20 dB at 32.
 */
export function faderPosition(db: number): number {
	if (db <= METER_MIN) return 0
	return Math.round(Math.min(1, 10 ** (db / 40)) * 1000) / 10
}

export function stripValue(state: SlidesState, kind: MixerKind, id: string, field: string): string | number {
	const strip = state.strip(kind, id)
	if (!strip) return field === 'fader' ? 0 : ''
	switch (field) {
		case 'db':
			return formatDb(stripDb(strip))
		case 'fader':
			return faderPosition(stripDb(strip))
		case 'state':
			return stripState(strip)
		default:
			return strip.name
	}
}

export function meterValue(state: SlidesState, kind: MixerKind, id: string, channel: string): number {
	const strip = state.strip(kind, id)
	// A strip that sends nothing shows nothing, whatever arrives at its input.
	if (!strip || stripState(strip) !== 'on') return METER_MIN
	const index = channel === 'left' ? 0 : channel === 'right' ? 1 : undefined
	return Math.max(METER_MIN, Math.min(0, Math.round(state.meter(kind, id, index))))
}

export function audioFeedbacks(ctx: SlidesContext, choices: Choices): CompanionFeedbackDefinitions<AudioFeedbacks> {
	const state = ctx.state

	const stripOption = (
		kind: MixerKind,
		withAll = false,
	): {
		id: 'strip'
		type: 'dropdown'
		label: string
		choices: DropdownChoice<string>[]
		default: string
		allowCustom: true
	} => {
		const strips = choices.strips(kind)
		return {
			id: 'strip',
			type: 'dropdown',
			label: KIND_LABEL[kind],
			choices: withAll ? [{ id: ALL_STRIPS, label: `Every ${KIND_LABEL[kind].toLowerCase()}` }, ...strips] : strips,
			default: Choices.first(strips),
			allowCustom: true,
		}
	}

	const muted = (
		kind: MixerKind,
	): CompanionFeedbackDefinitions<{ a: { type: 'boolean'; options: StripOptions } }>['a'] => ({
		type: 'boolean',
		name: `${KIND_LABEL[kind]} is muted`,
		description: `True while this ${KIND_LABEL[kind].toLowerCase()} is muted, or while every one is.`,
		defaultStyle: { bgcolor: FAMILY.clear.bright, color: FAMILY.clear.ink },
		options: [stripOption(kind, true)],
		callback: ({ options }) => {
			const id = text(options.strip)
			if (id !== ALL_STRIPS) return state.strip(kind, id)?.muted === true
			const strips = state.strips(kind)
			return strips.length > 0 && strips.every((strip) => strip.muted)
		},
	})

	const value = (
		kind: MixerKind,
	): CompanionFeedbackDefinitions<{ a: { type: 'value'; options: ValueOptions } }>['a'] => ({
		type: 'value',
		name: `${KIND_LABEL[kind]}: a value`,
		description: 'The level, state or name of a mixer strip.',
		options: [
			stripOption(kind),
			{
				id: 'field',
				type: 'dropdown',
				label: 'Value',
				choices: VALUE_FIELDS,
				default: 'db',
				disableAutoExpression: true,
			},
		],
		callback: ({ options }) => stripValue(state, kind, text(options.strip), text(options.field)),
	})

	const meter = (
		kind: MixerKind,
	): CompanionFeedbackDefinitions<{ a: { type: 'value'; options: MeterOptions } }>['a'] => ({
		type: 'value',
		name: `${KIND_LABEL[kind]}: level meter`,
		description: 'The live level in dB, from -60 to 0, about ten times a second. Feeds a gauge element.',
		options: [
			stripOption(kind),
			{
				id: 'channel',
				type: 'dropdown',
				label: 'Channel',
				choices: CHANNELS,
				default: 'max',
				disableAutoExpression: true,
			},
		],
		callback: ({ options }) => meterValue(state, kind, text(options.strip), text(options.channel)),
	})

	return {
		input_on_air: {
			type: 'boolean',
			name: 'Input is on',
			description: 'True while the input is heard through the mixer.',
			defaultStyle: { bgcolor: FAMILY.timer.bright, color: FAMILY.timer.ink },
			options: [stripOption('input')],
			callback: ({ options }) => {
				const strip = state.strip('input', text(options.strip))
				return !!strip && stripState(strip) === 'on'
			},
		},
		input_muted: muted('input'),
		mix_muted: muted('mix'),
		output_muted: muted('output'),
		input_value: value('input'),
		mix_value: value('mix'),
		output_value: value('output'),
		input_meter: meter('input'),
		mix_meter: meter('mix'),
		output_meter: meter('output'),
	}
}
