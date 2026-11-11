import type { CompanionFeedbackDefinitions } from '@companion-module/base'
import { BUILT_IN_LAYOUT, NO_PRESET } from '../actions/system.js'
import { Choices, text, type SlidesContext } from '../context.js'
import type { SlidesState } from '../state.js'
import { FAMILY } from '../style.js'
import { captureElapsed, formatClock } from '../time.js'

type None = Record<string, never>

export type SystemFeedbacks = {
	output_preset_active: { type: 'boolean'; options: { preset: string } }
	confidence_layout: { type: 'boolean'; options: { screen: string; layout: string } }
	recording: { type: 'boolean'; options: None }
	streaming: { type: 'boolean'; options: None }
	capture_value: { type: 'value'; options: { side: string } }
	lock_on: { type: 'boolean'; options: None }
	updates_waiting: { type: 'boolean'; options: None }
	scheduler_on: { type: 'boolean'; options: None }
	trigger_enabled: { type: 'boolean'; options: { trigger: string } }
	midi_device_on: { type: 'boolean'; options: { device: string } }
	follow_role: { type: 'boolean'; options: { role: string } }
	not_responding: { type: 'boolean'; options: None }
}

/** How long a recording or stream has run, as a clock; empty while it is off. */
export function captureClock(state: SlidesState, side: string, now: number): string {
	const capture = side === 'streaming' ? state.capture?.streaming : state.capture?.recording
	return capture?.active ? formatClock(captureElapsed(capture, now)) : ''
}

/** Where this computer stands with a backup: `took_over` is a backup that is running the service. */
export function followRole(state: SlidesState): 'in_charge' | 'took_over' | 'backing_up' | 'stepped_down' {
	switch (state.follow?.role) {
		case 'inCharge':
			return 'took_over'
		case 'backingUp':
			return 'backing_up'
		case 'steppedDown':
			return 'stepped_down'
		default:
			return 'in_charge'
	}
}

/** True for a computer that runs the service: one that never backed anything up, or a backup that took over. */
export function inCharge(state: SlidesState): boolean {
	const role = followRole(state)
	return role === 'in_charge' || role === 'took_over'
}

