/* eslint-disable @typescript-eslint/no-floating-promises -- the node:test runner awaits describe() and it() itself */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GetActions } from '../actions.js'
import type { SlidesContext } from '../context.js'
import { GetCompositeElements } from '../elements.js'
import { GetFeedbacks } from '../feedbacks.js'
import { ICONS } from '../icons.js'
import { GetPresets } from '../presets.js'
import { SlidesState } from '../state.js'
import { FakeSlides } from './fake-slides.js'

/** A state filled the way a connected 1.1 Slides fills it. */
function filled(): SlidesState {
	const fake = new FakeSlides()
	const state = new SlidesState()
	for (const topic of [
		'show',
		'timers',
		'audio',
		'transport',
		'outputs',
		'scheduler',
		'timecode',
		'capture',
		'mixer',
		'inputs',
	]) {
		state.apply(topic, fake.snapshot(topic))
	}
	for (const kind of [
		'presentations',
		'services',
		'media',
		'audio',
		'playlists',
		'overlays',
		'alert-presets',
		'confidence-layouts',
	] as const) {
		state.applyLibrary(kind, fake.library[kind])
	}
	state.applyCombos(fake.combos)
	return state
}

const context = (state: SlidesState): SlidesContext => ({
	state,
	log: () => undefined,
	run: async () => undefined,
	refresh: () => undefined,
	changed: () => undefined,
})

interface AnyElement {
	type: string
	id?: string
	base64Image?: unknown
	elementId?: string
	children?: AnyElement[]
}

interface AnyVariant {
	type: string
	name: string
	canvas?: { decoration?: string }
	elements?: AnyElement[]
	style?: { text: string; show_topbar?: boolean }
	steps: Record<string, unknown>[]
	feedbacks: { feedbackId: string; options: Record<string, unknown>; styleOverrides?: { elementId: string }[] }[]
	localVariables?: { variableName: string; feedbackId: string; options: Record<string, unknown> }[]
}

function variants(preset: unknown): AnyVariant[] {
	return (preset as { variants: AnyVariant[] }).variants
}

