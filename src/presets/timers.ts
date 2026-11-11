import type { CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from '../main.js'
import type { SlidesState } from '../state.js'
import { DIM, FAMILY, TILE, TRACK, WHITE } from '../style.js'
import { timerVariable } from '../variables.js'
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

/** The amounts on the add and subtract buttons. The action itself takes any amount. */
export const ADJUST_STEPS: [amount: string, text: string, key: string][] = [
	['1', '1s', '1s'],
	['5', '5s', '5s'],
	['10', '10s', '10s'],
	['15', '15s', '15s'],
	['30', '30s', '30s'],
	['60', '1 min', '1m'],
	['300', '5 min', '5m'],
]

const BAR = { x: 8, y: 56, width: 56, height: 5 }

/** The timer on a button: name, digits and a bar. Amber bar in warning, red button when over. */
function display(timer: string, variable: string): Preset {
	const steps = press({ actionId: 'timer', options: { timer, action: 'toggle' } })
	const red = FAMILY.clear.bright
	const state = (wanted: string): { feedbackId: 'timer_state'; options: { timer: string; state: string } } => ({
		feedbackId: 'timer_state',
		options: { timer, state: wanted },
	})
	const elements = [
		tileBase(),
		label('name', expression(local('name')), 4, 5.5, 64, 12.5, WHITE, { size: 88, opacity: 78, weight: 'normal' }),
		label('time', expression(local('time')), 3, 21, 66, 30, WHITE, { size: 92 }),
		box('track', BAR.x, BAR.y, BAR.width, BAR.height, TRACK, { radius: 2.5, name: 'Bar track' }),
		box('bar', BAR.x, BAR.y, expression(`${local('progress')} * ${pct(BAR.width)}`), BAR.height, FAMILY.timer.bright, {
			radius: 2.5,
			name: 'Bar',
		}),
	]
	const feedbacks = [
		when(state('idle'), [set('time', 'color', DIM)]),
		when(state('warning'), [set('bar', 'color', FAMILY.conf.bright)]),
		when(state('over'), [
			set('tile', 'color', red),
			set('tile', 'borderColor', red),
			set('track', 'color', 0xff8f88),
			set('bar', 'color', 0xffffff),
			set('name', 'color', 0xffffff),
			set('time', 'color', 0xffffff),
		]),
	]
	const variables = [
		localValue('name', 'timer_value', { timer, field: 'name' }),
		localValue('time', 'timer_value', { timer, field: 'time' }),
		localValue('progress', 'timer_value', { timer, field: 'progress' }),
	]
	return alternatives(
		layered('Timer', elements, steps, feedbacks, variables),
		simple('Timer', `$(${LABEL}:${variable}_name)\\n$(${LABEL}:${variable})`, steps, [
			whenSimple(state('warning'), { color: FAMILY.conf.bright }),
			whenSimple(state('over'), { bgcolor: red, color: 0xffffff }),
		]),
	)
}

/** Start while the timer waits, Pause while it runs. */
function startPause(timer: string): Preset {
	const steps = press({ actionId: 'timer', options: { timer, action: 'toggle' } })
	const running = { feedbackId: 'timer_state' as const, options: { timer, state: 'running' } }
	return alternatives(
		layered(
			'Timer: Start / Pause',
			[tileBase(), glyph('glyph', 'play.timer'), glyph('glyphLit', 'pause.timer', false), caption('Start', WHITE)],
			steps,
			[
				when(running, [
					set('glyph', 'enabled', false),
					set('glyphLit', 'enabled', true),
					set('caption', 'text', 'Pause'),
				]),
			],
		),
		simple('Timer: Start / Pause', 'Start', steps, [
			whenSimple(running, { text: 'Pause', color: FAMILY.timer.bright }),
		]),
	)
}

/** A filled plus adds, an outlined minus subtracts; the amount, and the timer it works on. */
function adjust(timer: string, add: boolean, amount: string, text: string): Preset {
	const name = `Timer: ${add ? 'Add' : 'Subtract'} ${text}`
	const steps = press({
		actionId: 'timer_adjust',
		options: { timer, direction: add ? 'add' : 'subtract', amount },
	})
	return alternatives(
		layered(
			name,
			[
				tileBase(),
				glyph('glyph', add ? 'plus.timer' : 'minus.timer'),
				label('amount', text, 4, 37.5, 64, 17, WHITE, { size: text.length <= 3 ? 100 : 88 }),
				label('timer', expression(local('name')), 4, 56, 64, 11.5, DIM, { size: 84, weight: 'normal' }),
			],
			steps,
			[],
			[localValue('name', 'timer_value', { timer, field: 'name' })],
		),
		simple(name, `${add ? '+' : '-'} ${text}`, steps, [], { color: FAMILY.timer.bright, bgcolor: TILE }),
	)
}

export function timerPresets(state: SlidesState): { sections: Section[]; presets: Presets } {
	const presets: Presets = {}
	const groups = state.timers.map((timer) => {
		const id = `timer_${timer.id}`
		const ids = [`${id}_display`, `${id}_start`, `${id}_reset`]
		presets[`${id}_display`] = display(timer.id, timerVariable(state, timer.id))
		presets[`${id}_start`] = startPause(timer.id)
		presets[`${id}_reset`] = tile({
			name: 'Timer: Reset',
			family: 'timer',
			icon: 'rotate-ccw',
			label: 'Reset',
			steps: press({ actionId: 'timer', options: { timer: timer.id, action: 'reset' } }),
		})
		// The permanent Service Tracking timers take no adjustments.
		const adjustable = !timer.id.startsWith('service_tracking.')
		for (const add of adjustable ? [true, false] : []) {
			for (const [amount, text, key] of ADJUST_STEPS) {
				const presetId = `${id}_${add ? 'add' : 'subtract'}_${key}`
				presets[presetId] = adjust(timer.id, add, amount, text)
				ids.push(presetId)
			}
		}
		return {
			id,
			type: 'simple' as const,
			name: timer.folderName ? `${timer.folderName} / ${timer.name}` : timer.name,
			presets: ids,
		}
	})
	if (!groups.length) return { sections: [], presets }
	return {
		sections: [
			{
				id: 'timers',
				name: 'Timers',
				description:
					'Per timer: the time on a button, Start / Pause, Reset, and buttons that add or subtract time. The bar turns amber in warning and the button turns red when the timer is over.',
				definitions: groups,
			},
		],
		presets,
	}
}
