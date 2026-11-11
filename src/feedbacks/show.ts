import type { CompanionFeedbackDefinitions, DropdownChoice } from '@companion-module/base'
import { Choices, CLEAR_TARGETS, LAYERS, number, text, type SlidesContext } from '../context.js'
import type { SlidesState } from '../state.js'
import { DIM, FAMILY, hexColor } from '../style.js'

export type ShowFeedbacks = {
	live: { type: 'boolean'; options: { target: string } }
	deck_live: { type: 'boolean'; options: { deck: string } }
	slide_number: { type: 'boolean'; options: { slide: string } }
	section_live: { type: 'boolean'; options: { by: string; position: string; name: string } }
	overlay_live: { type: 'boolean'; options: { overlay: string } }
	alert_showing: { type: 'boolean'; options: { match: string; preset: string; text: string } }
	service_state: { type: 'boolean'; options: { state: string } }
	show_value: { type: 'value'; options: { field: string } }
	section_value: { type: 'value'; options: { position: string; field: string } }
	slide_picture: { type: 'value'; options: { which: string } }
}

const ANY = 'any'

const LIVE_TARGETS: DropdownChoice<string>[] = [
	{ id: 'anything', label: 'Anything at all' },
	...CLEAR_TARGETS,
	...LAYERS.map((layer) => ({ id: `layer:${layer.id}`, label: `Layer: ${layer.label}` })),
]

/** Whether a clear target (or one layer) has something on it right now. */
export function isLive(state: SlidesState, target: string): boolean {
	const show = state.show
	const layers = show?.mediaLayers ?? {}
	const slides = !!show?.liveSlide
	const overlays = (show?.overlays.length ?? 0) > 0
	const alerts = !!show?.alert
	const music = (state.audio?.buses.length ?? 0) > 0
	const inputs = 'videoInput' in layers || state.videoInputs.some((input) => input.live)
	const media = Object.keys(layers).some((layer) => layer !== 'videoInput')
	switch (target) {
		case 'slides':
			return slides
		case 'media':
			return media
		case 'overlays':
			return overlays
		case 'audio':
			return music
		case 'alerts':
			return alerts
		case 'inputs':
			return inputs
		case 'anything':
			return slides || media || overlays || music || alerts || inputs
	}
	const layer = target.startsWith('layer:') ? target.slice(6) : target
	if (layer === 'slide') return slides
	if (layer === 'overlays') return overlays || show?.overlays.some((overlay) => overlay.layer === layer) === true
	if (layer === 'alerts') return alerts
	if (layer === 'videoInput') return inputs
	return layer in layers || show?.overlays.some((overlay) => overlay.layer === layer) === true
}

/** The live slide's number as people count it: the first slide is 1. 0 when nothing is live. */
export function slideNumber(state: SlidesState): number {
	const index = state.show?.liveSlide?.slideIndex
	return typeof index === 'number' ? index + 1 : 0
}

/** The position (from 0) of the live slide's section in the live presentation, or -1. */
export function liveSectionIndex(state: SlidesState): number {
	const live = state.show?.liveSlide
	const sections = state.show?.sections ?? []
	if (!live) return -1
	if (typeof live.slideIndex === 'number') {
		const index = live.slideIndex
		const byRange = sections.findIndex(
			(section) => index >= section.firstSlideIndex && index < section.firstSlideIndex + section.slideCount,
		)
		if (byRange >= 0) return byRange
	}
	return sections.findIndex((section) => section.id === live.sectionId)
}

const SHOW_FIELDS: DropdownChoice<string>[] = [
	{ id: 'position', label: 'Slide number of slide count (3 / 14)' },
	{ id: 'next_position', label: 'Next slide number of slide count (4 / 14)' },
	{ id: 'deck', label: 'Presentation name' },
	{ id: 'slide_number', label: 'Slide number' },
	{ id: 'slide_count', label: 'Slide count' },
	{ id: 'slide_name', label: 'Slide name' },
	{ id: 'text', label: 'Slide text' },
	{ id: 'next_text', label: 'Next slide text' },
	{ id: 'section', label: 'Section name' },
	{ id: 'section_color', label: 'Section color' },
	{ id: 'next_section', label: 'Next section name' },
	{ id: 'next_section_color', label: 'Next section color' },
	{ id: 'notes', label: 'Slide notes' },
	{ id: 'item', label: 'Current service item' },
	{ id: 'next_item', label: 'Next service item' },
]

