/* eslint-disable @typescript-eslint/no-floating-promises -- the node:test runner awaits describe() and it() itself */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ShowStatus } from '../api/types.js'
import { versionAtLeast } from '../api/client.js'
import { feedbacksFor } from '../feedbacks.js'
import { isLive, liveSectionIndex, slideNumber } from '../feedbacks/show.js'
import { dbToGain, formatDb, shapeKey, SlidesState, stripDb, stripState } from '../state.js'
import { hexColor, inkOn } from '../style.js'
import { changedValues, GetVariableDefinitions, GetVariableValues, slug, slugs } from '../variables.js'

function show(extra: Partial<ShowStatus> = {}): ShowStatus {
	return {
		liveSlide: { presentationId: 'deck', presentationName: 'Song', slideId: 's3', slideIndex: 2, slideCount: 14 },
		mediaLayers: {},
		overlays: [],
		...extra,
	}
}

describe('state', () => {
	it('reports only the parts of a push that changed', () => {
		const state = new SlidesState()
		assert.deepEqual(state.apply('show', show()), ['slide', 'layers', 'overlays'])
		assert.deepEqual(state.apply('show', show()), [])
		assert.deepEqual(state.apply('show', show({ overlays: [{ id: 'o', name: 'Lower Third' }] })), ['overlays'])
		assert.deepEqual(
			state.apply(
				'show',
				show({
					overlays: [{ id: 'o', name: 'Lower Third' }],
					alert: { id: 'a', message: 'Hi', behavior: 'persist', target: 'both' },
				}),
			),
			['alert'],
		)
		const moved = show({
			overlays: [{ id: 'o', name: 'Lower Third' }],
			alert: { id: 'a', message: 'Hi', behavior: 'persist', target: 'both' },
		})
		moved.liveSlide = { ...moved.liveSlide!, slideId: 's4', slideIndex: 3 }
		assert.deepEqual(state.apply('show', moved), ['slide'])
	})

	it('maps each changed part to the feedbacks that read it, and nothing else', () => {
		assert.deepEqual(feedbacksFor(['overlays']), ['live', 'overlay_live'])
		assert.deepEqual(feedbacksFor(['meters']), ['input_meter', 'mix_meter', 'output_meter'])
		assert.deepEqual(feedbacksFor(['library']), [])
		assert.deepEqual(feedbacksFor(['lock', 'lock']), ['lock_on', 'updates_waiting'])
	})

	it('ignores a push that repeats what it already has', () => {
		const state = new SlidesState()
		const timers = [
			{ id: 't', name: 'Sermon', mode: 'countdown' as const, running: false, displaySeconds: 300, overrun: false },
		]
		assert.deepEqual(state.apply('timers', timers), ['timers'])
		assert.deepEqual(state.apply('timers', structuredClone(timers)), [])
		assert.deepEqual(state.apply('outputs', { screens: [], presets: [] }), ['outputs'])
		assert.deepEqual(state.apply('outputs', { screens: [], presets: [] }), [])
		assert.deepEqual(state.apply('nonsense', {}), [])
	})

	it('takes the mixer whole (1.1) or one list at a time (1.0)', () => {
		const state = new SlidesState()
		const input = { id: 'in', name: 'Pastor', live: true, enabled: true, gain: 0.5, muted: false }
		assert.deepEqual(state.apply('mixer', { inputs: [input], mixes: [], outputs: [] }), ['mixer'])
		assert.deepEqual(state.applyMixer([input]), [])
		assert.deepEqual(state.applyMixer([{ ...input, muted: true }]), ['mixer'])
		assert.equal(state.strip('input', 'in')?.muted, true)
		assert.equal(state.strip('mix', 'in'), undefined)
	})

	it('reads meters by strip and channel, with a floor for silence', () => {
		const state = new SlidesState()
		state.apply('meters', {
			mixes: { m: { peak: [-12, -8], rms: [-20, -18] } },
			inputs: { i: { peak: [-30], rms: [-40] } },
		})
		assert.equal(state.meter('mix', 'm'), -8)
		assert.equal(state.meter('mix', 'm', 0), -12)
		assert.equal(state.meter('mix', 'm', 1, 'rms'), -18)
		assert.equal(state.meter('input', 'i', 1), -30)
		assert.equal(state.meter('output', 'none'), -90)
	})

	it('corrects for a clock that differs from the one Slides is on', () => {
		const state = new SlidesState()
		const receivedAt = Date.parse('2026-11-15T15:00:00Z')
		state.apply(
			'timers',
			[
				{
					id: 't',
					name: 'S',
					mode: 'countUp',
					running: true,
					runningSince: '2026-11-15T14:58:20Z',
					displaySeconds: 130,
					overrun: false,
				},
			],
			receivedAt,
		)
		assert.equal(state.clockOffset, 30_000)
	})

	it('forgets everything on reset', () => {
		const state = new SlidesState()
		state.apply('show', show())
		state.applyLibrary('overlays', [{ id: 'o', name: 'Lower Third' }])
		state.applyResponding(false)
		state.reset()
		assert.equal(state.show, undefined)
		assert.deepEqual(state.library.overlays, [])
		assert.equal(state.responding, true)
		assert.deepEqual(state.apply('show', show()).includes('slide'), true)
	})

	it('changes its shape only when a list of names or ids changes', () => {
		const state = new SlidesState()
		const empty = shapeKey(state)
		state.apply('show', show())
		assert.equal(shapeKey(state), empty)
		state.apply('timers', [
			{ id: 't', name: 'Sermon', mode: 'countdown', running: false, displaySeconds: 0, overrun: false },
		])
		const withTimer = shapeKey(state)
		assert.notEqual(withTimer, empty)
		state.apply('timers', [
			{ id: 't', name: 'Sermon', mode: 'countdown', running: true, displaySeconds: 9, overrun: false },
		])
		assert.equal(shapeKey(state), withTimer)
		state.applyLibrary('playlists', [{ id: 'p', name: 'Walk Out' }])
		assert.notEqual(shapeKey(state), withTimer)
	})
})

