import type { CompanionActionDefinitions } from '@companion-module/base'
import { Choices, CLEAR_TARGETS, LAYERS, number, picked, text, type SlidesContext } from '../context.js'

export type ShowActions = {
	slide_next: { options: { skipBuilds: boolean } }
	slide_previous: { options: Record<string, never> }
	slide_goto: { options: { deck: string; slide: number } }
	section_goto: { options: { by: string; position: number; name: string } }
	service_item: { options: { direction: string } }
	service_select: { options: { service: string } }
	service_start: { options: Record<string, never> }
	clear_all: { options: Record<string, never> }
	clear: { options: { target: string } }
	clear_layer: { options: { layer: string } }
}

const LIVE_DECK = 'live'

export function showActions(ctx: SlidesContext, choices: Choices): CompanionActionDefinitions<ShowActions> {
	const decks = [
		{ id: LIVE_DECK, label: 'The live presentation' },
		...choices.library('presentations').filter((deck) => deck.id !== ''),
	]
	const services = choices.library('services')

	/** The body that fires a slide of the live presentation by its position in the run (from 0). */
	const liveSlideBody = (index: number): object => {
		const live = ctx.state.show?.liveSlide
		if (!live) throw new Error('nothing is live, so there is no presentation to move in')
		return live.serviceItemId
			? { serviceItemId: live.serviceItemId, occurrence: index }
			: { presentationId: live.presentationId, slideIndex: index }
	}

	return {
		slide_next: {
			name: 'Slide: Next',
			description: 'Walks the builds of the live slide first, like the right arrow key.',
			options: [
				{
					id: 'skipBuilds',
					type: 'checkbox',
					label: 'Skip the builds and cut to the next slide',
					default: false,
				},
			],
			callback: async ({ options }, { signal }) => {
				await ctx.run('Slide: Next', undefined, signal, async (client) =>
					client.post('/v1/show/advance', { steps: 1, settled: options.skipBuilds === true }),
				)
			},
		},
		slide_previous: {
			name: 'Slide: Previous',
			description: 'Steps back through the builds of the live slide first, like the left arrow key.',
			options: [],
			callback: async (_action, { signal }) => {
				await ctx.run('Slide: Previous', undefined, signal, async (client) =>
					client.post('/v1/show/advance', { steps: -1 }),
				)
			},
		},
		slide_goto: {
			name: 'Slide: Go to slide',
			description: 'Puts one slide of a presentation on screen, by its number.',
			options: [
				{ id: 'deck', type: 'dropdown', label: 'Presentation', choices: decks, default: LIVE_DECK, allowCustom: true },
				{
					id: 'slide',
					type: 'number',
					label: 'Slide number',
					description: 'The first slide is 1, as in the grid in MxU Slides.',
					default: 1,
					min: 1,
					max: 9999,
					asInteger: true,
					clampValues: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				const index = Math.round(number(options.slide, Number.NaN)) - 1
				if (!(index >= 0)) {
					ctx.log('warn', `Slide: Go to slide: "${text(options.slide)}" is not a slide number. The first slide is 1.`)
					return
				}
				const deck = text(options.deck)
				const live = deck === LIVE_DECK || deck === ''
				await ctx.run('Slide: Go to slide', undefined, signal, async (client) =>
					client.post('/v1/show/slide', live ? liveSlideBody(index) : { presentationId: deck, slideIndex: index }),
				)
			},
		},
		section_goto: {
			name: 'Slide: Go to section',
			description: 'Jumps to a section of the live presentation, such as Verse 1 or Chorus.',
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
					type: 'number',
					label: 'Section number',
					description: 'The first section is 1.',
					default: 1,
					min: 1,
					max: 99,
					asInteger: true,
					clampValues: true,
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
			callback: async ({ options }, { signal }) => {
				await ctx.run('Slide: Go to section', '1.1', signal, async (client) => {
					const sections = ctx.state.show?.sections ?? []
					const wanted = text(options.name).trim().toLowerCase()
					const section =
						text(options.by) === 'name'
							? sections.find((candidate) => candidate.name.trim().toLowerCase() === wanted)
							: sections[Math.round(number(options.position, 1)) - 1]
					if (!section) throw new Error('the live presentation has no such section')
					await client.post('/v1/show/slide', liveSlideBody(section.firstSlideIndex))
				})
			},
		},
		service_item: {
			name: 'Service: Next / Previous item',
			description: 'Moves to the next or previous item of the service.',
			options: [
				{
					id: 'direction',
					type: 'dropdown',
					label: 'Go to',
					disableAutoExpression: true,
					choices: [
						{ id: 'next', label: 'Next item' },
						{ id: 'previous', label: 'Previous item' },
					],
					default: 'next',
				},
			],
			callback: async ({ options }, { signal }) => {
				const steps = text(options.direction) === 'previous' ? -1 : 1
				await ctx.run('Service: Next / Previous item', '1.1', signal, async (client) =>
					client.post('/v1/show/advance-item', { steps }),
				)
			},
		},
		service_select: {
			name: 'Service: Select service',
			description: 'Picks the service that Next walks through.',
			options: [
				{
					id: 'service',
					type: 'dropdown',
					label: 'Service',
					choices: services,
					default: Choices.first(services),
					allowCustom: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				const service = picked(ctx, 'Service: Select service', 'a service', options.service)
				if (!service) return
				const id = encodeURIComponent(service)
				await ctx.run('Service: Select service', undefined, signal, async (client) =>
					client.post(`/v1/services/${id}/select`),
				)
			},
		},
		service_start: {
			name: 'Service: Start',
			description: 'Starts the service now, the same as Start (or Start early) in MxU Slides.',
			options: [],
			callback: async (_action, { signal }) => {
				await ctx.run('Service: Start', '1.1', signal, async (client) => client.post('/v1/service-tracking/start'))
			},
		},
		clear_all: {
			name: 'Clear All',
			description: 'Takes everything off every screen at once.',
			options: [],
			callback: async (_action, { signal }) => {
				await ctx.run('Clear All', undefined, signal, async (client) => client.post('/v1/show/clear-all'))
			},
		},
		clear: {
			name: 'Clear',
			description: 'Takes one kind of thing off every screen, such as the slide or the music.',
			options: [
				{
					id: 'target',
					type: 'dropdown',
					label: 'Clear',
					choices: CLEAR_TARGETS,
					default: 'slides',
					disableAutoExpression: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				await ctx.run('Clear', undefined, signal, async (client) =>
					client.post('/v1/show/clear', { function: text(options.target) }),
				)
			},
		},
		clear_layer: {
			name: 'Clear Layer',
			description: 'Takes down whatever is on one layer.',
			options: [
				{
					id: 'layer',
					type: 'dropdown',
					label: 'Layer',
					description: 'For a custom layer, type its id from MxU Slides.',
					choices: LAYERS,
					default: 'slide',
					allowCustom: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				await ctx.run('Clear Layer', undefined, signal, async (client) =>
					client.post('/v1/show/clear', { layer: text(options.layer) }),
				)
			},
		},
	}
}