export function showValue(state: SlidesState, field: string): string | number {
	const show = state.show
	const live = show?.liveSlide
	const next = show?.nextSlide
	const count = live?.slideCount ?? 0
	switch (field) {
		case 'position':
			return live ? `${slideNumber(state)} / ${count}` : ''
		case 'next_position':
			return typeof next?.slideIndex === 'number' ? `${next.slideIndex + 1} / ${count}` : ''
		case 'deck':
			return live?.presentationName ?? ''
		case 'slide_number':
			return slideNumber(state)
		case 'slide_count':
			return count
		case 'slide_name':
			return live?.slideName ?? ''
		case 'text':
			return live?.text ?? ''
		case 'next_text':
			return next?.text ?? show?.nextSlideText ?? ''
		case 'section':
			return live?.sectionName ?? ''
		case 'section_color':
			return hexColor(live?.sectionColorHex, DIM)
		case 'next_section':
			return next?.sectionName ?? ''
		case 'next_section_color':
			return hexColor(next?.sectionColorHex, DIM)
		case 'notes':
			return live?.notes ?? ''
		case 'item':
			return show?.position?.currentItemName ?? ''
		case 'next_item':
			return show?.position?.nextItemName ?? ''
		default:
			return ''
	}
}

export function showFeedbacks(ctx: SlidesContext, choices: Choices): CompanionFeedbackDefinitions<ShowFeedbacks> {
	const state = ctx.state
	const decks = choices.library('presentations')
	const overlays = [{ id: ANY, label: 'Any overlay' }, ...choices.library('overlays').filter((one) => one.id !== '')]
	const alertPresets = choices.library('alert-presets')

	return {
		live: {
			type: 'boolean',
			name: 'Something is live',
			description: 'True while there is something to clear: on a clear target, on one layer, or anywhere.',
			defaultStyle: { bgcolor: FAMILY.clear.bright, color: FAMILY.clear.ink },
			options: [
				{ id: 'target', type: 'dropdown', label: 'Where', choices: LIVE_TARGETS, default: 'slides', allowCustom: true },
			],
			callback: ({ options }) => isLive(state, text(options.target)),
		},
		deck_live: {
			type: 'boolean',
			name: 'Live presentation is',
			defaultStyle: { bgcolor: FAMILY.go.bright, color: FAMILY.go.ink },
			options: [
				{
					id: 'deck',
					type: 'dropdown',
					label: 'Presentation',
					choices: decks,
					default: Choices.first(decks),
					allowCustom: true,
				},
			],
			callback: ({ options }) => state.show?.liveSlide?.presentationId === text(options.deck),
		},
		slide_number: {
			type: 'boolean',
			name: 'Live slide number is',
			defaultStyle: { bgcolor: FAMILY.go.bright, color: FAMILY.go.ink },
			options: [
				{
					id: 'slide',
					type: 'textinput',
					label: 'Slide number',
					description: 'The first slide is 1.',
					default: '1',
					useVariables: true,
				},
			],
			callback: ({ options }) => slideNumber(state) > 0 && slideNumber(state) === Math.round(number(options.slide, -1)),
		},
		section_live: {
			type: 'boolean',
			name: 'Live section is',
			description: 'True while the live slide is in this section of the live presentation.',
			defaultStyle: { bgcolor: FAMILY.conf.bright, color: FAMILY.conf.ink },
			options: [
				{
					id: 'by',
					type: 'dropdown',
					label: 'Find the section by',
					disableAutoExpression: true,
					choices: [
						{ id: 'position', label: 'Position in the presentation' },
						{ id: 'name', label: 'Name' },
					],
					default: 'position',
				},
				{
					id: 'position',
					type: 'textinput',
					label: 'Section number',
					description: 'The first section is 1.',
					default: '1',
					useVariables: true,
					isVisibleExpression: "$(options:by) == 'position'",
				},
				{
					id: 'name',
					type: 'textinput',
					label: 'Section name',
					default: 'Chorus',
					useVariables: true,
					isVisibleExpression: "$(options:by) == 'name'",
				},
			],
			callback: ({ options }) => {
				if (text(options.by) === 'name') {
					const wanted = text(options.name).trim().toLowerCase()
					return wanted !== '' && (state.show?.liveSlide?.sectionName ?? '').trim().toLowerCase() === wanted
				}
				const index = liveSectionIndex(state)
				return index >= 0 && index === Math.round(number(options.position, 0)) - 1
			},
		},
		overlay_live: {
			type: 'boolean',
			name: 'Overlay is live',
			defaultStyle: { bgcolor: FAMILY.media.bright, color: FAMILY.media.ink },
			options: [
				{ id: 'overlay', type: 'dropdown', label: 'Overlay', choices: overlays, default: ANY, allowCustom: true },
			],
			callback: ({ options }) => {
				const wanted = text(options.overlay)
				const live = state.show?.overlays ?? []
				return wanted === ANY ? live.length > 0 : live.some((overlay) => overlay.id === wanted)
			},
		},
		alert_showing: {
			type: 'boolean',
			name: 'Alert is showing',
			defaultStyle: { bgcolor: FAMILY.conf.bright, color: FAMILY.conf.ink },
			options: [
				{
					id: 'match',
					type: 'dropdown',
					label: 'Which alert',
					disableAutoExpression: true,
					choices: [
						{ id: ANY, label: 'Any alert' },
						{ id: 'preset', label: 'One alert preset' },
						{ id: 'text', label: 'Text that contains' },
					],
					default: ANY,
				},
				{
					id: 'preset',
					type: 'dropdown',
					label: 'Alert preset',
					choices: alertPresets,
					default: Choices.first(alertPresets),
					allowCustom: true,
					isVisibleExpression: "$(options:match) == 'preset'",
				},
				{
					id: 'text',
					type: 'textinput',
					label: 'Text',
					default: '',
					useVariables: true,
					isVisibleExpression: "$(options:match) == 'text'",
				},
			],
			callback: ({ options }) => {
				const alert = state.show?.alert
				if (!alert) return false
				switch (text(options.match)) {
					case 'preset':
						return alert.id === text(options.preset)
					case 'text':
						return alert.message.toLowerCase().includes(text(options.text).toLowerCase())
					default:
						return true
				}
			},
		},
		service_state: {
			type: 'boolean',
			name: 'Service is',
			defaultStyle: { bgcolor: FAMILY.go.bright, color: FAMILY.go.ink },
			options: [
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					choices: [
						{ id: 'running', label: 'Running' },
						{ id: 'preService', label: 'Before the start (pre-service)' },
						{ id: 'ended', label: 'Ended' },
						{ id: 'idle', label: 'Not tracking' },
					],
					default: 'running',
				},
			],
			callback: ({ options }) => (state.serviceTracking?.state ?? 'idle') === text(options.state),
		},
		show_value: {
			type: 'value',
			name: 'Show: a value',
			description: 'A piece of the live show for a text, a color or an expression on a button.',
			options: [{ id: 'field', type: 'dropdown', label: 'Value', choices: SHOW_FIELDS, default: 'position' }],
			callback: ({ options }) => showValue(state, text(options.field)),
		},
		section_value: {
			type: 'value',
			name: 'Section: name or color',
			description: 'A section of the live presentation by position, so a button can rename itself with each song.',
			options: [
				{
					id: 'position',
					type: 'textinput',
					label: 'Section number',
					description: 'The first section is 1.',
					default: '1',
					useVariables: true,
				},
				{
					id: 'field',
					type: 'dropdown',
					label: 'Value',
					choices: [
						{ id: 'name', label: 'Name' },
						{ id: 'color', label: 'Color' },
					],
					default: 'name',
				},
			],
			callback: ({ options }) => {
				const section = state.show?.sections?.[Math.round(number(options.position, 0)) - 1]
				return text(options.field) === 'color' ? hexColor(section?.colorHex, DIM) : (section?.name ?? '')
			},
		},
		slide_picture: {
			type: 'value',
			name: 'Slide picture',
			description: 'The picture of the live or the next slide, for an image element.',
			options: [
				{
					id: 'which',
					type: 'dropdown',
					label: 'Slide',
					choices: [
						{ id: 'live', label: 'The live slide' },
						{ id: 'next', label: 'The next slide' },
					],
					default: 'live',
				},
			],
			callback: ({ options }) => state.pictures[text(options.which) === 'next' ? 'next' : 'live'],
		},
	}
}
