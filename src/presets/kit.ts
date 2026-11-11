import {
	ButtonGraphicsDecorationType,
	type CompanionButtonStepActions,
	type CompanionLayeredButtonPresetDefinition,
	type CompanionPresetAlternatives,
	type CompanionPresetConditionFeedback,
	type CompanionPresetFeedbackStyleOverride,
	type CompanionPresetLocalVariable,
	type CompanionPresetOptionValues,
	type CompanionSimplePresetDefinition,
	type JsonValue,
	type SomeButtonGraphicsElement,
	type SomePresetLayeredFeedbackEntry,
	type SomePresetSimpleFeedbackEntry,
} from '@companion-module/base'
import type { CompositeElementsSchema } from '../elements.js'
import type { FeedbacksSchema } from '../feedbacks.js'
import { ICONS } from '../icons.js'
import type { ModuleSchema } from '../main.js'
import { BLACK, FAMILY, TILE, TILE_EDGE, WHITE, type FamilyName } from '../style.js'

/**
 * The building blocks of the preset buttons. Every button is laid out in a 72 x 72 unit space
 * (the size the designs were drawn at) and converted to the percentages Companion positions
 * elements with, so a layout reads the same on any key size, with the top bar on or off.
 */

export type Element = SomeButtonGraphicsElement<CompositeElementsSchema>
export type Override = CompanionPresetFeedbackStyleOverride
export type Steps = CompanionButtonStepActions<ModuleSchema>[]
export type Step = CompanionButtonStepActions<ModuleSchema>
export type LayeredFeedback = SomePresetLayeredFeedbackEntry<ModuleSchema>
export type SimpleFeedback = SomePresetSimpleFeedbackEntry<ModuleSchema>
export type LocalVariable = CompanionPresetLocalVariable<FeedbacksSchema>
export type Lit = CompanionPresetConditionFeedback<FeedbacksSchema>
export type Preset = CompanionPresetAlternatives<ModuleSchema>
export type Expression = { isExpression: true; value: string }

/** The connection's short name: Companion swaps it for the label of the connection a preset lands on. */
export const LABEL = 'slides'

export function expression(value: string): Expression {
	return { isExpression: true, value }
}

/** A local variable of the button, for use inside an expression. */
export function local(name: string): string {
	return `$(local:${name})`
}

/** A length in the 72-unit button space, as a percentage. */
export function pct(units: number): number {
	return Math.round((units / 72) * 10000) / 100
}

/** A feedback value kept in a local variable of the button, so elements can show it. */
export function localValue<K extends keyof FeedbacksSchema>(
	variableName: string,
	feedbackId: K,
	options: CompanionPresetOptionValues<FeedbacksSchema[K]['options']>,
): LocalVariable {
	return { variableType: 'feedback', variableName, feedbackId, options } as LocalVariable
}

export function set(elementId: string, elementProperty: string, value: JsonValue | Expression): Override {
	const override =
		typeof value === 'object' && value !== null && 'isExpression' in value
			? (value as Expression)
			: { isExpression: false as const, value }
	return { elementId, elementProperty, override }
}

/** A boolean feedback with the element changes it makes on a layered button. */
export function when(lit: Lit, styleOverrides: Override[]): LayeredFeedback {
	return { ...lit, styleOverrides }
}

/** The same feedback with a plain style, for the simple variant of a preset. */
export function whenSimple(lit: Lit, style: { bgcolor?: number; color?: number; text?: string }): SimpleFeedback {
	return { ...lit, style }
}

interface BoxOptions {
	/** Corner radius in units. */
	radius?: number
	/** Border width in units, drawn inside the box. */
	border?: number
	borderColor?: number | Expression
	enabled?: boolean | Expression
	name?: string
}

export function box(
	id: string,
	x: number | Expression,
	y: number | Expression,
	width: number | Expression,
	height: number,
	color: number | Expression,
	options: BoxOptions = {},
): Element {
	const shorter = typeof width === 'number' ? Math.min(width, height) : height
	return {
		type: 'box',
		id,
		name: options.name ?? id,
		x: typeof x === 'number' ? pct(x) : x,
		y: typeof y === 'number' ? pct(y) : y,
		width: typeof width === 'number' ? pct(width) : width,
		height: pct(height),
		color,
		cornerRadius: options.radius ? Math.min(100, Math.round((options.radius / (shorter / 2)) * 100)) : 0,
		borderWidth: options.border ? pct(options.border) : 0,
		borderColor: options.borderColor ?? BLACK,
		borderPosition: 'inside',
		...(options.enabled === undefined ? {} : { enabled: options.enabled }),
	}
}

interface TextOptions {
	/** Text height as a percentage of the box height. */
	size?: number
	weight?: 'bold' | 'normal'
	halign?: 'left' | 'center' | 'right'
	valign?: 'top' | 'center' | 'bottom'
	enabled?: boolean | Expression
	opacity?: number
	name?: string
}

export function label(
	id: string,
	text: string | Expression,
	x: number,
	y: number,
	width: number,
	height: number,
	color: number | Expression,
	options: TextOptions = {},
): Element {
	return {
		type: 'text',
		id,
		name: options.name ?? id,
		x: pct(x),
		y: pct(y),
		width: pct(width),
		height: pct(height),
		text,
		fontsize: options.size ?? 100,
		fontsizeAllowShrink: true,
		weight: options.weight ?? 'bold',
		color,
		halign: options.halign ?? 'center',
		valign: options.valign ?? 'center',
		...(options.enabled === undefined ? {} : { enabled: options.enabled }),
		...(options.opacity === undefined ? {} : { opacity: options.opacity }),
	}
}

