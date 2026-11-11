import type { CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from '../main.js'
import type { SlidesState } from '../state.js'
import { DIM, FAMILY, hexColor, inkOn, WHITE } from '../style.js'
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
	type Preset,
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

/** A filled arrow key: Previous and Next are the two buttons that are always lit. */
function nav(direction: 'next' | 'previous'): Preset {
	const next = direction === 'next'
	const name = next ? 'Next' : 'Previous'
	const steps = press(
		next ? { actionId: 'slide_next', options: { skipBuilds: false } } : { actionId: 'slide_previous', options: {} },
	)
	const go = FAMILY.go
	return alternatives(
		layered(
			`Slide: ${name}`,
			[
				tileBase(go.bright, go.bright),
				glyph('glyph', `arrow-${next ? 'right' : 'left'}.go.ink`),
				caption(name, go.ink),
			],
			steps,
		),
		simple(`Slide: ${name}`, name, steps, [], { bgcolor: go.bright, color: go.ink }),
	)
}

/** Now and Next: the slide picture, its number, and its section in the section's own color. */
function thumb(which: 'live' | 'next'): Preset {
	const live = which === 'live'
	const name = live ? 'Now' : 'Next'
	const steps = live ? press() : press({ actionId: 'slide_next', options: { skipBuilds: false } })
	const ring = live ? FAMILY.clear.bright : 0x55554f
	const frame = live ? 2 : 1
	const elements = [
		tileBase(),
		box('ring', 4, 5, 64, 37, ring, { radius: 3, name: 'Picture ring' }),
		box('pictureBack', 4 + frame, 5 + frame, 64 - frame * 2, 37 - frame * 2, 0x0c1220, {
			radius: 2,
			name: 'Picture back',
		}),
		{
			type: 'image' as const,
			id: 'picture',
			name: 'Slide picture',
			x: pct(4 + frame),
			y: pct(5 + frame),
			width: pct(64 - frame * 2),
			height: pct(37 - frame * 2),
			base64Image: expression(local('picture')),
			fillMode: 'fit' as const,
			halign: 'center' as const,
			valign: 'center' as const,
		},
		label('kind', name.toUpperCase(), 5, 45.5, 28, 9.5, live ? FAMILY.clear.bright : DIM, { halign: 'left', size: 92 }),
		label('position', expression(local('position')), 30, 45.5, 37, 9.5, WHITE, { halign: 'right', size: 100 }),
		box('pill', 5, 57, 62, 10.5, expression(local('color')), { radius: 5.25, name: 'Section pill' }),
		label('section', expression(local('section')), 7, 57.4, 58, 10, 0x0b0b0b, { size: 88 }),
	]
	const variables = [
		localValue('picture', 'slide_picture', { which }),
		localValue('position', 'show_value', { field: live ? 'position' : 'next_position' }),
		localValue('section', 'show_value', { field: live ? 'section' : 'next_section' }),
		localValue('color', 'show_value', { field: live ? 'section_color' : 'next_section_color' }),
	]
	const text = live
		? `NOW $(${LABEL}:slide_number) / $(${LABEL}:slide_count)\\n$(${LABEL}:section_name)`
		: `NEXT\\n$(${LABEL}:next_section_name)`
	return alternatives(layered(`Slide: ${name}`, elements, steps, [], variables), simple(`Slide: ${name}`, text, steps))
}

/** A section button: it takes the name and color of section N of whatever presentation is live. */
function section(slot: number): Preset {
	const name = `Section ${slot}`
	const steps = press({ actionId: 'section_goto', options: { by: 'position', position: String(slot), name: '' } })
	const lit = { feedbackId: 'section_live' as const, options: { by: 'position', position: String(slot), name: '' } }
	const hasName = expression(`${local('name')} != ''`)
	const elements = [
		tileBase(),
		label('name', expression(local('name')), 4, 20, 64, 30, WHITE, { size: 46 }),
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
			look: 'always',
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
					description: 'Now and Next show the slide picture from MxU Slides with API 1.1 or newer.',
					presets: ['slide_previous', 'slide_next', 'slide_now', 'slide_upcoming'],
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