export function systemFeedbacks(ctx: SlidesContext, choices: Choices): CompanionFeedbackDefinitions<SystemFeedbacks> {
	const state = ctx.state
	const outputPresets = [...choices.outputPresets(), { id: NO_PRESET, label: 'No Output Preset' }]
	const screens = choices.confidenceScreens()
	const layouts = [
		{ id: BUILT_IN_LAYOUT, label: 'Built-in Layout' },
		...choices.library('confidence-layouts').filter((layout) => layout.id !== ''),
	]
	const triggers = choices.triggers()
	const midi = choices.midi()

	return {
		output_preset_active: {
			type: 'boolean',
			name: 'Output Preset is active',
			defaultStyle: { bgcolor: FAMILY.output.bright, color: FAMILY.output.ink },
			options: [
				{
					id: 'preset',
					type: 'dropdown',
					label: 'Output Preset',
					choices: outputPresets,
					default: Choices.first(outputPresets),
					allowCustom: true,
				},
			],
			callback: ({ options }) => {
				const wanted = text(options.preset)
				const presets = state.outputs?.presets ?? []
				if (wanted === NO_PRESET) return !presets.some((preset) => preset.active)
				return presets.find((preset) => preset.id === wanted)?.active === true
			},
		},
		confidence_layout: {
			type: 'boolean',
			name: 'Confidence Monitor layout is',
			defaultStyle: { bgcolor: FAMILY.conf.bright, color: FAMILY.conf.ink },
			options: [
				{
					id: 'screen',
					type: 'dropdown',
					label: 'Confidence Monitor',
					choices: screens,
					default: Choices.first(screens),
					allowCustom: true,
				},
				{
					id: 'layout',
					type: 'dropdown',
					label: 'Layout',
					choices: layouts,
					default: BUILT_IN_LAYOUT,
					allowCustom: true,
				},
			],
			callback: ({ options }) => {
				const screen = state.show?.confidence?.screens.find((candidate) => candidate.id === text(options.screen))
				if (!screen) return false
				const wanted = text(options.layout)
				return wanted === BUILT_IN_LAYOUT || wanted === '' ? !screen.layoutId : screen.layoutId === wanted
			},
		},
		recording: {
			type: 'boolean',
			name: 'Recording',
			defaultStyle: { bgcolor: FAMILY.rec.bright, color: FAMILY.rec.ink },
			options: [],
			callback: () => state.capture?.recording.active === true,
		},
		streaming: {
			type: 'boolean',
			name: 'Streaming',
			defaultStyle: { bgcolor: FAMILY.rec.bright, color: FAMILY.rec.ink },
			options: [],
			callback: () => state.capture?.streaming.active === true,
		},
		capture_value: {
			type: 'value',
			name: 'Recording or stream: time running',
			description: 'How long the recording or the stream has been running, counted every second.',
			options: [
				{
					id: 'side',
					type: 'dropdown',
					label: 'Time of the',
					choices: [
						{ id: 'recording', label: 'Recording' },
						{ id: 'streaming', label: 'Stream' },
					],
					default: 'recording',
				},
			],
			callback: ({ options }) => captureClock(state, text(options.side), state.now()),
		},
		lock_on: {
			type: 'boolean',
			name: 'Lock is on',
			defaultStyle: { bgcolor: FAMILY.system.bright, color: FAMILY.system.ink },
			options: [],
			callback: () => state.lock?.locked === true,
		},
		updates_waiting: {
			type: 'boolean',
			name: 'Updates are waiting',
			description: 'True while the Lock holds updates back that Pull Updates would bring in.',
			defaultStyle: { bgcolor: FAMILY.conf.bright, color: FAMILY.conf.ink },
			options: [],
			callback: () => (state.lock?.waitingUpdates ?? 0) > 0,
		},
		scheduler_on: {
			type: 'boolean',
			name: 'Scheduler is on',
			defaultStyle: { bgcolor: FAMILY.system.bright, color: FAMILY.system.ink },
			options: [],
			callback: () => state.scheduler?.enabled === true,
		},
		trigger_enabled: {
			type: 'boolean',
			name: 'Scheduler trigger is enabled',
			defaultStyle: { bgcolor: FAMILY.system.bright, color: FAMILY.system.ink },
			options: [
				{
					id: 'trigger',
					type: 'dropdown',
					label: 'Trigger',
					choices: triggers,
					default: Choices.first(triggers),
					allowCustom: true,
				},
			],
			callback: ({ options }) => {
				const trigger = state.scheduler?.triggers.find((candidate) => candidate.id === text(options.trigger))
				return !!trigger && trigger.enabled && trigger.folderEnabled
			},
		},
		midi_device_on: {
			type: 'boolean',
			name: 'MIDI device is on',
			defaultStyle: { bgcolor: FAMILY.system.bright, color: FAMILY.system.ink },
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'MIDI device',
					choices: midi,
					default: Choices.first(midi),
					allowCustom: true,
				},
			],
			callback: ({ options }) => state.midi.find((device) => device.id === text(options.device))?.enabled === true,
		},
		follow_role: {
			type: 'boolean',
			name: 'This computer is in charge',
			description: 'For a booth computer with a backup that follows it: which of the two runs the service.',
			defaultStyle: { bgcolor: FAMILY.timer.bright, color: FAMILY.timer.ink },
			options: [
				{
					id: 'role',
					type: 'dropdown',
					label: 'This computer is',
					choices: [
						{ id: 'in_charge', label: 'In charge' },
						{ id: 'took_over', label: 'A backup that took over' },
						{ id: 'backing_up', label: 'Backing up another computer' },
						{ id: 'stepped_down', label: 'Stepped down (its backup took over)' },
					],
					default: 'in_charge',
				},
			],
			callback: ({ options }) => {
				const wanted = text(options.role)
				return wanted === 'in_charge' ? inCharge(state) : followRole(state) === wanted
			},
		},
		not_responding: {
			type: 'boolean',
			name: 'MxU Slides is not responding',
			description: 'True while MxU Slides still answers on the network but its window has stopped moving.',
			defaultStyle: { bgcolor: FAMILY.clear.bright, color: FAMILY.clear.ink },
			options: [],
			callback: () => !state.responding,
		},
	}
}
