import type {
	CompanionCompositeElementSchema,
	CompanionGraphicsCompositeElementDefinitions,
	SomeButtonGraphicsElement,
} from '@companion-module/base'
import { METER_MIN } from './feedbacks/audio.js'
import { DIM, FAMILY, METER_AMBER, METER_GREEN, METER_RED, OFF_INK, OFF_PILL, TRACK, WHITE } from './style.js'

export type CompositeElementsSchema = {
	channel_strip: CompanionCompositeElementSchema<{
		name: string
		level: string
		state: string
		onLabel: string
		stereo: boolean
		meterLeft: number
		meterRight: number
		fader: number
	}>
	stereo_meter: CompanionCompositeElementSchema<{
		left: number
		right: number
	}>
}

type Expression = { isExpression: true; value: string }

function expression(value: string): Expression {
	return { isExpression: true, value }
}

/** A length in the 72-unit button space, as the percentage Companion positions elements with. */
function pct(units: number): number {
	return Math.round((units / 72) * 10000) / 100
}

/** A level meter bar: green, amber from -18 dB, red from -6 dB, over a quiet track. */
function meterBar(
	id: string,
	x: number,
	width: number,
	level: string,
	enabled?: Expression,
): SomeButtonGraphicsElement[] {
	return [
		{
			type: 'box',
			id: `${id}Track`,
			name: 'Meter track',
			x,
			y: 0,
			width,
			height: 100,
			color: TRACK,
			cornerRadius: 30,
			...(enabled ? { enabled } : {}),
		},
		{
			type: 'gauge',
			id,
			name: 'Meter',
			x,
			y: 0,
			width,
			height: 100,
			orientation: 'vertical',
			min: METER_MIN,
			max: 0,
			value: expression(level),
			fillEnabled: true,
			multiColour: true,
			roundedEnds: false,
			// The quiet track is the box behind; the gauge draws only the level itself.
			trackStyle: 'transparent',
			trackAmount: 0,
			stops: [
				{ value: METER_MIN, color: METER_GREEN, gradient: false },
				{ value: -18, color: METER_AMBER, gradient: false },
				{ value: -6, color: METER_RED, gradient: false },
			],
			...(enabled ? { enabled } : {}),
		},
	]
}

/** Shifts a meter bar from the composite's own box into a column of a larger layout. */
function inColumn(elements: SomeButtonGraphicsElement[], y: number, height: number): SomeButtonGraphicsElement[] {
	return elements.map((element) => ({ ...element, y, height }))
}

const STATE = '$(options:state)'

/**
 * Elements a user can drop on any button and wire to feedbacks or variables of their own. The
 * mixer presets are built from the same two, so a hand-made button matches the ones shipped.
 */
