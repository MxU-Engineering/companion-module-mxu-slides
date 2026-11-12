import type { CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from '../main.js'
import type { SlidesState } from '../state.js'
import { DIM, FAMILY, TRACK, TRANSPORT, WHITE } from '../style.js'
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

const BAR = { x: 8, y: 52, width: 56, height: 4 }

/** Play / Pause with the time left, a progress bar and the video's name. */
function transport(): Preset {
	const steps = press({ actionId: 'video_transport', options: { target: 'any', action: 'toggle', seconds: '0' } })
	const playing = { feedbackId: 'video_playing' as const, options: { target: 'any' } }
	const elements = [
		tileBase(),
		glyph('idle', 'play.media.small.dim', expression(`${local('name')} == ''`)),
		glyph('paused', 'play.paused.small', expression(`${local('name')} != ''`)),
		glyph('pause', 'pause.running.small', false),
		label('remaining', expression(local('remaining')), 4, 37, 64, 14, WHITE, { size: 96 }),
		box('track', BAR.x, BAR.y, BAR.width, BAR.height, TRACK, { radius: 2, name: 'Bar track' }),
		box('bar', BAR.x, BAR.y, expression(`${local('progress')} * ${pct(BAR.width)}`), BAR.height, FAMILY.media.bright, {
			radius: 2,
			name: 'Bar',
		}),
		label('name', expression(local('name')), 4, 58.5, 64, 11, DIM, { size: 86, weight: 'normal' }),
	]
	const variables = [
		localValue('name', 'video_value', { target: 'any', field: 'name' }),
		localValue('remaining', 'video_value', { target: 'any', field: 'remaining' }),
		localValue('progress', 'video_value', { target: 'any', field: 'progress' }),
	]
	return alternatives(
		layered(
			'Video: Play / Pause',
			elements,
			steps,
			[when(playing, [set('idle', 'enabled', false), set('paused', 'enabled', false), set('pause', 'enabled', true)])],
			variables,
		),
		simple('Video: Play / Pause', `$(${LABEL}:video_name)\\n-$(${LABEL}:video_remaining)`, steps, [
			whenSimple(playing, { color: TRANSPORT.running }),
		]),
	)
}

/** Play / Pause for music: the glyph says what a press will do. */
function musicPlayPause(): Preset {
	const steps = press({ actionId: 'music_transport', options: { action: 'playPause', position: '0' } })
	const playing = { feedbackId: 'music_playing' as const, options: { playlist: 'any' } }
	const paused = { feedbackId: 'music_paused' as const, options: {} }
	return alternatives(
		layered(
			'Music: Play / Pause',
			[
				tileBase(),
				glyph('glyph', 'play.rest'),
				glyph('glyphPaused', 'play.action', false),
				glyph('glyphLit', 'pause.running', false),
				caption('Play', WHITE),
			],
			steps,
			[
				when(paused, [
					set('glyph', 'enabled', false),
					set('glyphPaused', 'enabled', true),
					set('caption', 'text', 'Resume'),
				]),
				when(playing, [
					set('glyph', 'enabled', false),
					set('glyphLit', 'enabled', true),
					set('caption', 'text', 'Pause'),
				]),
			],
		),
		simple('Music: Play / Pause', 'Music\\nPlay', steps, [
			whenSimple(paused, { text: 'Music\\nResume', color: TRANSPORT.paused }),
			whenSimple(playing, { text: 'Music\\nPause', color: TRANSPORT.running }),
		]),
	)
}

/** Stop is grey while there is nothing to stop; red with a ring while music is up (playing or paused). */
function musicStop(): Preset {
	const steps = press({ actionId: 'music_transport', options: { action: 'stop', position: '0' } })
	const up = { feedbackId: 'live' as const, options: { target: 'audio' } }
	return alternatives(
		layered(
			'Music: Stop',
			[tileBase(), glyph('glyph', 'square.rest'), glyph('glyphLit', 'square.stop', false), caption('Stop', DIM)],
			steps,
			[
				when(up, [
					set('tile', 'borderColor', TRANSPORT.stop),
					set('tile', 'borderWidth', 3.47),
					set('glyph', 'enabled', false),
					set('glyphLit', 'enabled', true),
					set('caption', 'color', WHITE),
				]),
			],
		),
		simple('Music: Stop', 'Music\\nStop', steps, [whenSimple(up, { color: TRANSPORT.stop })], { color: DIM }),
	)
}

export function mediaPresets(state: SlidesState): { sections: Section[]; presets: Presets } {
	const skip = (seconds: string): ReturnType<typeof press> =>
		press({ actionId: 'video_transport', options: { target: 'any', action: 'skip', seconds } })
	const presets: Presets = {
		video_play_pause: transport(),
		video_restart: tile({
			name: 'Video: Restart',
			family: 'media',
			icon: 'skip-back',
			label: 'Restart',
			steps: press({ actionId: 'video_transport', options: { target: 'any', action: 'reset', seconds: '0' } }),
		}),
		video_skip_back: tile({
			name: 'Video: Skip back 10 seconds',
			family: 'media',
			icon: 'rewind',
			label: '-10s',
			steps: skip('-10'),
		}),
		video_skip_forward: tile({
			name: 'Video: Skip forward 10 seconds',
			family: 'media',
			icon: 'fast-forward',
			label: '+10s',
			steps: skip('10'),
		}),
		music_play_pause: musicPlayPause(),
		music_next: tile({
			name: 'Music: Next track',
			family: 'audio',
			icon: 'skip-forward',
			label: 'Next',
			steps: press({ actionId: 'music_transport', options: { action: 'next', position: '0' } }),
		}),
		music_stop: musicStop(),
		alert_hide: tile({
			name: 'Alert: Hide',
			family: 'conf',
			icon: 'bell-off',
			label: 'Hide Alert',
			steps: press({ actionId: 'alert_hide', options: {} }),
		}),
	}

	// The built-in overlay packs reuse the same names ("Call to Action" in every pack), so the
	// library's folders become groups and each preset's name says which folder it is from.
	const overlayFolders = new Map<string, string[]>()
	const overlayIds = state.library.overlays.map((overlay) => {
		const id = `overlay_${overlay.id}`
		const folder = overlay.folder ?? ''
		overlayFolders.set(folder, [...(overlayFolders.get(folder) ?? []), id])
		presets[id] = tile({
			name: `Overlay: ${folder ? `${folder} / ` : ''}${overlay.name}`,
			family: 'media',
			icon: 'layers',
			label: overlay.name,
			steps: press({ actionId: 'overlay', options: { overlay: overlay.id, mode: 'toggle' } }),
			lit: { feedbackId: 'overlay_live', options: { overlay: overlay.id } },
		})
		return id
	})
	const alertIds = state.library['alert-presets'].map((preset) => {
		const id = `alert_${preset.id}`
		presets[id] = tile({
			name: `Alert: ${preset.name}`,
			family: 'conf',
			icon: 'message-square-text',
			label: preset.name,
			steps: press({ actionId: 'alert_preset', options: { preset: preset.id, tokens: '' } }),
			lit: { feedbackId: 'alert_showing', options: { match: 'preset', preset: preset.id, text: '' } },
		})
		return id
	})
	const inputIds = state.videoInputs.map((input) => {
		const id = `video_input_${input.id}`
		presets[id] = tile({
			name: `Video Input: ${input.name}`,
			family: 'media',
			icon: 'camera',
			label: input.name,
			steps: press({ actionId: 'video_input_fire', options: { input: input.id } }),
			lit: { feedbackId: 'video_input_live', options: { input: input.id } },
		})
		return id
	})
	const playlistIds = state.library.playlists.map((playlist) => {
		const id = `playlist_${playlist.id}`
		presets[id] = tile({
			name: `Music: ${playlist.name}`,
			family: 'audio',
			icon: 'list-music',
			label: playlist.name,
			steps: press({ actionId: 'music_playlist', options: { playlist: playlist.id } }),
			lit: { feedbackId: 'music_playing', options: { playlist: playlist.id } },
		})
		return id
	})

	const sections: Section[] = [
		{
			id: 'media',
			name: 'Media',
			description: 'The video that is playing: Play / Pause with the time left, Restart and Skip.',
			definitions: ['video_play_pause', 'video_restart', 'video_skip_back', 'video_skip_forward'],
		},
	]
	if (inputIds.length) {
		sections.push({
			id: 'video_inputs',
			name: 'Video Inputs',
			description: 'One button per camera, NDI or Blackmagic input: press to put it on screen. Lit while it is live.',
			definitions: inputIds,
		})
	}
	if (overlayIds.length) {
		sections.push({
			id: 'overlays',
			name: 'Overlays',
			description: 'One button per overlay: press to show it, press again to hide it. Lit while it is live.',
			definitions:
				overlayFolders.size > 1
					? [...overlayFolders].map(([folder, ids], index) => ({
							id: `overlays_folder_${index}`,
							type: 'simple' as const,
							name: folder.replaceAll('/', ' / ') || 'Not in a folder',
							presets: ids,
						}))
					: overlayIds,
		})
	}
	sections.push({
		id: 'alerts',
		name: 'Alerts',
		description: 'One button per alert preset, lit while it shows, and Hide Alert.',
		definitions: [...alertIds, 'alert_hide'],
	})
	sections.push({
		id: 'music',
		name: 'Music',
		description: 'One button per playlist, lit while it plays, then Play / Pause, Next and Stop.',
		definitions: [...playlistIds, 'music_play_pause', 'music_next', 'music_stop'],
	})
	return { sections, presets }
}