describe('reading the show', () => {
	it('numbers slides from 1', () => {
		const state = new SlidesState()
		assert.equal(slideNumber(state), 0)
		state.apply('show', show())
		assert.equal(slideNumber(state), 3)
	})

	it('finds the live section by where the live slide sits, even when a section repeats', () => {
		const state = new SlidesState()
		const sections = [
			{ id: 'v1', name: 'Verse 1', firstSlideIndex: 0, slideCount: 2 },
			{ id: 'ch', name: 'Chorus', firstSlideIndex: 2, slideCount: 2 },
			{ id: 'v2', name: 'Verse 2', firstSlideIndex: 4, slideCount: 2 },
			{ id: 'ch', name: 'Chorus', firstSlideIndex: 6, slideCount: 2 },
		]
		state.apply('show', show({ sections }))
		assert.equal(liveSectionIndex(state), 1)
		const later = show({ sections })
		later.liveSlide = { ...later.liveSlide!, slideIndex: 7, sectionId: 'ch' }
		state.apply('show', later)
		assert.equal(liveSectionIndex(state), 3)
		state.apply('show', { mediaLayers: {}, overlays: [], sections })
		assert.equal(liveSectionIndex(state), -1)
	})

	it('knows what there is to clear', () => {
		const state = new SlidesState()
		assert.equal(isLive(state, 'anything'), false)
		state.apply(
			'show',
			show({
				mediaLayers: { loopingVideos: { mediaId: 'm' } },
				overlays: [{ id: 'o', name: 'Bug', layer: 'overlays' }],
			}),
		)
		assert.equal(isLive(state, 'slides'), true)
		assert.equal(isLive(state, 'media'), true)
		assert.equal(isLive(state, 'overlays'), true)
		assert.equal(isLive(state, 'alerts'), false)
		assert.equal(isLive(state, 'inputs'), false)
		assert.equal(isLive(state, 'audio'), false)
		assert.equal(isLive(state, 'layer:loopingVideos'), true)
		assert.equal(isLive(state, 'layer:videos'), false)
		assert.equal(isLive(state, 'layer:slide'), true)
		assert.equal(isLive(state, 'anything'), true)
		state.apply('audio', { buses: [{ playing: true }] })
		assert.equal(isLive(state, 'audio'), true)
		state.apply('show', show({ mediaLayers: { videoInput: { mediaId: 'cam' } } }))
		assert.equal(isLive(state, 'inputs'), true)
		assert.equal(isLive(state, 'media'), false)
	})
})