export function GetCompositeElements(): CompanionGraphicsCompositeElementDefinitions<CompositeElementsSchema> {
	return {
		channel_strip: {
			type: 'composite',
			name: 'Mixer channel strip',
			description: 'A meter, a fader, the name, the level and an ON AIR / MUTED / OFF pill.',
			options: [
				{ type: 'textinput', id: 'name', label: 'Name', default: 'Pastor' },
				{ type: 'textinput', id: 'level', label: 'Level text', default: '-6.0', tooltip: 'Shown under the name.' },
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					tooltip: 'Usually a strip value feedback: on, muted or off.',
					choices: [
						{ id: 'on', label: 'On' },
						{ id: 'muted', label: 'Muted' },
						{ id: 'off', label: 'Off' },
					],
					default: 'on',
					allowCustom: true,
				},
				{ type: 'textinput', id: 'onLabel', label: 'Pill text when on', default: 'ON AIR' },
				{ type: 'checkbox', id: 'stereo', label: 'Two meter bars', default: false },
				{
					type: 'number',
					id: 'meterLeft',
					label: 'Meter, left or only bar (dB)',
					default: METER_MIN,
					min: METER_MIN,
					max: 0,
				},
				{
					type: 'number',
					id: 'meterRight',
					label: 'Meter, right bar (dB)',
					default: METER_MIN,
					min: METER_MIN,
					max: 0,
				},
				{
					type: 'number',
					id: 'fader',
					label: 'Fader position',
					tooltip: '0 is all the way down, 100 is full level.',
					default: 100,
					min: 0,
					max: 100,
				},
			],
			elements: [
				...inColumn(
					meterBar('meterMono', pct(8), pct(9), '$(options:meterLeft)', expression('!$(options:stereo)')),
					pct(9),
					pct(54),
				),
				...inColumn(
					meterBar('meterLeft', pct(7), pct(5), '$(options:meterLeft)', expression('!!$(options:stereo)')),
					pct(9),
					pct(54),
				),
				...inColumn(
					meterBar('meterRight', pct(13.5), pct(5), '$(options:meterRight)', expression('!!$(options:stereo)')),
					pct(9),
					pct(54),
				),
				{
					type: 'box',
					id: 'faderRail',
					name: 'Fader rail',
					x: pct(22.2),
					y: pct(9),
					width: pct(1.6),
					height: pct(54),
					color: 0x4a4a49,
					cornerRadius: 100,
				},
				{
					type: 'box',
					id: 'faderKnob',
					name: 'Fader knob',
					x: pct(20),
					// From the bottom of the rail (0) to its top (100).
					y: expression(`${pct(61.4)} - max(0, min(100, $(options:fader))) / 100 * ${pct(54)}`),
					width: pct(6),
					height: pct(3.2),
					color: WHITE,
					cornerRadius: 60,
				},
				{
					type: 'text',
					id: 'name',
					name: 'Name',
					x: pct(27),
					y: pct(9),
					width: pct(43),
					height: pct(14),
					text: expression('$(options:name)'),
					fontsize: 88,
					fontsizeAllowShrink: true,
					weight: 'bold',
					color: WHITE,
					halign: 'center',
					valign: 'center',
				},
				{
					type: 'text',
					id: 'level',
					name: 'Level',
					x: pct(27),
					y: pct(25),
					width: pct(43),
					height: pct(18),
					text: expression('$(options:level)'),
					fontsize: 92,
					fontsizeAllowShrink: true,
					weight: 'bold',
					color: expression(`${STATE} == 'off' ? ${DIM} : ${WHITE}`),
					halign: 'center',
					valign: 'center',
				},
				{
					type: 'box',
					id: 'pill',
					name: 'State pill',
					x: pct(29.5),
					y: pct(47),
					width: pct(38),
					height: pct(13),
					cornerRadius: 100,
					color: expression(
						`${STATE} == 'muted' ? ${FAMILY.clear.bright} : (${STATE} == 'off' ? ${OFF_PILL} : ${FAMILY.timer.bright})`,
					),
				},
				{
					type: 'text',
					id: 'pillText',
					name: 'State',
					x: pct(29.5),
					y: pct(47.6),
					width: pct(38),
					height: pct(12),
					text: expression(`${STATE} == 'muted' ? 'MUTED' : (${STATE} == 'off' ? 'OFF' : $(options:onLabel))`),
					fontsize: 78,
					fontsizeAllowShrink: true,
					weight: 'bold',
					color: expression(
						`${STATE} == 'muted' ? ${FAMILY.clear.ink} : (${STATE} == 'off' ? ${OFF_INK} : ${FAMILY.timer.ink})`,
					),
					halign: 'center',
					valign: 'center',
				},
			],
		},
		stereo_meter: {
			type: 'composite',
			name: 'Stereo level meter',
			description: 'Two level bars side by side: green, amber from -18 dB, red from -6 dB.',
			options: [
				{ type: 'number', id: 'left', label: 'Left level (dB)', default: METER_MIN, min: METER_MIN, max: 0 },
				{ type: 'number', id: 'right', label: 'Right level (dB)', default: METER_MIN, min: METER_MIN, max: 0 },
			],
			elements: [...meterBar('left', 0, 46, '$(options:left)'), ...meterBar('right', 54, 46, '$(options:right)')],
		},
	}
}
