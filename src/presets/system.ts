import type { CompanionPresetSection } from '@companion-module/base'
import { BUILT_IN_LAYOUT } from '../actions/system.js'
import type { ModuleSchema } from '../main.js'
import type { SlidesState } from '../state.js'
import { DIM, FAMILY, WHITE } from '../style.js'
import {
	alternatives,
	caption,
	expression,
	glyph,
	LABEL,
	label,
	layered,
	local,
	localValue,
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

/**
 * Record and Stream: a dark button with the glyph while off; while on, filled, with the time
 * it has been running.
 */
function capture(side: 'recording' | 'streaming'): Preset {
	const recording = side === 'recording'
	const name = recording ? 'Record' : 'Stream'
	const icon = recording ? 'circle-dot' : 'radio-tower'
	const rec = FAMILY.rec
	const steps = press(
		recording
			? { actionId: 'recording', options: { mode: 'toggle', preset: 'default' } }
			: { actionId: 'streaming', options: { mode: 'toggle', preset: 'default' } },
	)
	const lit = recording
		? { feedbackId: 'recording' as const, options: {} }
		: { feedbackId: 'streaming' as const, options: {} }
	const elements = [
		tileBase(),
		glyph('glyph', `${icon}.rest`),
		glyph('glyphLit', `${icon}.rec.small.ink`, false),
		caption(name, WHITE),
		label('time', expression(local('time')), 4, 35.5, 64, 17, rec.ink, { size: 96, enabled: false }),
		label('state', recording ? 'REC' : 'LIVE', 4, 53.5, 64, 12, rec.ink, { size: 86, enabled: false }),
	]
	const feedbacks = [
		when(lit, [
			set('tile', 'color', rec.bright),
			set('tile', 'borderColor', rec.bright),
			set('glyph', 'enabled', false),
			set('caption', 'enabled', false),
			set('glyphLit', 'enabled', true),
			set('time', 'enabled', true),
			set('state', 'enabled', true),
		]),
	]
	return alternatives(
		layered(name, elements, steps, feedbacks, [localValue('time', 'capture_value', { side })]),
		simple(name, name, steps, [
			whenSimple(lit, {
				bgcolor: rec.bright,
				color: rec.ink,
				text: `${recording ? 'REC' : 'LIVE'}\\n$(${LABEL}:${side}_time)`,
			}),
		]),
	)
}

/** Dim while nothing waits behind the Lock; bright with a ring while updates are waiting. */
function pullUpdates(): Preset {
	const steps = press({ actionId: 'lock', options: { action: 'pull' } })
	const lit = { feedbackId: 'updates_waiting' as const, options: {} }
	const amber = FAMILY.conf.bright
	return alternatives(
		layered(
			'Lock: Pull Updates',
			[
				tileBase(),
				glyph('glyph', 'refresh-cw.rest'),
				glyph('glyphLit', 'refresh-cw.conf', false),
				caption('Pull\nUpdates', DIM),
			],
			steps,
			[
				when(lit, [
					set('tile', 'borderColor', amber),
					set('tile', 'borderWidth', 3.47),
					set('glyph', 'enabled', false),
					set('glyphLit', 'enabled', true),
					set('caption', 'color', WHITE),
				]),
			],
		),
		simple('Lock: Pull Updates', 'Pull\\nUpdates', steps, [whenSimple(lit, { color: amber })], { color: DIM }),
	)
}

export function systemPresets(state: SlidesState): { sections: Section[]; presets: Presets } {
	const presets: Presets = {
		screens_identify: tile({
			name: 'Screens: Identify',
			family: 'output',
			icon: 'scan-eye',
			label: 'Identify',
			steps: press({ actionId: 'screens_identify', options: {} }),
		}),
		capture_record: capture('recording'),
		capture_stream: capture('streaming'),
		scheduler_on: tile({
			name: 'Scheduler: On / Off',
			family: 'system',
			icon: 'calendar-clock',
			label: 'Scheduler',
			steps: press({ actionId: 'scheduler', options: { mode: 'toggle' } }),
			lit: { feedbackId: 'scheduler_on', options: {} },
		}),
		system_lock: tile({
			name: 'Lock: On / Off',
			family: 'system',
			icon: 'lock',
			label: 'Lock',
			steps: press({ actionId: 'lock', options: { action: 'toggle' } }),
			lit: { feedbackId: 'lock_on', options: {} },
		}),
		system_pull_updates: pullUpdates(),
		system_take_over: tile({
			name: 'Follow: Take Over',
			family: 'system',
			icon: 'shield-check',
			label: 'Take Over',
			steps: press({ actionId: 'follow', options: { action: 'takeover' } }),
			lit: { feedbackId: 'follow_role', options: { role: 'took_over' } },
		}),
	}

	const outputPresetIds = (state.outputs?.presets ?? []).map((preset) => {
		const id = `output_preset_${preset.id}`
		presets[id] = tile({
			name: `Output Preset: ${preset.name}`,
			family: 'output',
			icon: 'layout-grid',
			label: preset.name,
			steps: press({ actionId: 'output_preset', options: { preset: preset.id } }),
			lit: { feedbackId: 'output_preset_active', options: { preset: preset.id } },
		})
		return id
	})

	const layouts = [{ id: BUILT_IN_LAYOUT, name: 'Built-in Layout' }, ...state.library['confidence-layouts']]
	const screens = state.show?.confidence?.screens ?? []
	const layoutGroups = screens.map((screen) => ({
		id: `confidence_${screen.id}`,
		type: 'simple' as const,
		name: screens.length > 1 ? `Confidence Monitor: ${screen.name}` : 'Confidence Monitor layouts',
		presets: layouts.map((layout) => {
			const id = `confidence_${screen.id}_${layout.id}`
			presets[id] = tile({
				name: `Confidence Monitor: ${layout.name}`,
				family: 'conf',
				icon: 'monitor',
				label: layout.name,
				steps: press({ actionId: 'confidence_layout', options: { screen: screen.id, layout: layout.id } }),
				lit: { feedbackId: 'confidence_layout', options: { screen: screen.id, layout: layout.id } },
			})
			return id
		}),
	}))

	const triggerIds = (state.scheduler?.triggers ?? [])
		.filter((trigger) => !trigger.archived)
		.map((trigger) => {
			const id = `trigger_${trigger.id}`
			presets[id] = tile({
				name: `Scheduler: Run ${trigger.name} now`,
				family: 'system',
				icon: 'play',
				label: trigger.name,
				steps: press({ actionId: 'scheduler_trigger', options: { trigger: trigger.id, action: 'run' } }),
			})
			return id
		})

	const sections: Section[] = [
		{
			id: 'screens',
			name: 'Screens',
			description: 'One button per Output Preset and per Confidence Monitor layout, lit while it is the one in use.',
			definitions: [
				{
					id: 'screens_presets',
					type: 'simple',
					name: 'Output Presets',
					presets: [...outputPresetIds, 'screens_identify'],
				},
				...layoutGroups,
			],
		},
		{
			id: 'capture',
			name: 'Record and Stream',
			description: 'Each shows the time it has been running while it is on. Needs MxU Slides with API 1.1 or newer.',
			definitions: ['capture_record', 'capture_stream'],
		},
		{
			id: 'scheduler',
			name: 'Scheduler',
			description: 'The Scheduler switch, and Run Now for each trigger.',
			definitions: ['scheduler_on', ...triggerIds],
		},
		{
			id: 'system',
			name: 'System',
			definitions: ['system_lock', 'system_pull_updates', 'system_take_over'],
		},
	]
	return { sections, presets }
}
