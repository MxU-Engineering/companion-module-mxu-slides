import type { CompanionFeedbackDefinitions, DropdownChoice } from '@companion-module/base'
import { VIDEO_TARGETS, videoRow } from '../actions/media.js'
import { Choices, text, type SlidesContext } from '../context.js'
import type { SlidesState } from '../state.js'
import { FAMILY, TRANSPORT } from '../style.js'
import { clamp01, formatClock, transportPosition } from '../time.js'

export type MediaFeedbacks = {
	video_playing: { type: 'boolean'; options: { target: string } }
	music_playing: { type: 'boolean'; options: { playlist: string } }
	music_paused: { type: 'boolean'; options: Record<string, never> }
	video_input_live: { type: 'boolean'; options: { input: string } }
	timeline_playing: { type: 'boolean'; options: Record<string, never> }
	video_value: { type: 'value'; options: { target: string; field: string } }
}

const ANY = 'any'

const VIDEO_FIELDS: DropdownChoice<string>[] = [
	{ id: 'remaining', label: 'Time left (-1:24)' },
	{ id: 'position', label: 'Position (0:36)' },
	{ id: 'length', label: 'Length (2:00)' },
	{ id: 'progress', label: 'How far through, 0 to 1' },
	{ id: 'name', label: 'Name' },
]

export function videoValue(state: SlidesState, target: string, field: string, now: number): string | number {
	const row = videoRow(state, target)
	if (!row) return field === 'progress' ? 0 : ''
	const position = transportPosition(row, state.transportAt, now)
	switch (field) {
		case 'remaining':
			return row.duration > 0 ? `-${formatClock(Math.max(0, row.duration - position))}` : ''
		case 'position':
			return formatClock(position)
		case 'length':
			return formatClock(row.duration)
		case 'progress':
			return row.duration > 0 ? Math.round(clamp01(position / row.duration) * 1000) / 1000 : 0
		default:
			return row.name
	}
}

export function mediaFeedbacks(ctx: SlidesContext, choices: Choices): CompanionFeedbackDefinitions<MediaFeedbacks> {
	const state = ctx.state
	const playlists = [{ id: ANY, label: 'Anything' }, ...choices.library('playlists').filter((one) => one.id !== '')]
	const inputs = choices.videoInputs()

	return {
		video_playing: {
			type: 'boolean',
			name: 'Video is playing',
			description: 'True while a video is playing, on either layer or on one.',
			defaultStyle: { bgcolor: FAMILY.media.bright, color: FAMILY.media.ink },
			options: [
				{
					id: 'target',
					type: 'dropdown',
					label: 'Video',
					choices: VIDEO_TARGETS,
					default: ANY,
					disableAutoExpression: true,
				},
			],
			callback: ({ options }) => {
				const target = text(options.target)
				if (target === ANY || target === '') return state.transport.some((row) => row.playing)
				return videoRow(state, target)?.playing === true
			},
		},
		music_playing: {
			type: 'boolean',
			name: 'Music is playing',
			description: 'True while music plays, or while one playlist plays.',
			defaultStyle: { bgcolor: FAMILY.audio.bright, color: FAMILY.audio.ink },
			options: [
				{ id: 'playlist', type: 'dropdown', label: 'Playing', choices: playlists, default: ANY, allowCustom: true },
			],
			callback: ({ options }) => {
				const wanted = text(options.playlist)
				const buses = state.audio?.buses ?? []
				return buses.some((bus) => bus.playing && (wanted === ANY || wanted === '' || bus.playlistId === wanted))
			},
		},
		music_paused: {
			type: 'boolean',
			name: 'Music is paused',
			description: 'True while music is loaded but not playing.',
			defaultStyle: { bgcolor: TRANSPORT.paused, color: 0x000000 },
			options: [],
			callback: () => {
				const buses = state.audio?.buses ?? []
				return buses.length > 0 && !buses.some((bus) => bus.playing)
			},
		},
		video_input_live: {
			type: 'boolean',
			name: 'Video input is live',
			description: 'True while this camera, NDI or Blackmagic input is on screen.',
			defaultStyle: { bgcolor: FAMILY.media.bright, color: FAMILY.media.ink },
			options: [
				{
					id: 'input',
					type: 'dropdown',
					label: 'Video input',
					choices: inputs,
					default: Choices.first(inputs),
					allowCustom: true,
				},
			],
			callback: ({ options }) => state.videoInputs.find((input) => input.id === text(options.input))?.live === true,
		},
		timeline_playing: {
			type: 'boolean',
			name: 'Timeline is playing',
			description: 'True while the MxU Slides timeline plays.',
			defaultStyle: { bgcolor: FAMILY.media.bright, color: FAMILY.media.ink },
			options: [],
			callback: () => state.timecode?.timeline?.running === true,
		},
		video_value: {
			type: 'value',
			name: 'Video: a value',
			description: 'Time left, position or progress of a playing video, counted every second.',
			options: [
				{
					id: 'target',
					type: 'dropdown',
					label: 'Video',
					choices: VIDEO_TARGETS,
					default: ANY,
					disableAutoExpression: true,
				},
				{
					id: 'field',
					type: 'dropdown',
					label: 'Value',
					choices: VIDEO_FIELDS,
					default: 'remaining',
					disableAutoExpression: true,
				},
			],
			callback: ({ options }) => videoValue(state, text(options.target), text(options.field), Date.now()),
		},
	}
}
