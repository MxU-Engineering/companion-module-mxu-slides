import type { CompanionActionDefinitions, DropdownChoice } from '@companion-module/base'
import type { TransportRow } from '../api/types.js'
import { Choices, text, type SlidesContext } from '../context.js'
import type { SlidesState } from '../state.js'
import { parseDuration, transportPosition } from '../time.js'

export type MediaActions = {
	media_fire: { options: { media: string } }
	video_transport: { options: { target: string; action: string; seconds: string } }
	video_input_fire: { options: { input: string } }
	timeline: { options: { action: string } }
	overlay: { options: { overlay: string; mode: string } }
	alert_preset: { options: { preset: string; tokens: string } }
	alert_text: { options: { message: string; target: string; behavior: string } }
	alert_hide: { options: Record<string, never> }
}

/** Which playing video a transport action or feedback means. */
export const VIDEO_TARGETS: DropdownChoice<string>[] = [
	{ id: 'any', label: 'The video that is playing' },
	{ id: 'videos', label: 'Foreground Videos' },
	{ id: 'loopingVideos', label: 'Background Media' },
]

/** The transport row a target names: a layer's video, or the foreground one before the background. */
export function videoRow(state: SlidesState, target: string): TransportRow | undefined {
	if (target && target !== 'any') return state.transport.find((row) => row.layer === target)
	return (
		state.transport.find((row) => row.layer === 'videos') ??
		state.transport.find((row) => row.playing) ??
		state.transport[0]
	)
}

/** Reads `name=value` pairs, one per line or separated by commas. */
export function parseTokens(input: string): Record<string, string> {
	const tokens: Record<string, string> = {}
	for (const part of input.split(/[\n,]/)) {
		const split = part.indexOf('=')
		if (split < 1) continue
		tokens[part.slice(0, split).trim()] = part.slice(split + 1).trim()
	}
	return tokens
}

