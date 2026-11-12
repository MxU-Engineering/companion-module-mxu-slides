import type { CompanionActionDefinitions } from '@companion-module/base'
import type { LockStatus, MidiDeviceStatus } from '../api/types.js'
import { Choices, ON_OFF_TOGGLE, picked, resolveToggle, text, type SlidesContext } from '../context.js'

type CaptureOptions = { mode: string; preset: string }

export type SystemActions = {
	output_preset: { options: { preset: string } }
	confidence_layout: { options: { screen: string; layout: string } }
	screens_identify: { options: Record<string, never> }
	recording: { options: CaptureOptions }
	streaming: { options: CaptureOptions }
	combo_run: { options: { combo: string } }
	scheduler: { options: { mode: string } }
	scheduler_trigger: { options: { trigger: string; action: string } }
	midi_device: { options: { device: string; mode: string } }
	lock: { options: { action: string } }
	follow: { options: { action: string } }
}

export const NO_PRESET = 'none'
export const BUILT_IN_LAYOUT = 'built-in'
const DEFAULT_PRESET = 'default'

const START_STOP = [
	{ id: 'toggle', label: 'Start / Stop' },
	{ id: 'start', label: 'Start' },
	{ id: 'stop', label: 'Stop' },
]

export function systemActions(ctx: SlidesContext, choices: Choices): CompanionActionDefinitions<SystemActions> {
	const outputPresets = [...choices.outputPresets(), { id: NO_PRESET, label: 'No Output Preset' }]
	const screens = choices.confidenceScreens()
	const layouts = [
		{ id: BUILT_IN_LAYOUT, label: 'Built-in Layout' },
		...choices.library('confidence-layouts').filter((layout) => layout.id !== ''),
	]
	const combos = choices.combos()
	const triggers = choices.triggers()
	const midi = choices.midi()
	const capturePresets = [
		{ id: DEFAULT_PRESET, label: 'The one MxU Slides would use' },
		...choices.library('stream-presets').filter((preset) => preset.id !== ''),
	]

	const capture = (
		side: 'recording' | 'streaming',
		label: string,
	): CompanionActionDefinitions<{ a: { options: CaptureOptions } }>['a'] => ({
		name: `${label}: Start, Stop`,
		description: `Starts or stops the ${side === 'recording' ? 'recording' : 'stream'} in MxU Slides.`,
		options: [
			{
				id: 'mode',
				type: 'dropdown',
				label: 'Do',
				choices: START_STOP,
				default: 'toggle',
				disableAutoExpression: true,
			},
			{
				id: 'preset',
				type: 'dropdown',
				label: 'Preset',
				choices: capturePresets,
				default: DEFAULT_PRESET,
				allowCustom: true,
				isVisibleExpression: "$(options:mode) != 'stop'",
			},
		],
		callback: async ({ options }, { signal }) => {
			const mode = text(options.mode)
			const preset = text(options.preset)
			const body = mode !== 'stop' && preset && preset !== DEFAULT_PRESET ? { presetId: preset } : {}
			await ctx.run(`${label}: Start, Stop`, '1.1', signal, async (client) =>
				client.post(`/v1/capture/${side}/${mode === 'start' || mode === 'stop' ? mode : 'toggle'}`, body),
			)
		},
	})

	return {
		output_preset: {
			name: 'Output Preset: Switch',
			description: 'Switches the screens to an Output Preset, or to none.',
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
			callback: async ({ options }, { signal }) => {
				const id = encodeURIComponent(text(options.preset) || NO_PRESET)
				await ctx.run('Output Preset: Switch', undefined, signal, async (client) =>
					client.post(`/v1/output-presets/${id}/activate`),
				)
			},
		},
		confidence_layout: {
			name: 'Confidence Monitor: Set layout',
			description: 'Shows a layout on a Confidence Monitor.',
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
			callback: async ({ options }, { signal }) => {
				const layout = text(options.layout)
				const chosen = picked(ctx, 'Confidence Monitor: Set layout', 'a Confidence Monitor', options.screen)
				if (!chosen) return
				const screen = encodeURIComponent(chosen)
				await ctx.run('Confidence Monitor: Set layout', '1.1', signal, async (client) =>
					client.post(`/v1/confidence/screens/${screen}/layout`, {
						layoutId: layout === BUILT_IN_LAYOUT || layout === '' ? null : layout,
					}),
				)
			},
		},
		screens_identify: {
			name: 'Screens: Identify',
			description: 'Flashes each screen with its name.',
			options: [],
			callback: async (_action, { signal }) => {
				await ctx.run('Screens: Identify', '1.1', signal, async (client) => client.post('/v1/outputs/identify'))
			},
		},
		recording: capture('recording', 'Recording'),
		streaming: capture('streaming', 'Stream'),
		combo_run: {
			name: 'Action Combo: Run',
			description: 'Runs an Action Combo from MxU Slides.',
			options: [
				{
					id: 'combo',
					type: 'dropdown',
					label: 'Action Combo',
					choices: combos,
					default: Choices.first(combos),
					allowCustom: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				const combo = picked(ctx, 'Action Combo: Run', 'an Action Combo', options.combo)
				if (!combo) return
				const id = encodeURIComponent(combo)
				await ctx.run('Action Combo: Run', undefined, signal, async (client) =>
					client.post(`/v1/action-combos/${id}/fire`),
				)
			},
		},
		scheduler: {
			name: 'Scheduler: On / Off',
			description: 'Turns the MxU Slides Scheduler on or off.',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Scheduler',
					choices: ON_OFF_TOGGLE,
					default: 'toggle',
					disableAutoExpression: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				const enabled = resolveToggle(options.mode, !!ctx.state.scheduler?.enabled)
				await ctx.run('Scheduler: On / Off', undefined, signal, async (client) =>
					client.post('/v1/scheduler/enabled', { enabled }),
				)
			},
		},
		scheduler_trigger: {
			name: 'Scheduler trigger: Pause, Resume, Run now',
			description: 'Runs one Scheduler trigger now, or pauses or resumes it.',
			options: [
				{
					id: 'trigger',
					type: 'dropdown',
					label: 'Trigger',
					choices: triggers,
					default: Choices.first(triggers),
					allowCustom: true,
				},
				{
					id: 'action',
					type: 'dropdown',
					label: 'Do',
					disableAutoExpression: true,
					choices: [
						{ id: 'run', label: 'Run now' },
						{ id: 'toggle', label: 'Pause / Resume' },
						{ id: 'pause', label: 'Pause' },
						{ id: 'resume', label: 'Resume' },
					],
					default: 'run',
				},
			],
			callback: async ({ options }, { signal }) => {
				const trigger = picked(ctx, 'Scheduler trigger: Pause, Resume, Run now', 'a trigger', options.trigger)
				if (!trigger) return
				const action = text(options.action)
				const path = `/v1/scheduler/triggers/${encodeURIComponent(trigger)}`
				await ctx.run('Scheduler trigger: Pause, Resume, Run now', undefined, signal, async (client) => {
					if (action === 'run') {
						await client.post(`${path}/fire`)
						return
					}
					const current = ctx.state.scheduler?.triggers.find((candidate) => candidate.id === trigger)?.enabled ?? true
					const enabled = action === 'toggle' ? !current : action === 'resume'
					await client.post(`${path}/enabled`, { enabled })
				})
			},
		},
		midi_device: {
			name: 'MIDI device: On / Off',
			description: 'Turns a MIDI device in MxU Slides on or off.',
			options: [
				{
					id: 'device',
					type: 'dropdown',
					label: 'MIDI device',
					choices: midi,
					default: Choices.first(midi),
					allowCustom: true,
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Switch',
					choices: ON_OFF_TOGGLE,
					default: 'toggle',
					disableAutoExpression: true,
				},
			],
			callback: async ({ options }, { signal }) => {
				const device = picked(ctx, 'MIDI device: On / Off', 'a MIDI device', options.device)
				if (!device) return
				await ctx.run('MIDI device: On / Off', undefined, signal, async (client) => {
					// Slides does not push its MIDI devices, so a toggle asks for the state it is toggling.
					const devices = await client.get<MidiDeviceStatus[]>('/v1/midi/devices')
					if (signal.aborted) return
					const current = !!devices.find((candidate) => candidate.id === device)?.enabled
					const enabled = resolveToggle(options.mode, current)
					await client.post(`/v1/midi/devices/${encodeURIComponent(device)}/enabled`, { enabled })
					ctx.refresh('midi')
				})
			},
		},
		lock: {
			name: 'Lock: On, Off, Pull Updates',
			description: 'The Lock holds what is on screen steady while others keep editing.',
			options: [
				{
					id: 'action',
					type: 'dropdown',
					label: 'Do',
					disableAutoExpression: true,
					choices: [
						{ id: 'toggle', label: 'Lock on / off' },
						{ id: 'on', label: 'Lock on' },
						{ id: 'off', label: 'Lock off' },
						{ id: 'pull', label: 'Pull Updates' },
					],
					default: 'toggle',
				},
			],
			callback: async ({ options }, { signal }) => {
				const action = text(options.action)
				await ctx.run('Lock: On, Off, Pull Updates', undefined, signal, async (client) => {
					let body: object = { pullUpdates: true }
					if (action !== 'pull') {
						// The Lock also turns itself on and off with the service, without a push: read it first.
						const current = action === 'toggle' ? (await client.get<LockStatus>('/v1/show/lock')).locked : false
						if (signal.aborted) return
						body = { locked: resolveToggle(action, current) }
					}
					await client.post('/v1/show/lock', body)
					ctx.refresh('lock')
				})
			},
		},
		follow: {
			name: 'Follow: Take Over, Hand Back',
			description: 'For a backup computer that follows the booth computer.',
			options: [
				{
					id: 'action',
					type: 'dropdown',
					label: 'Do',
					disableAutoExpression: true,
					choices: [
						{ id: 'takeover', label: 'Take Over (on the backup)' },
						{ id: 'handback', label: 'Hand Back (on the backup)' },
						{ id: 'takeback', label: 'Take Back (on the booth computer)' },
					],
					default: 'takeover',
				},
			],
			callback: async ({ options }, { signal }) => {
				const action = text(options.action)
				const path = action === 'handback' || action === 'takeback' ? action : 'takeover'
				await ctx.run('Follow: Take Over, Hand Back', undefined, signal, async (client) => {
					await client.post(`/v1/follow/${path}`)
					ctx.refresh('follow')
				})
			},
		},
	}
}