describe('presets', () => {
	const state = filled()
	const { sections, presets } = GetPresets(state, 'slides')
	const actions = GetActions(context(state)) as Record<string, { options: { id: string }[] }>
	const feedbacks = GetFeedbacks(context(state)) as Record<string, { options: { id: string }[]; type: string }>
	const composites = Object.keys(GetCompositeElements())

	it('ships a layered look with a simple fallback for every preset', () => {
		for (const [id, preset] of Object.entries(presets)) {
			assert.equal(preset?.type, 'alternatives', id)
			const [rich, plain] = variants(preset)
			assert.equal(rich.type, 'layered', id)
			assert.equal(plain.type, 'simple', id)
			assert.equal(rich.name, plain.name, id)
			assert.ok(plain.style && plain.style.text.length > 0, `${id} has fallback text`)
			assert.equal(plain.style?.show_topbar, false, id)
		}
	})

	it('sets the decoration itself, so no layout depends on the top bar', () => {
		for (const [id, preset] of Object.entries(presets)) {
			assert.equal(variants(preset)[0].canvas?.decoration, 'border', id)
		}
	})

	it('lists every preset once in the structure, and nothing that is not defined', () => {
		const listed: string[] = []
		for (const section of sections) {
			for (const definition of section.definitions) {
				if (typeof definition === 'string') listed.push(definition)
				else if (definition.type === 'simple') listed.push(...definition.presets)
			}
		}
		assert.deepEqual([...listed].sort(), Object.keys(presets).sort())
		assert.equal(new Set(listed).size, listed.length)
		const sectionIds = sections.map((section) => section.id)
		assert.deepEqual(sectionIds, [
			'slides',
			'service',
			'clear',
			'combos',
			'timers',
			'media',
			'video_inputs',
			'overlays',
			'alerts',
			'music',
			'mixer',
			'screens',
			'capture',
			'scheduler',
			'system',
		])
	})

	it('builds ids from the ids in MxU Slides, so they survive a rename', () => {
		const renamed = filled()
		renamed.applyCombos(renamed.combos.map((combo) => ({ ...combo, name: `${combo.name} 2` })))
		renamed.apply(
			'timers',
			renamed.timers.map((timer) => ({ ...timer, name: `${timer.name} 2` })),
		)
		assert.deepEqual(Object.keys(GetPresets(renamed, 'slides').presets).sort(), Object.keys(presets).sort())
		assert.ok('combo_combo-live' in presets)
		assert.ok('timer_timer-sermon_add_30s' in presets)
		assert.ok('input_in-pastor_dial' in presets)
	})

	it('refers only to actions and feedbacks that exist, with the options they take', () => {
		const check = (
			kind: string,
			id: string,
			options: Record<string, unknown>,
			known: Record<string, { options: { id: string }[] }>,
			where: string,
		): void => {
			assert.ok(known[id], `${where}: ${kind} ${id} exists`)
			const fields = known[id].options.map((field) => field.id).sort()
			assert.deepEqual(Object.keys(options).sort(), fields, `${where}: options of ${id}`)
		}
		for (const [presetId, preset] of Object.entries(presets)) {
			for (const variant of variants(preset)) {
				for (const step of variant.steps) {
					for (const group of ['down', 'up', 'rotate_left', 'rotate_right']) {
						for (const action of (step[group] ?? []) as { actionId: string; options: Record<string, unknown> }[]) {
							check('action', action.actionId, action.options, actions, presetId)
						}
					}
				}
				for (const feedback of variant.feedbacks) {
					check('feedback', feedback.feedbackId, feedback.options, feedbacks, presetId)
					assert.equal(
						feedbacks[feedback.feedbackId].type,
						'boolean',
						`${presetId}: ${feedback.feedbackId} styles a button`,
					)
				}
				for (const variable of variant.localVariables ?? []) {
					check('feedback', variable.feedbackId, variable.options, feedbacks, presetId)
					assert.equal(
						feedbacks[variable.feedbackId].type,
						'value',
						`${presetId}: ${variable.feedbackId} gives a value`,
					)
				}
			}
		}
	})

	it('draws every glyph it names, and changes only elements that are there', () => {
		const walk = (elements: AnyElement[], ids: Set<string>, presetId: string): void => {
			for (const element of elements) {
				if (element.id) ids.add(element.id)
				if (element.type === 'image' && typeof element.base64Image === 'string') {
					assert.match(element.base64Image, /^data:image\/png;base64,/, `${presetId}: ${element.id}`)
				}
				if (element.type === 'image')
					assert.notEqual(element.base64Image, null, `${presetId}: glyph ${element.id} is in the table`)
				if (element.type === 'composite') assert.ok(composites.includes(element.elementId ?? ''), presetId)
				if (element.children) walk(element.children, ids, presetId)
			}
		}
		for (const [presetId, preset] of Object.entries(presets)) {
			const rich = variants(preset)[0]
			const ids = new Set<string>()
			walk(rich.elements ?? [], ids, presetId)
			for (const feedback of rich.feedbacks) {
				for (const override of feedback.styleOverrides ?? []) {
					assert.ok(ids.has(override.elementId), `${presetId}: override of ${override.elementId}`)
				}
			}
			const locals = new Set((rich.localVariables ?? []).map((variable) => variable.variableName))
			const used = [...JSON.stringify(rich.elements).matchAll(/\$\(local:(\w+)\)/g)].map((match) => match[1])
			for (const name of used) assert.ok(locals.has(name), `${presetId}: local variable ${name} is defined`)
		}
	})

	it('carries the whole set the plan lists', () => {
		const ids = Object.keys(presets)
		for (const id of [
			'slide_previous',
			'slide_next',
			'slide_now',
			'slide_upcoming',
			'slide_current_picture',
			'slide_next_picture',
			'slide_current_section',
			'slide_next_section',
			'slide_position',
			'slides_left',
			'section_1',
			'section_8',
			'clear_all',
			'clear_inputs',
		]) {
			assert.ok(ids.includes(id), id)
		}
		for (const key of ['1s', '5s', '10s', '15s', '30s', '1m', '5m']) {
			assert.ok(ids.includes(`timer_timer-sermon_add_${key}`), `add ${key}`)
			assert.ok(ids.includes(`timer_timer-sermon_subtract_${key}`), `subtract ${key}`)
		}
		assert.ok(ids.includes('mixer_mute_all'))
		assert.ok(ids.includes('confidence_screen-stage_built-in'))
		assert.ok(ids.includes('confidence_screen-stage_layout-lyrics'))
		assert.ok(ids.includes('trigger_trigger-preservice'))
	})

	it("names variables in the fallback text by the connection's label", () => {
		const texts = (label: string): string[] =>
			Object.values(GetPresets(state, label).presets).map((preset) => variants(preset)[1].style?.text ?? '')
		const named = texts('booth-mac').filter((text) => text.includes('$('))
		assert.ok(named.length > 10)
		for (const text of named) assert.doesNotMatch(text, /\$\((?!booth-mac:)/, text)
		assert.ok(texts('slides').some((text) => text.includes('$(slides:timer_sermon)')))
	})

	it('turns off expressions on every dropdown with a fixed list; lists from MxU Slides take an id', () => {
		for (const [id, definition] of Object.entries({ ...actions, ...feedbacks })) {
			for (const option of definition.options as {
				id: string
				type: string
				allowCustom?: boolean
				disableAutoExpression?: boolean
			}[]) {
				if (option.type !== 'dropdown') continue
				assert.ok(option.allowCustom === true || option.disableAutoExpression === true, `${id}: ${option.id}`)
			}
		}
	})

	it('says Current and Next, never Now, and an input that is on says ON', () => {
		const text = JSON.stringify(presets)
		assert.doesNotMatch(text, /\bNOW\b|\bNow\b/)
		assert.match(text, /Slide: Current/)
		assert.doesNotMatch(text, /ON AIR/)
		const inputs = Object.keys(presets).filter((id) => /^input_.*_(strip|dial)$/.test(id))
		assert.ok(inputs.length > 0)
		for (const id of inputs) assert.match(JSON.stringify(presets[id]), /"onLabel":"ON"/)
	})

	it('keeps Mute All grey until every output is muted, then fills it red', () => {
		const rich = variants(presets.mixer_mute_all)[0]
		assert.equal(rich.feedbacks[0].feedbackId, 'output_muted')
		const overrides = rich.feedbacks[0].styleOverrides as {
			elementId: string
			elementProperty: string
			override: { value: unknown }
		}[]
		assert.ok(
			overrides.some((o) => o.elementId === 'tile' && o.elementProperty === 'color' && o.override.value === 0xff453a),
		)
		assert.doesNotMatch(JSON.stringify(rich.elements), /volume-x\.audio/)
	})

	it('groups overlays by their library folder, so packs that reuse a name can be told apart', () => {
		const state = filled()
		state.applyLibrary('overlays', [
			{ id: 'pack.a.cta', name: 'Call to Action', folder: 'Clean Geometric/Lower Thirds' },
			{ id: 'pack.b.cta', name: 'Call to Action', folder: 'Bold Blocks/Lower Thirds' },
			{ id: 'pack.b.ticker', name: 'Ticker', folder: 'Bold Blocks/Lower Thirds' },
		])
		const folders = GetPresets(state, 'slides')
		const overlays = folders.sections.find((section) => section.id === 'overlays')
		const groups = overlays?.definitions as { name: string; presets: string[] }[]
		assert.deepEqual(
			groups.map((group) => [group.name, group.presets]),
			[
				['Clean Geometric / Lower Thirds', ['overlay_pack.a.cta']],
				['Bold Blocks / Lower Thirds', ['overlay_pack.b.cta', 'overlay_pack.b.ticker']],
			],
		)
		assert.equal(
			variants(folders.presets['overlay_pack.b.cta'])[0].name,
			'Overlay: Bold Blocks/Lower Thirds / Call to Action',
		)
	})

	it('gives a permanent Service Tracking timer a display only, with nothing to press', () => {
		const ids = Object.keys(presets).filter((id) => id.startsWith('timer_service_tracking.'))
		assert.deepEqual(ids, ['timer_service_tracking.service.elapsed_display'])
		const [rich, plain] = variants(presets[ids[0]])
		assert.deepEqual(rich.steps, [{ down: [], up: [] }])
		assert.deepEqual(plain.steps, [{ down: [], up: [] }])
		const timers = sections.find((section) => section.id === 'timers')
		const groups = (timers?.definitions ?? []).filter((definition) => typeof definition !== 'string')
		assert.deepEqual(
			groups.map((group) => group.name),
			['Sermon', 'Countdown', 'Service Tracking'],
		)
	})

	it('still offers the fixed presets before anything is connected', () => {
		const empty = GetPresets(new SlidesState(), 'slides')
		assert.ok('slide_next' in empty.presets)
		assert.ok('clear_all' in empty.presets)
		assert.equal(
			empty.sections.some((section) => section.id === 'timers' || section.id === 'mixer' || section.id === 'combos'),
			false,
		)
	})

	it('draws a key that turns on grey at rest and an anytime action plain white, never a color', () => {
		const keyOf = new Map(Object.entries(ICONS).map(([key, image]) => [image, key]))
		for (const [id, preset] of Object.entries(presets)) {
			const rich = variants(preset)[0]
			for (const element of rich.elements ?? []) {
				const shown = element as { type: string; id?: string; enabled?: unknown; base64Image?: unknown }
				if (shown.type !== 'image' || shown.id === 'picture') continue
				assert.equal(typeof shown.base64Image, 'string', `${id}: ${shown.id} has a glyph`)
				// Color only shows once something is on; at rest a key is grey (off) or white (anytime).
				if (shown.enabled === false || typeof shown.enabled === 'object') continue
				const key = keyOf.get(shown.base64Image as string) ?? ''
				assert.match(key, /\.(rest|dim|action)$|\.(dark|white)$/, `${id}: ${key} at rest`)
			}
		}
		assert.match(
			keyOf.get(
				String(
					variants(presets['timer_timer-sermon_add_1m'])[0].elements?.find(
						(e) => (e as { type: string }).type === 'image',
					)?.base64Image,
				),
			) ?? '',
			/^plus\.action$/,
		)
		assert.deepEqual(variants(presets.clear_all)[0].feedbacks[0].options, { target: 'anything' })
		// The current section fills, and Current goes red, only while a slide is up.
		const sectionTile = (variants(presets.slide_current_section)[0].elements ?? [])[0] as { color?: { value?: string } }
		assert.match(sectionTile.color?.value ?? '', /!= ''/)
		assert.match(JSON.stringify(variants(presets.slide_current_picture)[0].elements), /\$\(local:up\) != ''/)
	})

	it('holds only glyphs that some preset can draw', () => {
		const everything = JSON.stringify([presets, GetPresets(new SlidesState(), 'slides').presets])
		const comboGlyphs = /\.(dark|white)$/
		for (const [key, image] of Object.entries(ICONS)) {
			if (comboGlyphs.test(key)) continue
			assert.ok(everything.includes(image), `${key} is used`)
		}
	})
})
