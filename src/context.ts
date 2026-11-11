import type { DropdownChoice, LogLevel } from '@companion-module/base'
import type { SlidesClient } from './api/client.js'
import type { LibraryKind } from './api/types.js'
import type { Aspect, SlidesState } from './state.js'

/** State MxU Slides does not push, which the module reads again after it changes it. */
export type Refreshable = 'mixer' | 'midi' | 'lock' | 'follow'

/**
 * What the action, feedback, variable and preset definitions need from the module. The module
 * instance provides it inside Companion; the tests provide their own against the fake Slides.
 */
export interface SlidesContext {
	readonly state: SlidesState
	log(level: LogLevel, message: string): void
	/**
	 * Runs one action against MxU Slides. A Slides too old for it gets one clear log line, and a
	 * command Slides refuses is logged against this action only; neither one throws.
	 */
	run(name: string, needs: string | undefined, command: (client: SlidesClient) => Promise<void>): Promise<void>
	/** Reads state again that Slides does not push. */
	refresh(what: Refreshable): void
	/** An action changed this part of the state itself, ahead of the push that will confirm it. */
	changed(aspects: Aspect[]): void
}

/** An option as text, whatever type an expression left it in. */
export function text(value: unknown): string {
	if (typeof value === 'string') return value
	return typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

/** An option as a number; `fallback` when it is not one. */
export function number(value: unknown, fallback = 0): number {
	const parsed = typeof value === 'number' ? value : Number.parseFloat(text(value))
	return Number.isFinite(parsed) ? parsed : fallback
}

export const NONE_CHOICE: DropdownChoice<string> = { id: '', label: '(none in MxU Slides yet)' }

function named(items: { id: string; name: string; folder?: string; folderName?: string }[]): DropdownChoice<string>[] {
	return items.map((item) => {
		const folder = item.folder ?? item.folderName
		return { id: item.id, label: folder ? `${folder} / ${item.name}` : item.name }
	})
}

/** Dropdown choices built from what the connected MxU Slides has. */
export class Choices {
	readonly #state: SlidesState

	constructor(state: SlidesState) {
		this.#state = state
	}

	#orNone(choices: DropdownChoice<string>[]): DropdownChoice<string>[] {
		return choices.length ? choices : [NONE_CHOICE]
	}

	library(kind: LibraryKind): DropdownChoice<string>[] {
		return this.#orNone(named(this.#state.library[kind]))
	}

	combos(): DropdownChoice<string>[] {
		const combos = this.#state.combos.length ? this.#state.combos : this.#state.library['action-combos']
		return this.#orNone(named(combos))
	}

	timers(): DropdownChoice<string>[] {
		return this.#orNone(named(this.#state.timers))
	}

	strips(kind: 'input' | 'mix' | 'output'): DropdownChoice<string>[] {
		return this.#orNone(named(this.#state.strips(kind)))
	}

	videoInputs(): DropdownChoice<string>[] {
		return this.#orNone(named(this.#state.videoInputs))
	}

	midi(): DropdownChoice<string>[] {
		return this.#orNone(named(this.#state.midi))
	}

	outputPresets(): DropdownChoice<string>[] {
		return this.#orNone(named(this.#state.outputs?.presets ?? []))
	}

	confidenceScreens(): DropdownChoice<string>[] {
		return this.#orNone(named(this.#state.show?.confidence?.screens ?? []))
	}

	triggers(): DropdownChoice<string>[] {
		const triggers = (this.#state.scheduler?.triggers ?? []).filter((trigger) => !trigger.archived)
		return this.#orNone(named(triggers))
	}

	/** The first real choice, for a dropdown's default. */
	static first(choices: DropdownChoice<string>[]): string {
		return choices[0]?.id ?? ''
	}
}

/** The built-in layers of the room, bottom to top, by the ids MxU Slides stores. */
export const LAYERS: DropdownChoice<string>[] = [
	{ id: 'videoInput', label: 'Video Input' },
	{ id: 'loopingVideos', label: 'Background Media' },
	{ id: 'stillGraphics', label: 'Still Graphics' },
	{ id: 'videos', label: 'Foreground Videos' },
	{ id: 'slide', label: 'Slide' },
	{ id: 'overlays', label: 'Overlays' },
	{ id: 'alerts', label: 'Alerts' },
]

/** What Clear can take down, by the names the API uses. */
export const CLEAR_TARGETS: DropdownChoice<string>[] = [
	{ id: 'slides', label: 'Slides' },
	{ id: 'media', label: 'Media' },
	{ id: 'overlays', label: 'Overlays' },
	{ id: 'audio', label: 'Music' },
	{ id: 'alerts', label: 'Alerts' },
	{ id: 'inputs', label: 'Inputs' },
]

export const ON_OFF_TOGGLE: DropdownChoice<string>[] = [
	{ id: 'toggle', label: 'Toggle' },
	{ id: 'on', label: 'On' },
	{ id: 'off', label: 'Off' },
]

/** Resolves On / Off / Toggle against the current value. */
export function resolveToggle(mode: unknown, current: boolean): boolean {
	const chosen = text(mode)
	return chosen === 'toggle' ? !current : chosen === 'on'
}
