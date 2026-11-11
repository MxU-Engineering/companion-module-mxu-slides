import type { CompanionActionDefinitions } from '@companion-module/base'
import { audioActions, type AudioActions } from './actions/audio.js'
import { mediaActions, type MediaActions } from './actions/media.js'
import { showActions, type ShowActions } from './actions/show.js'
import { systemActions, type SystemActions } from './actions/system.js'
import { timerActions, type TimerActions } from './actions/timers.js'
import { Choices, type SlidesContext } from './context.js'

export type ActionsSchema = ShowActions & MediaActions & TimerActions & AudioActions & SystemActions

/** Every action, with its lists built from what the connected MxU Slides has. */
export function GetActions(ctx: SlidesContext): CompanionActionDefinitions<ActionsSchema> {
	const choices = new Choices(ctx.state)
	return {
		...showActions(ctx, choices),
		...mediaActions(ctx, choices),
		...timerActions(ctx, choices),
		...audioActions(ctx, choices),
		...systemActions(ctx, choices),
	}
}
