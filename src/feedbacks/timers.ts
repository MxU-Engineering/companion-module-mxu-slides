import type { CompanionFeedbackDefinitions, DropdownChoice } from '@companion-module/base'
import type { TimerStatus } from '../api/types.js'
import { Choices, text, type SlidesContext } from '../context.js'
import { FAMILY } from '../style.js'
import { formatClock, timerIsTicking, timerProgress, timerState, timerValue, wholeSeconds } from '../time.js'

export type TimerFeedbacks = {
	timer_state: { type: 'boolean'; options: { timer: string; state: string } }
	timer_value: { type: 'value'; options: { timer: string; field: string } }
}

const STATES: DropdownChoice<string>[] = [
	{ id: 'running', label: 'Running (in warning or over time too)' },
	{ id: 'paused', label: 'Paused part-way' },
	{ id: 'warning', label: 'In warning' },
	{ id: 'over', label: 'Over time' },
	{ id: 'idle', label: 'Not started' },
]

const FIELDS: DropdownChoice<string>[] = [
	{ id: 'time', label: 'Time (12:48)' },
	{ id: 'progress', label: 'How far through, 0 to 1' },
	{ id: 'seconds', label: 'Seconds' },
	{ id: 'name', label: 'Name' },
]

export function timerValueField(timer: TimerStatus | undefined, field: string, now: number): string | number {
	if (!timer) return field === 'progress' || field === 'seconds' ? 0 : ''
	switch (field) {
		case 'time':
			return formatClock(timerValue(timer, now))
		case 'progress':
			return Math.round(timerProgress(timer, now) * 1000) / 1000
		case 'seconds':
			return wholeSeconds(timerValue(timer, now))
		default:
			return timer.name
	}
}

export function timerFeedbacks(ctx: SlidesContext, choices: Choices): CompanionFeedbackDefinitions<TimerFeedbacks> {
	const state = ctx.state
	const timers = choices.timers()
	const timerOption = {
		id: 'timer' as const,
		type: 'dropdown' as const,
		label: 'Timer',
		choices: timers,
		default: Choices.first(timers),
		allowCustom: true,
	}
	const find = (id: unknown): TimerStatus | undefined => state.timers.find((timer) => timer.id === text(id))

	return {
		timer_state: {
			type: 'boolean',
			name: 'Timer is running, paused, in warning or over',
			defaultStyle: { bgcolor: FAMILY.timer.bright, color: FAMILY.timer.ink },
			options: [timerOption, { id: 'state', type: 'dropdown', label: 'Timer is', choices: STATES, default: 'running' }],
			callback: ({ options }) => {
				const timer = find(options.timer)
				if (!timer) return false
				const wanted = text(options.state)
				const current = timerState(timer, state.now())
				// Running and paused go by the clock, not the colors: a countdown paused inside its
				// warning is paused, so its Start / Pause key offers Resume.
				if (wanted === 'running') return timerIsTicking(timer)
				if (wanted === 'paused') return !timerIsTicking(timer) && current !== 'idle'
				return current === wanted
			},
		},
		timer_value: {
			type: 'value',
			name: 'Timer: a value',
			description: 'The time, progress or name of a timer, counted every second.',
			options: [timerOption, { id: 'field', type: 'dropdown', label: 'Value', choices: FIELDS, default: 'time' }],
			callback: ({ options }) => timerValueField(find(options.timer), text(options.field), state.now()),
		},
	}
}
