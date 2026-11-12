import type { CompanionActionDefinitions, DropdownChoice } from '@companion-module/base'
import type { Requests } from '../api/client.js'
import type { MixerKind } from '../api/types.js'
import { Choices, number, ON_OFF_TOGGLE, picked, resolveToggle, text, type SlidesContext } from '../context.js'
import { dbToGain, stripDb, type SlidesState } from '../state.js'
import { parseDuration } from '../time.js'

type StripOptions = { strip: string }
type MuteOptions = StripOptions & { mode: string }
type LevelOptions = StripOptions & { db: number }
type NudgeOptions = StripOptions & { step: number }

export type AudioActions = {
	music_playlist: { options: { playlist: string } }
	music_item: { options: { item: string } }
	music_transport: { options: { action: string; position: string } }
	input_on_air: { options: MuteOptions }
	input_mute: { options: MuteOptions }
	input_level: { options: LevelOptions }
	input_nudge: { options: NudgeOptions }
	mix_mute: { options: MuteOptions }
	mix_level: { options: LevelOptions }
	mix_nudge: { options: NudgeOptions }
	output_mute: { options: MuteOptions }
	output_level: { options: LevelOptions }
	output_nudge: { options: NudgeOptions }
}

export const ALL_STRIPS = 'all'

const KIND_LABEL: Record<MixerKind, string> = { input: 'Input', mix: 'Mix', output: 'Output' }
const KIND_ARTICLE: Record<MixerKind, string> = { input: 'an', mix: 'a', output: 'an' }

/** How long a level this module just asked for stands in for the one MxU Slides last reported. */
const AIM_MS = 500
/**
 * The level each strip was last sent to, per connection. A dial sends its turns faster than
 * MxU Slides answers them, so each turn builds on the level the one before asked for, not on
 * a report that has yet to arrive.
 */
const AIMS = new WeakMap<SlidesState, Map<string, { gain: number; at: number }>>()

function aim(state: SlidesState, kind: MixerKind, id: string, gain: number): void {
	const aims = AIMS.get(state) ?? new Map<string, { gain: number; at: number }>()
	aims.set(`${kind}:${id}`, { gain, at: Date.now() })
	AIMS.set(state, aims)
}

function aimedDb(state: SlidesState, kind: MixerKind, id: string): number | undefined {
	const aimed = AIMS.get(state)?.get(`${kind}:${id}`)
	return aimed && Date.now() - aimed.at < AIM_MS ? stripDb({ gain: aimed.gain }) : undefined
}

function stripPath(kind: MixerKind, id: string): string {
	const encoded = encodeURIComponent(id)
	if (kind === 'input') return `/v1/inputs/audio/${encoded}/mixer`
	return kind === 'mix' ? `/v1/audio/mixes/${encoded}/mixer` : `/v1/audio/outputs/${encoded}/mixer`
}

/** Mixes and outputs take commands from Slides API 1.1; inputs always have. */
function needs(kind: MixerKind): string | undefined {
	return kind === 'input' ? undefined : '1.1'
}

