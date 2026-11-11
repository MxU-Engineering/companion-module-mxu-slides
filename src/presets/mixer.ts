import type { CompanionPresetSection } from '@companion-module/base'
import type { MixerKind } from '../api/types.js'
import type { ModuleSchema } from '../main.js'
import type { SlidesState } from '../state.js'
import { FAMILY, MUTED_TILE, TILE, TILE_EDGE } from '../style.js'
import { stripVariable } from '../variables.js'
import {
	alternatives,
	expression,
	LABEL,
	layered,
	local,
	localValue,
	press,
	simple,
	tile,
	tileBase,
	whenSimple,
	type Element,
	type Lit,
	type LocalVariable,
	type Preset,
	type Step,
	type Steps,
} from './kit.js'

type Presets = Record<string, Preset>
type Section = CompanionPresetSection<ModuleSchema>

const KIND_LABEL: Record<MixerKind, string> = { input: 'Input', mix: 'Mix', output: 'Output' }

/** The local variables a strip reads: its name, level, state and meter, by the strip's kind. */
function stripVariables(kind: MixerKind, strip: string, stereo: boolean): LocalVariable[] {
	switch (kind) {
		case 'input':
			return [
				localValue('name', 'input_value', { strip, field: 'name' }),
				localValue('level', 'input_value', { strip, field: 'db' }),
				localValue('state', 'input_value', { strip, field: 'state' }),
				localValue('fader', 'input_value', { strip, field: 'fader' }),
				localValue('meterLeft', 'input_meter', { strip, channel: stereo ? 'left' : 'max' }),
				localValue('meterRight', 'input_meter', { strip, channel: 'right' }),
			]
		case 'mix':
			return [
				localValue('name', 'mix_value', { strip, field: 'name' }),
				localValue('level', 'mix_value', { strip, field: 'db' }),
				localValue('state', 'mix_value', { strip, field: 'state' }),
				localValue('fader', 'mix_value', { strip, field: 'fader' }),
				localValue('meterLeft', 'mix_meter', { strip, channel: stereo ? 'left' : 'max' }),
				localValue('meterRight', 'mix_meter', { strip, channel: 'right' }),
			]
		case 'output':
			return [
				localValue('name', 'output_value', { strip, field: 'name' }),
				localValue('level', 'output_value', { strip, field: 'db' }),
				localValue('state', 'output_value', { strip, field: 'state' }),
				localValue('fader', 'output_value', { strip, field: 'fader' }),
				localValue('meterLeft', 'output_meter', { strip, channel: stereo ? 'left' : 'max' }),
				localValue('meterRight', 'output_meter', { strip, channel: 'right' }),
			]
	}
}

function muteAction(kind: MixerKind, strip: string): Step['down'][number] {
	const options = { strip, mode: 'toggle' }
	if (kind === 'input') return { actionId: 'input_mute', options }
	return kind === 'mix' ? { actionId: 'mix_mute', options } : { actionId: 'output_mute', options }
}

function nudgeAction(kind: MixerKind, strip: string, step: number): Step['down'][number] {
	const options = { strip, step }
	if (kind === 'input') return { actionId: 'input_nudge', options }
	return kind === 'mix' ? { actionId: 'mix_nudge', options } : { actionId: 'output_nudge', options }
}

function mutedFeedback(kind: MixerKind, strip: string): Lit {
	const options = { strip }
	if (kind === 'input') return { feedbackId: 'input_muted', options }
	return kind === 'mix' ? { feedbackId: 'mix_muted', options } : { feedbackId: 'output_muted', options }
}

/**
 * A mixer strip on a button: meter, fader, name, level and a pill. An input's button switches
 * it On Air; a mix or an output's button mutes it. The dial version rides the level instead.
 */
function strip(state: SlidesState, kind: MixerKind, id: string, dial: boolean): Preset {
	const stereo = kind !== 'input'
	const name = `${KIND_LABEL[kind]}${dial ? ' dial' : ''}`
	const muted = `${local('state')} == 'muted'`
	const elements: Element[] = [
		tileBase(expression(`${muted} ? ${MUTED_TILE} : ${TILE}`), expression(`${muted} ? ${MUTED_TILE} : ${TILE_EDGE}`)),
		{
			type: 'composite',
			id: 'strip',
			name: 'Channel strip',
			elementId: 'channel_strip',
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			options: {
				name: expression(local('name')),
				level: expression(local('level')),
				state: expression(local('state')),
				onLabel: kind === 'input' ? 'ON AIR' : 'ON',
				stereo,
				meterLeft: expression(local('meterLeft')),
				meterRight: expression(local('meterRight')),
				fader: expression(local('fader')),
			},
		},
	]
	const mute = muteAction(kind, id)
	const steps: Steps = dial
		? [{ down: [mute], up: [], rotate_left: [nudgeAction(kind, id, -1)], rotate_right: [nudgeAction(kind, id, 1)] }]
		: press(kind === 'input' ? { actionId: 'input_on_air', options: { strip: id, mode: 'toggle' } } : mute)
	const variable = stripVariable(state, kind, id)
	return alternatives(
		layered(name, elements, steps, [], stripVariables(kind, id, stereo)),
		simple(name, `$(${LABEL}:${variable}_name)\\n$(${LABEL}:${variable}_db) dB`, steps, [
			whenSimple(mutedFeedback(kind, id), { bgcolor: FAMILY.clear.bright, color: FAMILY.clear.ink }),
		]),
	)
}

export function mixerPresets(state: SlidesState): { sections: Section[]; presets: Presets } {
	const presets: Presets = {}
	const groups: Extract<Section['definitions'][number], object>[] = []
	for (const kind of ['input', 'mix', 'output'] as const) {
		const strips = state.strips(kind)
		if (!strips.length) continue
		const buttons: string[] = []
		const dials: string[] = []
		for (const one of strips) {
			presets[`${kind}_${one.id}_strip`] = strip(state, kind, one.id, false)
			presets[`${kind}_${one.id}_dial`] = strip(state, kind, one.id, true)
			buttons.push(`${kind}_${one.id}_strip`)
			dials.push(`${kind}_${one.id}_dial`)
		}
		const plural = kind === 'mix' ? 'Mixes' : `${KIND_LABEL[kind]}s`
		groups.push({
			id: `mixer_${kind}`,
			type: 'simple',
			name: plural,
			description:
				kind === 'input' ? 'Press to switch the input On Air or off.' : `Press to mute or unmute the ${kind}.`,
			presets: buttons,
		})
		groups.push({
			id: `mixer_${kind}_dials`,
			type: 'simple',
			name: `${plural}, for dials`,
			description: 'For a Stream Deck + dial or another encoder: turn to ride the level, press to mute.',
			presets: dials,
		})
	}
	if (state.audioOutputs.length) {
		presets.mixer_mute_all = tile({
			name: 'Mute every output',
			family: 'clear',
			icon: 'volume-x',
			label: 'Mute All',
			steps: press({ actionId: 'output_mute', options: { strip: 'all', mode: 'toggle' } }),
			lit: { feedbackId: 'output_muted', options: { strip: 'all' } },
		})
		groups.push({ id: 'mixer_all', type: 'simple', name: 'Everything', presets: ['mixer_mute_all'] })
	}
	if (!groups.length) return { sections: [], presets }
	return {
		sections: [
			{
				id: 'mixer',
				name: 'Audio Mixer',
				description:
					'A strip per input, mix and output: name, level, meter and state. Live meters need MxU Slides with API 1.1 or newer.',
				definitions: groups,
			},
		],
		presets,
	}
}