/** The cell every generated glyph is drawn into (see icons.ts). */
export const GLYPH_CELL = { x: 12, y: 2, size: 48 }

/** A glyph from the generated table. An unknown key draws nothing rather than failing the button. */
export function glyph(id: string, key: string, enabled: boolean | Expression = true): Element {
	return {
		type: 'image',
		id,
		name: id,
		x: pct(GLYPH_CELL.x),
		y: pct(GLYPH_CELL.y),
		width: pct(GLYPH_CELL.size),
		height: pct(GLYPH_CELL.size),
		base64Image: ICONS[key] ?? null,
		fillMode: 'fit',
		halign: 'center',
		valign: 'center',
		enabled,
	}
}

/** The dark tile every button starts from: rounded, with a faint edge. */
export function tileBase(color: number | Expression = TILE, edge: number | Expression = TILE_EDGE): Element {
	return box('tile', 0, 0, 72, 72, color, { radius: 6, border: 1, borderColor: edge, name: 'Tile' })
}

/** The caption under a glyph: one line, or two when the name is long. */
export function caption(text: string | Expression, color: number, id = 'caption'): Element {
	return label(id, text, 3, 45, 66, 24, color, { size: 50, name: 'Caption' })
}

export function layered(
	name: string,
	elements: Element[],
	steps: Steps,
	feedbacks: LayeredFeedback[] = [],
	localVariables: LocalVariable[] = [],
): CompanionLayeredButtonPresetDefinition<ModuleSchema> {
	return {
		type: 'layered',
		name,
		// The layout owns the whole key: no top bar to depend on, a border while pressed.
		canvas: { decoration: ButtonGraphicsDecorationType.Border },
		elements,
		steps,
		feedbacks,
		...(localVariables.length ? { localVariables } : {}),
	}
}

export function simple(
	name: string,
	text: string,
	steps: Steps,
	feedbacks: SimpleFeedback[] = [],
	style: { color?: number; bgcolor?: number } = {},
): CompanionSimplePresetDefinition<ModuleSchema> {
	return {
		type: 'simple',
		name,
		style: {
			text,
			size: 'auto',
			color: style.color ?? WHITE,
			bgcolor: style.bgcolor ?? TILE,
			show_topbar: false,
		},
		steps,
		feedbacks,
	}
}

/** The layered look first; a Companion that cannot draw it shows the simple one. */
export function alternatives(
	rich: CompanionLayeredButtonPresetDefinition<ModuleSchema>,
	plain: CompanionSimplePresetDefinition<ModuleSchema>,
): Preset {
	return { type: 'alternatives', variants: [rich, plain] }
}

export function press(...down: Step['down']): Steps {
	return [{ down, up: [] }]
}

export interface TileSpec {
	name: string
	family: FamilyName
	/** A Lucide icon name; the table holds it as `<icon>.<family>` and `<icon>.<family>.ink`. */
	icon: string
	label: string | Expression
	/** Text of the simple variant when the label is an expression. */
	plainLabel?: string
	steps: Steps
	/** The feedback that lights the tile. */
	lit?: Lit
	/** The family whose color fills the tile while lit, when it is not the tile's own. */
	litFamily?: FamilyName
	/** `fill`: filled while lit. `always`: always filled. `plain`: never filled. */
	look?: 'fill' | 'always' | 'plain'
}

/**
 * The standard button: a glyph over a caption on the dark tile. Dark when not in use, filled
 * with its family's color while its feedback is true.
 */
export function tile(spec: TileSpec): Preset {
	const litName = spec.litFamily ?? spec.family
	const lit = FAMILY[litName]
	const look = spec.look ?? (spec.lit ? 'fill' : 'plain')
	const filled = look === 'always'
	const plainText = spec.plainLabel ?? (typeof spec.label === 'string' ? spec.label : spec.name)

	// A tile carries only the glyphs it can show: the family-colored one while dark, the ink one while filled.
	const elements: Element[] = [
		tileBase(filled ? lit.bright : TILE, filled ? lit.bright : TILE_EDGE),
		...(filled ? [] : [glyph('glyph', `${spec.icon}.${spec.family}`)]),
		...(look === 'plain' ? [] : [glyph('glyphLit', `${spec.icon}.${litName}.ink`, filled)]),
		caption(spec.label, filled ? lit.ink : WHITE),
	]
	const feedbacks: LayeredFeedback[] = []
	const plainFeedbacks: SimpleFeedback[] = []
	if (spec.lit && look === 'fill') {
		feedbacks.push(
			when(spec.lit, [
				set('tile', 'color', lit.bright),
				set('tile', 'borderColor', lit.bright),
				set('glyph', 'enabled', false),
				set('glyphLit', 'enabled', true),
				set('caption', 'color', lit.ink),
			]),
		)
		plainFeedbacks.push(whenSimple(spec.lit, { bgcolor: lit.bright, color: lit.ink }))
	}
	return alternatives(
		layered(spec.name, elements, spec.steps, feedbacks),
		simple(spec.name, plainText, spec.steps, plainFeedbacks, filled ? { bgcolor: lit.bright, color: lit.ink } : {}),
	)
}
