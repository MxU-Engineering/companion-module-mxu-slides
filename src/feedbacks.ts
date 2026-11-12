import type { CompanionFeedbackDefinitions } from '@companion-module/base'
import { Choices, type SlidesContext } from './context.js'
import { audioFeedbacks, type AudioFeedbacks } from './feedbacks/audio.js'
import { mediaFeedbacks, type MediaFeedbacks } from './feedbacks/media.js'
import { showFeedbacks, type ShowFeedbacks } from './feedbacks/show.js'
import { systemFeedbacks, type SystemFeedbacks } from './feedbacks/system.js'
import { timerFeedbacks, type TimerFeedbacks } from './feedbacks/timers.js'
import type { Aspect } from './state.js'

export type FeedbacksSchema = ShowFeedbacks & MediaFeedbacks & TimerFeedbacks & AudioFeedbacks & SystemFeedbacks

export type FeedbackId = keyof FeedbacksSchema

/** Every feedback, with its lists built from what the connected MxU Slides has. */
export function GetFeedbacks(ctx: SlidesContext): CompanionFeedbackDefinitions<FeedbacksSchema> {
	const choices = new Choices(ctx.state)
	return {
		...showFeedbacks(ctx, choices),
		...mediaFeedbacks(ctx, choices),
		...timerFeedbacks(ctx, choices),
		...audioFeedbacks(ctx, choices),
		...systemFeedbacks(ctx, choices),
	}
}

/** Which feedbacks read which part of the state, so a change rechecks only those. */
const READS: Record<Aspect, FeedbackId[]> = {
	slide: ['live', 'deck_live', 'slide_number', 'section_live', 'show_value'],
	next: ['show_value'],
	sections: ['section_live', 'section_value'],
	layers: ['live'],
	overlays: ['live', 'overlay_live'],
	alert: ['live', 'alert_showing'],
	service: ['show_value'],
	confidence: ['confidence_layout'],
	timers: ['timer_state', 'timer_value'],
	music: ['live', 'music_playing', 'music_paused'],
	transport: ['video_playing', 'video_value'],
	outputs: ['output_preset_active'],
	scheduler: ['scheduler_on', 'trigger_enabled'],
	timecode: ['timeline_playing'],
	lock: ['lock_on', 'updates_waiting'],
	follow: ['follow_role'],
	midi: ['midi_device_on'],
	videoInputs: ['live', 'video_input_live'],
	mixer: [
		'input_on_air',
		'input_muted',
		'mix_muted',
		'output_muted',
		'input_value',
		'mix_value',
		'output_value',
		'input_meter',
		'mix_meter',
		'output_meter',
	],
	meters: ['input_meter', 'mix_meter', 'output_meter'],
	capture: ['recording', 'streaming', 'capture_value'],
	serviceTracking: ['service_state'],
	library: [],
	pictures: ['slide_picture'],
	health: ['not_responding'],
}

/** The feedbacks to recheck after these parts of the state changed. */
export function feedbacksFor(aspects: Iterable<Aspect>): FeedbackId[] {
	const ids = new Set<FeedbackId>()
	for (const aspect of aspects) {
		for (const id of READS[aspect]) ids.add(id)
	}
	return [...ids]
}

/** The feedbacks whose answer moves with the clock, rechecked once a second while something runs. */
export const CLOCK_FEEDBACKS: FeedbackId[] = ['timer_state', 'timer_value', 'video_value', 'capture_value']