export function mediaActions(ctx: SlidesContext, choices: Choices): CompanionActionDefinitions<MediaActions> {
	const media = choices.library('media')
	const overlays = choices.library('overlays')
	const alertPresets = choices.library('alert-presets')
	const videoInputs = choices.videoInputs()

	return {
		media_fire: {
			name: 'Media: Play item',
			description: 'Puts a media item on its own layer.',
			options: [
				{
					id: 'media',
					type: 'dropdown',
					label: 'Media',
					choices: media,
					default: Choices.first(media),
					allowCustom: true,
				},
			],
			callback: async ({ options }) => {
				const id = encodeURIComponent(text(options.media))
				await ctx.run('Media: Play item', undefined, async (client) => client.post(`/v1/media/${id}/fire`))
			},
		},
		video_transport: {
			name: 'Video: Play, Pause, Restart, Seek',
			options: [
				{ id: 'target', type: 'dropdown', label: 'Video', choices: VIDEO_TARGETS, default: 'any' },
				{
					id: 'action',
					type: 'dropdown',
					label: 'Do',
					choices: [
						{ id: 'toggle', label: 'Play / Pause' },
						{ id: 'resume', label: 'Play' },
						{ id: 'pause', label: 'Pause' },
						{ id: 'reset', label: 'Restart' },
						{ id: 'seek', label: 'Go to a time' },
						{ id: 'skip', label: 'Skip forward or back' },
						{ id: 'end', label: 'Go to the end, less some time' },
					],
					default: 'toggle',
				},
				{
					id: 'seconds',
					type: 'textinput',
					label: 'Time',
					description: 'Seconds or a clock: 90, 1:30. For Skip, a minus goes back: -10.',
					default: '10',
					useVariables: true,
					isVisibleExpression:
						"$(options:action) == 'seek' || $(options:action) == 'skip' || $(options:action) == 'end'",
				},
			],
			callback: async ({ options }) => {
				const name = 'Video: Play, Pause, Restart, Seek'
				await ctx.run(name, undefined, async (client) => {
					const row = videoRow(ctx.state, text(options.target))
					if (!row) throw new Error('no video is playing')
					const action = text(options.action)
					const path = `/v1/transport/${encodeURIComponent(row.mediaId)}`
					if (action !== 'seek' && action !== 'skip' && action !== 'end') {
						await client.post(path, { action })
						return
					}
					const amount = parseDuration(text(options.seconds))
					if (amount === undefined) throw new Error(`"${text(options.seconds)}" is not a time`)
					const now = transportPosition(row, ctx.state.transportAt, Date.now())
					const wanted = action === 'seek' ? amount : action === 'skip' ? now + amount : row.duration - amount
					const position = Math.max(0, row.duration > 0 ? Math.min(wanted, row.duration) : wanted)
					await client.post(path, { action: 'seek', position })
				})
			},
		},
		video_input_fire: {
			name: 'Video Input: Go live',
			description: 'Puts a camera, NDI or Blackmagic input on screen.',
			options: [
				{
					id: 'input',
					type: 'dropdown',
					label: 'Video input',
					choices: videoInputs,
					default: Choices.first(videoInputs),
					allowCustom: true,
				},
			],
			callback: async ({ options }) => {
				const id = encodeURIComponent(text(options.input))
				await ctx.run('Video Input: Go live', '1.1', async (client) => client.post(`/v1/inputs/video/${id}/fire`))
			},
		},
		timeline: {
			name: 'Timeline: Play, Stop, Rewind',
			options: [
				{
					id: 'action',
					type: 'dropdown',
					label: 'Do',
					choices: [
						{ id: 'play', label: 'Play' },
						{ id: 'stop', label: 'Stop' },
						{ id: 'rewind', label: 'Rewind' },
					],
					default: 'play',
				},
			],
			callback: async ({ options }) => {
				await ctx.run('Timeline: Play, Stop, Rewind', '1.1', async (client) =>
					client.post('/v1/timeline', { action: text(options.action) }),
				)
			},
		},
		overlay: {
			name: 'Overlay: Show, Hide, Toggle',
			options: [
				{
					id: 'overlay',
					type: 'dropdown',
					label: 'Overlay',
					choices: overlays,
					default: Choices.first(overlays),
					allowCustom: true,
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Do',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'show', label: 'Show' },
						{ id: 'hide', label: 'Hide' },
					],
					default: 'toggle',
				},
			],
			callback: async ({ options }) => {
				const overlay = text(options.overlay)
				const live = ctx.state.show?.overlays.some((candidate) => candidate.id === overlay) ?? false
				const mode = text(options.mode)
				const show = mode === 'toggle' ? !live : mode === 'show'
				const id = encodeURIComponent(overlay)
				await ctx.run('Overlay: Show, Hide, Toggle', undefined, async (client) =>
					client.post(`/v1/overlays/${id}/${show ? 'fire' : 'dismiss'}`),
				)
			},
		},
		alert_preset: {
			name: 'Alert: Show preset',
			options: [
				{
					id: 'preset',
					type: 'dropdown',
					label: 'Alert preset',
					choices: alertPresets,
					default: Choices.first(alertPresets),
					allowCustom: true,
				},
				{
					id: 'tokens',
					type: 'textinput',
					label: 'Fill-ins',
					description:
						'One per blank in the preset, as name=value. Separate several with commas: number=214, room=Nursery',
					default: '',
					useVariables: true,
				},
			],
			callback: async ({ options }) => {
				const tokens = parseTokens(text(options.tokens))
				await ctx.run('Alert: Show preset', undefined, async (client) =>
					client.post('/v1/alerts/fire', {
						presetId: text(options.preset),
						...(Object.keys(tokens).length ? { tokens } : {}),
					}),
				)
			},
		},
		alert_text: {
			name: 'Alert: Show text',
			options: [
				{ id: 'message', type: 'textinput', label: 'Message', default: '', useVariables: true },
				{
					id: 'target',
					type: 'dropdown',
					label: 'Show on',
					choices: [
						{ id: 'confidence', label: 'Confidence Monitor' },
						{ id: 'audience', label: 'Audience' },
						{ id: 'both', label: 'Audience and Confidence Monitor' },
					],
					default: 'confidence',
				},
				{
					id: 'behavior',
					type: 'dropdown',
					label: 'How',
					choices: [
						{ id: 'persist', label: 'Stay up until hidden' },
						{ id: 'flash', label: 'Flash' },
					],
					default: 'persist',
				},
			],
			callback: async ({ options }) => {
				await ctx.run('Alert: Show text', undefined, async (client) => {
					const message = text(options.message)
					if (!message.trim()) throw new Error('the message is empty')
					await client.post('/v1/alerts/fire', {
						message,
						target: text(options.target),
						behavior: text(options.behavior),
					})
				})
			},
		},
		alert_hide: {
			name: 'Alert: Hide',
			options: [],
			callback: async () => {
				await ctx.run('Alert: Hide', undefined, async (client) => client.post('/v1/alerts/dismiss'))
			},
		},
	}
}
