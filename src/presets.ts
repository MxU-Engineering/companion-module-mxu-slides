import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from './main.js'
import { mediaPresets } from './presets/media.js'
import { mixerPresets } from './presets/mixer.js'
import { showPresets } from './presets/show.js'
import { systemPresets } from './presets/system.js'
import { timerPresets } from './presets/timers.js'
import type { SlidesState } from './state.js'

/**
 * Every preset, in the order the Presets tab shows them. The lists (combos, timers, overlays,
 * mixer strips and so on) come from the connected MxU Slides and are rebuilt when it changes.
 * Preset ids are built from the ids MxU Slides gives its items, so they stay the same across
 * renames and updates.
 */
export function GetPresets(state: SlidesState): {
	sections: CompanionPresetSection<ModuleSchema>[]
	presets: CompanionPresetDefinitions<ModuleSchema>
} {
	const show = showPresets(state)
	const timers = timerPresets(state)
	const media = mediaPresets(state)
	const mixer = mixerPresets(state)
	const system = systemPresets(state)

	// Slides, Service, Clear, Action Combos, Timers, Media, Overlays, Alerts, Music, Audio Mixer, then the rest.
	return {
		sections: [...show.sections, ...timers.sections, ...media.sections, ...mixer.sections, ...system.sections],
		presets: { ...show.presets, ...timers.presets, ...media.presets, ...mixer.presets, ...system.presets },
	}
}