describe('mixer levels', () => {
	it('reads a fader as dB, using what Slides sends when it does', () => {
		assert.equal(stripDb({ gain: 1 }), 0)
		assert.equal(Math.round(stripDb({ gain: 0.5 }) * 10) / 10, -6)
		assert.equal(stripDb({ gain: 0 }), -90)
		assert.equal(stripDb({ gain: 0.5, gainDb: -6.02 }), -6.02)
		assert.equal(formatDb(-6.02), '-6.0')
		assert.equal(formatDb(-0.04), '0.0')
		assert.equal(formatDb(-90), '-inf')
	})

	it('turns dB back into a fader position', () => {
		assert.equal(dbToGain(0), 1)
		assert.equal(dbToGain(6), 1)
		assert.equal(dbToGain(-60), 0)
		assert.equal(Math.round(dbToGain(-6) * 1000) / 1000, 0.501)
	})

	it('says what a strip pill should read', () => {
		assert.equal(stripState({ id: 'a', name: 'A', gain: 1, muted: false, live: true }), 'on')
		assert.equal(stripState({ id: 'a', name: 'A', gain: 1, muted: true, live: true }), 'muted')
		assert.equal(stripState({ id: 'a', name: 'A', gain: 1, muted: false, live: false }), 'off')
		assert.equal(stripState({ id: 'a', name: 'A', gain: 1, muted: false }), 'on')
	})
})

describe('variables', () => {
	it('names variables from the names in Slides, apart from each other', () => {
		assert.equal(slug('Sermon'), 'sermon')
		assert.equal(slug("Pastor's Mic #2"), 'pastor_s_mic_2')
		assert.equal(slug('  '), 'unnamed')
		const ids = slugs([
			{ id: 'a', name: 'Sermon' },
			{ id: 'b', name: 'sermon' },
			{ id: 'c', name: 'Service' },
		])
		assert.deepEqual([...ids.values()], ['sermon', 'sermon_2', 'service'])
	})

	it('defines a variable for every value it sets, and the other way round', () => {
		const state = new SlidesState()
		state.apply('show', show({ confidence: { screens: [{ id: 'sc', name: 'Stage' }] } }))
		state.apply('timers', [
			{
				id: 't',
				name: 'Sermon',
				mode: 'countdown',
				running: false,
				displaySeconds: 0,
				overrun: false,
				durationSeconds: 300,
			},
		])
		state.apply('mixer', {
			inputs: [{ id: 'in', name: 'Pastor', live: true, enabled: true, gain: 0.5, muted: false }],
			mixes: [{ id: 'mx', name: 'Stream', gain: 1, muted: true }],
			outputs: [{ id: 'out', name: 'Main', gain: 1, muted: false }],
		})
		const definitions = Object.keys(GetVariableDefinitions(state)).sort()
		const values = GetVariableValues(state)
		assert.deepEqual(Object.keys(values).sort(), definitions)
		assert.equal(values.timer_sermon, '5:00')
		assert.equal(values.timer_sermon_hms, '0:05:00')
		assert.equal(values.timer_sermon_seconds, 300)
		assert.equal(values.timer_sermon_state, 'idle')
		assert.equal(values.input_pastor_db, '-6.0')
		assert.equal(values.input_pastor_on_air, true)
		assert.equal(values.mix_stream_muted, true)
		assert.equal(values.output_main_name, 'Main')
		assert.equal(values.confidence_stage_layout, 'Built-in Layout')
		assert.equal(values.slide_number, 3)
		assert.equal(values.slides_left, 11)
		assert.equal(values.deck_name, 'Song')
	})

	it('is empty for everything when nothing is connected', () => {
		const values = GetVariableValues(new SlidesState())
		assert.deepEqual(
			Object.entries(values).filter(([, value]) => value !== ''),
			[],
		)
	})

	it('sends only the values that changed', () => {
		const sent = { a: 1, b: 'x', c: true }
		assert.deepEqual(changedValues({ a: 1, b: 'y', c: true, d: 0 }, sent), { b: 'y', d: 0 })
		assert.deepEqual(changedValues(sent, sent), {})
	})
})

describe('small helpers', () => {
	it('compares versions the way they read', () => {
		assert.equal(versionAtLeast('1.1', '1.1'), true)
		assert.equal(versionAtLeast('1.10', '1.9'), true)
		assert.equal(versionAtLeast('1.0', '1.1'), false)
		assert.equal(versionAtLeast('2.0', '1.1'), true)
		assert.equal(versionAtLeast(undefined, '1.1'), false)
	})

	it('reads the colors MxU Slides stores', () => {
		assert.equal(hexColor('#FF9F0A', 0), 0xff9f0a)
		assert.equal(hexColor('#FF9F0AFF', 0), 0xff9f0a)
		assert.equal(hexColor(undefined, 0x123456), 0x123456)
		assert.equal(hexColor('orange', 0x123456), 0x123456)
		assert.equal(inkOn(0xffd60a), 0x0b0b0b)
		assert.equal(inkOn(0xff375f), 0xffffff)
	})
})
