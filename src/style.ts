/** The colors of the MxU Slides buttons: one bright color per family, on the app's dark tile. */

export interface Family {
	/** The family's color: the glyph on a dark tile, the fill of a lit one. */
	bright: number
	/** Text and glyph on top of the bright fill. */
	ink: number
}

export const FAMILY = {
	go: { bright: 0xffd60a, ink: 0x1a1500 },
	clear: { bright: 0xff453a, ink: 0xffffff },
	timer: { bright: 0x30d158, ink: 0x04210c },
	audio: { bright: 0x40c8e0, ink: 0x04222a },
	media: { bright: 0x0a84ff, ink: 0xffffff },
	output: { bright: 0x7d7aff, ink: 0xffffff },
	conf: { bright: 0xff9f0a, ink: 0x241500 },
	rec: { bright: 0xff375f, ink: 0xffffff },
	system: { bright: 0xe5e5ea, ink: 0x1c1c1e },
} satisfies Record<string, Family>

export type FamilyName = keyof typeof FAMILY

export const TILE = 0x1f1f1e
export const TILE_EDGE = 0x2e2e2d
export const WHITE = 0xf5f5f4
/** Transport keys mean the same everywhere: green while running, plain white Resume while paused, red stop. */
export const TRANSPORT = { running: 0x30d158, paused: WHITE, stop: 0xff453a }

export const DIM = 0xa3a3a0
export const BLACK = 0x000000
/** A quiet track on the dark tile, for bars and meters. */
export const TRACK = 0x3c3c3b
export const MUTED_TILE = 0x3a1210
export const OFF_PILL = 0x3a3a39
export const OFF_INK = 0xc9c9c6
export const METER_GREEN = 0x30d158
export const METER_AMBER = 0xffd60a
export const METER_RED = 0xff453a

/** `#RRGGBB` or `#RRGGBBAA` (as MxU Slides stores colors) as a Companion color number. */
export function hexColor(hex: string | undefined, fallback: number): number {
	const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex?.trim() ?? '')
	return match ? Number.parseInt(match[1], 16) : fallback
}

/** Dark or light text, whichever reads on this fill. */
export function inkOn(color: number): number {
	const red = (color >> 16) & 0xff
	const green = (color >> 8) & 0xff
	const blue = color & 0xff
	return 0.299 * red + 0.587 * green + 0.114 * blue > 150 ? 0x0b0b0b : 0xffffff
}

/** A color at part strength over the dark tile: how a dimmed glyph looks. */
export function dimmed(color: number, strength = 0.42): number {
	const mix = (shift: number): number => {
		const over = (color >> shift) & 0xff
		const under = (TILE >> shift) & 0xff
		return Math.round(under + (over - under) * strength)
	}
	return (mix(16) << 16) | (mix(8) << 8) | mix(0)
}