export function audioActions(ctx: SlidesContext, choices: Choices): CompanionActionDefinitions<AudioActions> {
	const playlists = choices.library('playlists')
	const items = choices.library('audio')

	const stripOption = (
		kind: MixerKind,
		withAll: boolean,
	): {
		id: 'strip'
		type: 'dropdown'
		label: string
		choices: DropdownChoice<string>[]
		default: string
		allowCustom: true
	} => {
		const strips = choices.strips(kind)
		const list = withAll ? [{ id: ALL_STRIPS, label: `Every ${KIND_LABEL[kind].toLowerCase()}` }, ...strips] : strips
		return {
			id: 'strip',
			type: 'dropdown',
			label: KIND_LABEL[kind],
			choices: list,
			default: Choices.first(strips),
			allowCustom: true,
		}
	}

	/** Sends one change to a strip (or every strip of its kind), then reads the mixer back. */
	const change = async (
		name: string,
		kind: MixerKind,
		chosen: unknown,
		body: (id: string) => object | undefined,
		signal: AbortSignal,
	): Promise<void> => {
		const strip = picked(ctx, name, `${KIND_ARTICLE[kind]} ${KIND_LABEL[kind].toLowerCase()}`, chosen)
		if (!strip) return
		await ctx.run(name, needs(kind), signal, async (client: Requests) => {
			const ids = strip === ALL_STRIPS ? ctx.state.strips(kind).map((candidate) => candidate.id) : [strip]
			for (const id of ids) {
				// Stopped part-way through every strip: what was sent stays, the rest is left alone.
				if (signal.aborted) break
				const payload = body(id)
				if (!payload) continue
				if ('gain' in payload && typeof payload.gain === 'number') aim(ctx.state, kind, id, payload.gain)
				await client.post(stripPath(kind, id), payload)
				// Take the change at once, so the next turn of a dial builds on it without waiting.
				const strip = ctx.state.strip(kind, id)
				if (strip) {
					Object.assign(strip, payload)
					if ('gain' in payload) delete strip.gainDb
				}
			}
			ctx.changed(['mixer'])
			ctx.refresh('mixer')
		})
	}

	const mute = (kind: MixerKind): CompanionActionDefinitions<{ a: { options: MuteOptions } }>['a'] => ({
		name: `${KIND_LABEL[kind]}: Mute`,
		description: `Mutes or unmutes ${KIND_ARTICLE[kind]} ${KIND_LABEL[kind].toLowerCase()} in the MxU Slides mixer, or every one at once.`,
		options: [
			stripOption(kind, true),
			{
				id: 'mode',
				type: 'dropdown',
				label: 'Mute',
				choices: ON_OFF_TOGGLE,
				default: 'toggle',
				disableAutoExpression: true,
			},
		],
		callback: async ({ options }, { signal }) => {
			const strip = text(options.strip)
			// Toggling every strip unmutes them all when every one is muted, and mutes them all
			// otherwise, so they end up the same.
			const reference =
				strip === ALL_STRIPS ? ctx.state.strips(kind).every((one) => one.muted) : !!ctx.state.strip(kind, strip)?.muted
			const muted = resolveToggle(options.mode, reference)
			await change(`${KIND_LABEL[kind]}: Mute`, kind, strip, () => ({ muted }), signal)
		},
	})

	const level = (kind: MixerKind): CompanionActionDefinitions<{ a: { options: LevelOptions } }>['a'] => ({
		name: `${KIND_LABEL[kind]}: Set level`,
		description: `Sets the fader of ${KIND_ARTICLE[kind]} ${KIND_LABEL[kind].toLowerCase()} in the MxU Slides mixer.`,
		options: [
			stripOption(kind, false),
			{
				id: 'db',
				type: 'number',
				label: 'Level (dB)',
				description: '0 is full level. -60 or lower turns the strip all the way down.',
				default: 0,
				min: -60,
				max: 0,
				step: 0.5,
				range: true,
				clampValues: true,
			},
		],
		callback: async ({ options }, { signal }) => {
			const gain = dbToGain(number(options.db))
			await change(`${KIND_LABEL[kind]}: Set level`, kind, options.strip, () => ({ gain }), signal)
		},
	})

	const nudge = (kind: MixerKind): CompanionActionDefinitions<{ a: { options: NudgeOptions } }>['a'] => ({
		name: `${KIND_LABEL[kind]}: Nudge level`,
		description: 'Moves the level up or down by a step. Made for dials: put it on rotate left and rotate right.',
		options: [
			stripOption(kind, false),
			{
				id: 'step',
				type: 'number',
				label: 'Step (dB)',
				description: 'A minus turns it down.',
				default: 1,
				min: -12,
				max: 12,
				step: 0.5,
				clampValues: true,
			},
		],
		callback: async ({ options }, { signal }) => {
			const name = `${KIND_LABEL[kind]}: Nudge level`
			await change(
				name,
				kind,
				options.strip,
				(id) => {
					const strip = ctx.state.strip(kind, id)
					if (!strip) throw new Error(`no ${KIND_LABEL[kind].toLowerCase()} with that id in MxU Slides`)
					// From all the way down, the first step up lands at the bottom of the fader's range.
					const from = Math.max(-60, aimedDb(ctx.state, kind, id) ?? stripDb(strip))
					return { gain: dbToGain(Math.min(0, from + number(options.step, 1))) }
				},
				signal,
			)
		},
	})

	return {
		music_playlist: {
			name: 'Music: Play playlist',
			description: 'Starts a playlist from the MxU Slides library.',
			options: [
				{
					id: 'playlist',
					type: 'dropdown',
					label: 'Playlist',
					choices: playlists,
					default: Choices.first(playlists),
					allowCustom: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				const playlist = picked(ctx, 'Music: Play playlist', 'a playlist', options.playlist)
				if (!playlist) return
				const id = encodeURIComponent(playlist)
				await ctx.run('Music: Play playlist', undefined, signal, async (client) =>
					client.post(`/v1/audio/playlists/${id}/fire`),
				)
			},
		},
		music_item: {
			name: 'Music: Play item',
			description: 'Plays one audio item from the MxU Slides library.',
			options: [
				{
					id: 'item',
					type: 'dropdown',
					label: 'Audio item',
					choices: items,
					default: Choices.first(items),
					allowCustom: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				const item = picked(ctx, 'Music: Play item', 'an audio item', options.item)
				if (!item) return
				const id = encodeURIComponent(item)
				await ctx.run('Music: Play item', undefined, signal, async (client) =>
					client.post(`/v1/audio/items/${id}/fire`),
				)
			},
		},
		music_transport: {
			name: 'Music: Play / Pause, Next, Previous, Seek, Stop',
			description: 'Controls the music that is playing in MxU Slides.',
			options: [
				{
					id: 'action',
					type: 'dropdown',
					label: 'Do',
					disableAutoExpression: true,
					choices: [
						{ id: 'playPause', label: 'Play / Pause' },
						{ id: 'next', label: 'Next track' },
						{ id: 'previous', label: 'Previous track' },
						{ id: 'seek', label: 'Go to a time' },
						{ id: 'stop', label: 'Stop' },
					],
					default: 'playPause',
				},
				{
					id: 'position',
					type: 'textinput',
					label: 'Time',
					description: 'Seconds or a clock: 90, 1:30.',
					default: '0',
					useVariables: true,
					isVisibleExpression: "$(options:action) == 'seek'",
				},
			],
			callback: async ({ options }, { signal }) => {
				await ctx.run('Music: Play / Pause, Next, Previous, Seek, Stop', undefined, signal, async (client) => {
					const action = text(options.action)
					if (action === 'stop') {
						await client.post('/v1/audio/stop')
						return
					}
					if (action !== 'seek') {
						await client.post('/v1/audio/transport', { action })
						return
					}
					const position = parseDuration(text(options.position))
					if (position === undefined || position < 0) throw new Error(`"${text(options.position)}" is not a time`)
					await client.post('/v1/audio/transport', { action, position })
				})
			},
		},
		input_on_air: {
			name: 'Input: On / Off',
			description: 'The on/off switch of an audio input in the mixer.',
			options: [
				stripOption('input', false),
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Switch',
					choices: ON_OFF_TOGGLE,
					default: 'toggle',
					disableAutoExpression: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				const enabled = resolveToggle(options.mode, !!ctx.state.strip('input', text(options.strip))?.enabled)
				await change('Input: On / Off', 'input', options.strip, () => ({ enabled }), signal)
			},
		},
		input_mute: mute('input'),
		input_level: level('input'),
		input_nudge: nudge('input'),
		mix_mute: mute('mix'),
		mix_level: level('mix'),
		mix_nudge: nudge('mix'),
		output_mute: mute('output'),
		output_level: level('output'),
		output_nudge: nudge('output'),
	}
}
