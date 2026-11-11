import type { CompanionActionDefinitions } from '@companion-module/base'
import { Choices, number, text, type SlidesContext } from '../context.js'
import { parseDuration } from '../time.js'

export type TimerActions = {
	timer: { options: { timer: string; action: string } }
	timer_set: { options: { timer: string; mode: string; length: string; hour: number; minute: number } }
	timer_adjust: { options: { timer: string; direction: string; amount: string } }
}

export function timerActions(ctx: SlidesContext, choices: Choices): CompanionActionDefinitions<TimerActions> {
	const timers = choices.timers()
	const timerOption = {
		id: 'timer' as const,
		type: 'dropdown' as const,
		label: 'Timer',
		choices: timers,
		default: Choices.first(timers),
		allowCustom: true,
	}

	return {
		timer: {
			name: 'Timer: Start, Pause, Reset',
			options: [
				timerOption,
				{
					id: 'action',
					type: 'dropdown',
					label: 'Do',
					choices: [
						{ id: 'toggle', label: 'Start / Pause' },
						{ id: 'play', label: 'Start' },
						{ id: 'pause', label: 'Pause' },
						{ id: 'reset', label: 'Reset' },
					],
					default: 'toggle',
				},
			],
			callback: async ({ options }) => {
				const id = text(options.timer)
				let action = text(options.action)
				if (action === 'toggle') {
					action = ctx.state.timers.find((timer) => timer.id === id)?.running ? 'pause' : 'play'
				}
				await ctx.run('Timer: Start, Pause, Reset', undefined, async (client) =>
					client.post(`/v1/timers/${encodeURIComponent(id)}/${action}`),
				)
			},
		},
		timer_set: {
			name: 'Timer: Set length or end time',
			options: [
				timerOption,
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Kind',
					disableAutoExpression: true,
					choices: [
						{ id: 'countdown', label: 'Count down from a length' },
						{ id: 'countdownToTime', label: 'Count down to a time of day' },
						{ id: 'countUp', label: 'Count up' },
					],
					default: 'countdown',
				},
				{
					id: 'length',
					type: 'textinput',
					label: 'Length',
					description: 'Seconds, a clock or units: 300, 5:00, 5m. For Count up this is an optional limit.',
					default: '5:00',
					useVariables: true,
					isVisibleExpression: "$(options:mode) != 'countdownToTime'",
				},
				{
					id: 'hour',
					type: 'number',
					label: 'Hour (0 to 23)',
					default: 9,
					min: 0,
					max: 23,
					asInteger: true,
					clampValues: true,
					isVisibleExpression: "$(options:mode) == 'countdownToTime'",
				},
				{
					id: 'minute',
					type: 'number',
					label: 'Minute',
					default: 0,
					min: 0,
					max: 59,
					asInteger: true,
					clampValues: true,
					isVisibleExpression: "$(options:mode) == 'countdownToTime'",
				},
			],
			callback: async ({ options }) => {
				await ctx.run('Timer: Set length or end time', '1.1', async (client) => {
					const mode = text(options.mode)
					let body: object
					if (mode === 'countdownToTime') {
						body = { mode, hour: Math.round(number(options.hour, 9)), minute: Math.round(number(options.minute)) }
					} else {
						const length = parseDuration(text(options.length))
						if (length === undefined || length < 0) throw new Error(`"${text(options.length)}" is not a length of time`)
						body = { mode, durationSeconds: length }
					}
					await client.post(`/v1/timers/${encodeURIComponent(text(options.timer))}/configure`, body)
				})
			},
		},
		timer_adjust: {
			name: 'Timer: Add or subtract time',
			description:
				'Works whether the timer is running or not. Before it is started the change stays; while it runs the change is for this run only, and Reset goes back to the length it had.',
			options: [
				timerOption,
				{
					id: 'direction',
					type: 'dropdown',
					label: 'Do',
					choices: [
						{ id: 'add', label: 'Add time' },
						{ id: 'subtract', label: 'Subtract time' },
					],
					default: 'add',
				},
				{
					id: 'amount',
					type: 'textinput',
					label: 'Amount',
					description: 'Seconds, a clock or units: 30, 1:00, 5m.',
					default: '30',
					useVariables: true,
				},
			],
			callback: async ({ options }) => {
				await ctx.run('Timer: Add or subtract time', '1.1', async (client) => {
					const amount = parseDuration(text(options.amount))
					if (amount === undefined || amount === 0)
						throw new Error(`"${text(options.amount)}" is not an amount of time`)
					const seconds = text(options.direction) === 'subtract' ? -Math.abs(amount) : Math.abs(amount)
					await client.post(`/v1/timers/${encodeURIComponent(text(options.timer))}/adjust`, { seconds })
				})
			},
		},
	}
}
