import type { CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from '../main.js'
import type { SlidesState } from '../state.js'
import { DIM, dimmed, FAMILY, hexColor, inkOn, TILE, TILE_EDGE, WHITE } from '../style.js'
import { SECTION_SLOTS } from '../variables.js'
import {
	alternatives,
	box,
	caption,
	expression,
	glyph,
	LABEL,
	label,
	layered,
	local,
	localValue,
	pct,
	press,
	set,
	simple,
	tile,
	tileBase,
	when,
	whenSimple,
	type Element,
	type Expression,
	type LocalVariable,
	type Preset,
	type Steps,
} from './kit.js'

type Presets = Record<string, Preset>
type Section = CompanionPresetSection<ModuleSchema>

/** How MxU Slides names a combo's icon, and the glyph that stands for it here. */
const COMBO_GLYPHS: Record<string, string> = {
	combos: 'zap',
	services: 'list-video',
	presentations: 'presentation',
	overlays: 'layers',
	media: 'image',
	audio: 'music',
	themes: 'palette',
	libraries: 'gallery-vertical-end',
	folder: 'folder',
	viewOptions: 'sliders-vertical',
	timers: 'timer',
	alerts: 'bell',
	broadcast: 'circle-dot',
	screens: 'monitor',
	confidence: 'monitor-check',
	clear: 'x',
	midi: 'keyboard-music',
	mixer: 'sliders-vertical',
	sync: 'refresh-cw',
	notes: 'notebook-pen',
	fade: 'blend',
	crossfade: 'blend',
	light: 'lightbulb',
}

/** Previous and Next: a white arrow, like every key you can press any time. */
function nav(direction: 'next' | 'previous'): Preset {
	const next = direction === 'next'
	const name = next ? 'Next' : 'Previous'
	const steps = press(
		next ? { actionId: 'slide_next', options: { skipBuilds: false } } : { actionId: 'slide_previous', options: {} },
	)
	return alternatives(
		layered(
			`Slide: ${name}`,
			[tileBase(), glyph('glyph', `arrow-${next ? 'right' : 'left'}.action`), caption(name, WHITE)],
			steps,
		),
		simple(`Slide: ${name}`, name, steps),
	)
}

/** The slide picture in a ring (red for the current slide), over the slide's words for when MxU Slides sends no picture. */
function picture(live: boolean, x: number, y: number, width: number, height: number): Element[] {
	const frame = live ? 2 : 1
	return [
		box('ring', x, y, width, height, upColor(live, FAMILY.clear.bright, 0x55554f), { radius: 3, name: 'Picture ring' }),
		box('pictureBack', x + frame, y + frame, width - frame * 2, height - frame * 2, 0x0c1220, {
			radius: 2,
			name: 'Picture back',
		}),
		label('words', expression(local('words')), x + 4, y + 4, width - 8, height - 8, 0xd6d6d2, {
			size: 27,
			weight: 'normal',
			name: 'Slide text',
		}),
		{
			type: 'image' as const,
			id: 'picture',
			name: 'Slide picture',
			x: pct(x + frame),
			y: pct(y + frame),
			width: pct(width - frame * 2),
			height: pct(height - frame * 2),
			base64Image: expression(local('picture')),
			fillMode: 'fit' as const,
			halign: 'center' as const,
			valign: 'center' as const,
		},
	]
}

/** Red for the current slide only while one is up; grey otherwise (color means something is on). */
function upColor(live: boolean, on: number, off: number): number | Expression {
	return live ? expression(`${local('up')} != '' ? ${on} : ${off}`) : off
}

function pictureValues(live: boolean): LocalVariable[] {
	return [
		localValue('up', 'show_value', { field: live ? 'position' : 'next_position' }),
		localValue('picture', 'slide_picture', { which: live ? 'live' : 'next' }),
		localValue('words', 'show_value', { field: live ? 'text' : 'next_text' }),
	]
}

/** The current slide does nothing on a press; the next one goes there. */
function slideSteps(live: boolean): Steps {
	return live ? press() : press({ actionId: 'slide_next', options: { skipBuilds: false } })
}

/** Current and Next: the slide picture, its number, and its section in the section's own color. */
function thumb(which: 'live' | 'next'): Preset {
	const live = which === 'live'
	const name = live ? 'Current' : 'Next'
	const steps = slideSteps(live)
	const hasLabel = expression(`${local('label')} != ''`)
	const elements = [
		tileBase(),
		...picture(live, 4, 5, 64, 37),
		label('kind', name.toUpperCase(), 5, 45.5, 30, 9.5, upColor(live, FAMILY.clear.bright, DIM), {
			halign: 'left',
			size: 92,
		}),
		label('position', expression(local('position')), 36, 45.5, 31, 9.5, WHITE, { halign: 'right', size: 100 }),
		// The section in its own color; without sections, the presentation's name on a quiet pill.
		box('pill', 5, 57, 62, 10.5, expression(local('color')), { radius: 5.25, enabled: hasLabel, name: 'Section pill' }),
		label('section', expression(local('label')), 7, 57.4, 58, 10, 0x0b0b0b, { size: 88, enabled: hasLabel }),
	]
	const variables = [
		...pictureValues(live),
		localValue('position', 'show_value', { field: live ? 'position' : 'next_position' }),
		localValue('label', 'show_value', { field: live ? 'label' : 'next_label' }),
		localValue('color', 'show_value', { field: live ? 'section_color' : 'next_section_color' }),
	]
	const text = live
		? `CURRENT $(${LABEL}:slide_number) / $(${LABEL}:slide_count)\\n$(${LABEL}:section_name)`
		: `NEXT\\n$(${LABEL}:next_section_name)`
	return alternatives(layered(`Slide: ${name}`, elements, steps, [], variables), simple(`Slide: ${name}`, text, steps))
}

/** The picture as big as the key allows, with Current or Next under it. */
function pictureOnly(which: 'live' | 'next'): Preset {
	const live = which === 'live'
	const kind = live ? 'Current' : 'Next'
	const name = `Slide: ${kind} picture`
	const steps = slideSteps(live)
	const elements = [
		tileBase(),
		...picture(live, 2, 6, 68, 39),
		label('kind', kind.toUpperCase(), 4, 50, 64, 13, upColor(live, FAMILY.clear.bright, DIM), { size: 92 }),
	]
	return alternatives(
		layered(name, elements, steps, [], pictureValues(live)),
		simple(name, live ? `$(${LABEL}:slide_text)` : `$(${LABEL}:next_slide_text)`, steps),
	)
}

/** The current or next section's name; the current one fills with the section's color. */
function sectionNow(which: 'live' | 'next'): Preset {
	const live = which === 'live'
	const kind = live ? 'Current' : 'Next'
	const steps = slideSteps(live)
	const color = expression(local('color'))
	// Only the current section fills, and only while a slide is up.
	const filled = live ? `${local('name')} != ''` : 'false'
	const pick = (on: number, off: number): Expression => expression(`${filled} ? ${on} : ${off}`)
	const elements = [
		tileBase(
			expression(`${filled} ? ${local('color')} : ${TILE}`),
			expression(`${filled} ? ${local('color')} : ${TILE_EDGE}`),
		),
		label('kind', kind.toUpperCase(), 4, 7, 64, 9, pick(0x0b0b0b, DIM), { size: 80, name: 'Current or Next' }),
		label('name', expression(local('name')), 4, 20, 64, 30, pick(0x0b0b0b, WHITE), { size: 46, name: 'Section' }),
		box('bar', 8, 55, 56, 5, color, {
			radius: 2.5,
			enabled: live ? false : expression(`${local('name')} != ''`),
			name: 'Section color',
		}),
	]
	const variables = [
		localValue('name', 'show_value', { field: live ? 'label' : 'next_section' }),
		localValue('color', 'show_value', { field: live ? 'section_color' : 'next_section_color' }),
	]
	const name = `Slide: ${kind} section`
	return alternatives(
		layered(name, elements, steps, [], variables),
		simple(name, `${kind.toUpperCase()}\\n$(${LABEL}:${live ? 'section_name' : 'next_section_name'})`, steps),
	)
}

/** A number in big type with a caption under it: the slide count, or the slides left. */
function count(field: 'position' | 'slides_left', title: string): Preset {
	const name = `Slide: ${title}`
	const elements = [
		tileBase(),
		label('value', expression(local('value')), 4, 8, 64, 34, WHITE, { size: 100, name: 'Number' }),
		caption(title, DIM),
	]
	const variable =
		field === 'position' ? `$(${LABEL}:slide_number) / $(${LABEL}:slide_count)` : `$(${LABEL}:slides_left)`
	return alternatives(
		layered(name, elements, press(), [], [localValue('value', 'show_value', { field })]),
		simple(name, `${variable}\\n${title}`, press()),
	)
}

/** A section button: it takes the name and color of section N of whatever presentation is live. */
function section(slot: number): Preset {
	const name = `Section ${slot}`
	const steps = press({ actionId: 'section_goto', options: { by: 'position', position: String(slot), name: '' } })
	const lit = { feedbackId: 'section_live' as const, options: { by: 'position', position: String(slot), name: '' } }
	const hasName = expression(`${local('name')} != ''`)
	const elements = [
		tileBase(),
		// A slot the live presentation has no section for says which slot it is, dimmed.
		label(
			'name',
			expression(`${local('name')} != '' ? ${local('name')} : 'Section ${slot}'`),
			4,
			20,
			64,
			30,
			expression(`${local('name')} != '' ? ${WHITE} : ${dimmed(DIM, 0.5)}`),
			{
				size: 46,
			},
		),
		box('bar', 8, 55, 56, 5, expression(local('color')), { radius: 2.5, enabled: hasName, name: 'Section color' }),
		box('underline', 26, 52, 20, 3, 0x0b0b0b, { radius: 1.5, enabled: false, name: 'Live underline' }),
	]
	const feedbacks = [
		when(lit, [
			set('tile', 'color', expression(local('color'))),
			set('tile', 'borderColor', expression(local('color'))),
			set('name', 'color', 0x0b0b0b),
			set('bar', 'enabled', false),
			set('underline', 'enabled', true),
		]),
	]
	const variables = [
		localValue('name', 'section_value', { position: String(slot), field: 'name' }),
		localValue('color', 'section_value', { position: String(slot), field: 'color' }),
	]
	return alternatives(
		layered(`Slide: ${name}`, elements, steps, feedbacks, variables),
		simple(`Slide: ${name}`, `$(${LABEL}:section_${slot}_name)`, steps, [
			whenSimple(lit, { bgcolor: FAMILY.conf.bright, color: FAMILY.conf.ink }),
		]),
	)
}

/**
 * A clear button never fills, because a slide is up for most of a service. Dim while its layer
 * is empty; bright with a ring while there is something to clear.
 */
function clearTarget(target: string, name: string, icon: string): Preset {
	const red = FAMILY.clear.bright
	const steps = press({ actionId: 'clear', options: { target } })
	const lit = { feedbackId: 'live' as const, options: { target } }
	const elements = [
		tileBase(),
		glyph('glyph', `${icon}.clear.x.dim`),
		glyph('glyphLit', `${icon}.clear.x`, false),
		caption(name, DIM),
	]
	const feedbacks = [
		when(lit, [
			set('tile', 'borderColor', red),
			set('tile', 'borderWidth', 3.47),
			set('glyph', 'enabled', false),
			set('glyphLit', 'enabled', true),
			set('caption', 'color', WHITE),
		]),
	]
	return alternatives(
		layered(`Clear: ${name}`, elements, steps, feedbacks),
		simple(`Clear: ${name}`, `Clear\\n${name}`, steps, [whenSimple(lit, { color: red })], { color: DIM }),
	)
}

function combo(id: string, name: string, colorHex: string | undefined, iconName: string | undefined): Preset {
	const color = hexColor(colorHex, FAMILY.go.bright)
	const ink = inkOn(color)
	const icon = COMBO_GLYPHS[iconName ?? ''] ?? 'zap'
	const steps = press({ actionId: 'combo_run', options: { combo: id } })
	return alternatives(
		layered(
			`Action Combo: ${name}`,
			[tileBase(color, color), glyph('glyph', `${icon}.${ink === 0xffffff ? 'white' : 'dark'}`), caption(name, ink)],
			steps,
		),
		simple(`Action Combo: ${name}`, name, steps, [], { bgcolor: color, color: ink }),
	)
}

export function showPresets(state: SlidesState): { sections: Section[]; presets: Presets } {
	const presets: Presets = {
		slide_previous: nav('previous'),
		slide_next: nav('next'),
		slide_now: thumb('live'),
		slide_upcoming: thumb('next'),
		slide_current_picture: pictureOnly('live'),
		slide_next_picture: pictureOnly('next'),
		slide_current_section: sectionNow('live'),
		slide_next_section: sectionNow('next'),
		slide_position: count('position', 'Slide'),
		slides_left: count('slides_left', 'Slides Left'),
		service_item_previous: tile({
			name: 'Service: Previous item',
			family: 'go',
			icon: 'chevrons-left',
			label: 'Previous\nItem',
			steps: press({ actionId: 'service_item', options: { direction: 'previous' } }),
		}),
		service_item_next: tile({
			name: 'Service: Next item',
			family: 'go',
			icon: 'chevrons-right',
			label: 'Next\nItem',
			steps: press({ actionId: 'service_item', options: { direction: 'next' } }),
		}),
		service_start: tile({
			name: 'Service: Start',
			family: 'go',
			icon: 'flag',
			label: 'Start\nService',
			steps: press({ actionId: 'service_start', options: {} }),
			lit: { feedbackId: 'service_state', options: { state: 'running' } },
		}),
		clear_all: tile({
			name: 'Clear All',
			family: 'clear',
			icon: 'x',
			label: 'Clear All',
			steps: press({ actionId: 'clear_all', options: {} }),
			lit: { feedbackId: 'live', options: { target: 'anything' } },
		}),
		clear_slides: clearTarget('slides', 'Slide', 'type'),
		clear_media: clearTarget('media', 'Media', 'image'),
		clear_overlays: clearTarget('overlays', 'Overlays', 'layers'),
		clear_audio: clearTarget('audio', 'Music', 'music'),
		clear_alerts: clearTarget('alerts', 'Alerts', 'bell'),
		clear_inputs: clearTarget('inputs', 'Inputs', 'video'),
	}
	const sectionIds: string[] = []
	for (let slot = 1; slot <= SECTION_SLOTS; slot++) {
		presets[`section_${slot}`] = section(slot)
		sectionIds.push(`section_${slot}`)
	}

	const combos = state.combos.length
		? state.combos
		: state.library['action-combos'].map((entry) => ({ ...entry, colorHex: undefined, iconName: undefined }))
	const comboIds = combos.map((entry) => {
		presets[`combo_${entry.id}`] = combo(entry.id, entry.name, entry.colorHex, entry.iconName)
		return `combo_${entry.id}`
	})

	const sections: Section[] = [
		{
			id: 'slides',
			name: 'Slides',
			description: 'Move through the live presentation, see what is on screen and what comes next.',
			definitions: [
				{
					id: 'slides_move',
					type: 'simple',
					name: 'Slides',
					description: 'Current and Next show the slide picture from MxU Slides with API 1.1 or newer.',
					presets: ['slide_previous', 'slide_next', 'slide_now', 'slide_upcoming'],
				},
				{
					id: 'slides_info',
					type: 'simple',
					name: 'One thing each',
					description: 'The picture, the section, the slide number or the slides left, each on its own button.',
					presets: [
						'slide_current_picture',
						'slide_next_picture',
						'slide_current_section',
						'slide_next_section',
						'slide_position',
						'slides_left',
					],
				},
				{
					id: 'slides_sections',
					type: 'simple',
					name: 'Sections',
					description:
						'Each button takes the name and color of a section of the live presentation, and lights on the one you are in.',
					presets: sectionIds,
				},
			],
		},
		{
			id: 'service',
			name: 'Service',
			definitions: ['service_item_previous', 'service_item_next', 'service_start'],
		},
		{
			id: 'clear',
			name: 'Clear',
			description: 'Dim while there is nothing to clear, bright while there is. Clear All takes everything down.',
			definitions: [
				'clear_all',
				'clear_slides',
				'clear_media',
				'clear_overlays',
				'clear_audio',
				'clear_alerts',
				'clear_inputs',
			],
		},
	]
	if (comboIds.length) {
		sections.push({
			id: 'combos',
			name: 'Action Combos',
			description: 'One button per Action Combo, in the color and with the icon it has in MxU Slides.',
			definitions: comboIds,
		})
	}
	return { sections, presets }
}
