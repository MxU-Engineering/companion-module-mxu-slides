import type { AudioBus, CaptureSide, TimecodeStatus, TimerStatus, TransportRow } from './api/types.js'

/**
 * Timer maths. MxU Slides sends each timer's anchors once (when the running stretch began, the
 * seconds already banked, the length or the target time) and never again while it runs, so the
 * module counts the digits itself. These functions mirror what Slides shows on its own screens.
 */

export type TimerState = 'idle' | 'running' | 'paused' | 'warning' | 'over'

function ms(date: string | undefined): number | undefined {
	if (!date) return undefined
	const value = Date.parse(date)
	return Number.isNaN(value) ? undefined : value
}

/**
 * The moment something began. MxU Slides sends these to the whole second, so the real moment
 * lies somewhere in that second: its middle is right on average and never more than half a
 * second out, where the start of the second would read up to a whole second off what the app
 * shows. A time sent with a fraction is taken as it is.
 */
function began(date: string | undefined): number | undefined {
	const value = ms(date)
	if (value === undefined || !date) return value
	return /\.\d/.test(date) ? value : value + 500
}

/** Seconds on the stopwatch at `now` (banked stretches plus the live one). */
export function timerElapsed(timer: TimerStatus, now: number): number {
	const since = began(timer.runningSince)
	const live = timer.running && since !== undefined ? Math.max(0, (now - since) / 1000) : 0
	return (timer.bankedSeconds ?? 0) + live
}

/** The signed value Slides shows: counts up for a count-up, down otherwise (negative = over). */
export function timerValue(timer: TimerStatus, now: number): number {
	switch (timer.mode) {
		case 'countUp':
			return timerElapsed(timer, now)
		case 'countdownToTime': {
			const target = ms(timer.targetTime)
			return target === undefined ? 0 : (target - now) / 1000
		}
		default:
			return (timer.durationSeconds ?? 0) - timerElapsed(timer, now)
	}
}

/** Seconds left before the end, or undefined where "left" means nothing (an open count-up). */
export function timerRemaining(timer: TimerStatus, now: number): number | undefined {
	if (timer.mode !== 'countUp') return timerValue(timer, now)
	const limit = timer.durationSeconds ?? 0
	return limit > 0 ? limit - timerElapsed(timer, now) : undefined
}

/** A wall-clock target counts whether or not anyone pressed Start. */
export function timerIsTicking(timer: TimerStatus): boolean {
	return timer.running || (timer.mode === 'countdownToTime' && !!timer.targetTime)
}

function timerIsIdle(timer: TimerStatus): boolean {
	return (
		!timer.running &&
		(timer.bankedSeconds ?? 0) === 0 &&
		(timer.durationSeconds ?? 0) === 0 &&
		(timer.mode !== 'countdownToTime' || !timer.targetTime)
	)
}

/** The warning level in effect: the deepest threshold the timer has crossed. */
export function timerWarning(
	timer: TimerStatus,
	now: number,
): { remainingSeconds: number; colorHex: string } | undefined {
	if (timerIsIdle(timer)) return undefined
	const remaining = timerRemaining(timer, now)
	if (remaining === undefined) return undefined
	const warnings = timer.warnings ?? [
		{ remainingSeconds: 30, colorHex: '#FFB826FF' },
		{ remainingSeconds: 0, colorHex: '#FF4739FF' },
	]
	let deepest: { remainingSeconds: number; colorHex: string } | undefined
	for (const warning of warnings) {
		if (warning.remainingSeconds < remaining) continue
		if (!deepest || warning.remainingSeconds < deepest.remainingSeconds) deepest = warning
	}
	return deepest
}

export function timerState(timer: TimerStatus, now: number): TimerState {
	const warning = timerWarning(timer, now)
	if (warning) return warning.remainingSeconds <= 0 ? 'over' : 'warning'
	if (timerIsTicking(timer)) return 'running'
	const started = timer.started ?? (timer.bankedSeconds ?? 0) > 0
	return started ? 'paused' : 'idle'
}

/** How far through the timer is, 0 to 1. 0 where a bar means nothing. */
export function timerProgress(timer: TimerStatus, now: number): number {
	if (timer.mode === 'countdownToTime') {
		const armed = ms(timer.armedAt)
		const target = ms(timer.targetTime)
		if (armed === undefined || target === undefined) return 0
		const span = target - armed
		return span > 0 ? clamp01((now - armed) / span) : 1
	}
	const length = timer.durationSeconds ?? 0
	return length > 0 ? clamp01(timerElapsed(timer, now) / length) : 0
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value))
}

/** Whole seconds as a reader sees them: cut toward zero, so "0:01" means a full second is left. */
export function wholeSeconds(seconds: number): number {
	const whole = Math.trunc(seconds)
	return whole === 0 ? 0 : whole
}

function pad(value: number): string {
	return String(value).padStart(2, '0')
}

/** `m:ss` under an hour, `h:mm:ss` over, a leading minus when over time. The way Slides reads. */
export function formatClock(seconds: number): string {
	const total = wholeSeconds(seconds)
	const size = Math.abs(total)
	const sign = total < 0 ? '-' : ''
	if (size >= 3600) return `${sign}${Math.floor(size / 3600)}:${pad(Math.floor(size / 60) % 60)}:${pad(size % 60)}`
	return `${sign}${Math.floor(size / 60)}:${pad(size % 60)}`
}

/** Always `h:mm:ss`. */
export function formatHms(seconds: number): string {
	const total = wholeSeconds(seconds)
	const size = Math.abs(total)
	return `${total < 0 ? '-' : ''}${Math.floor(size / 3600)}:${pad(Math.floor(size / 60) % 60)}:${pad(size % 60)}`
}

/** Always `m:ss`; minutes keep counting past 59. */
export function formatMs(seconds: number): string {
	const total = wholeSeconds(seconds)
	const size = Math.abs(total)
	return `${total < 0 ? '-' : ''}${Math.floor(size / 60)}:${pad(size % 60)}`
}

/**
 * Reads an amount of time someone typed: plain seconds (`90`, `-30`, `1.5`), a clock (`1:30`,
 * `1:02:03`) or units (`5m`, `1h 30m`, `45s`). Undefined when it is none of those.
 */
export function parseDuration(text: string): number | undefined {
	const trimmed = text.trim().toLowerCase()
	if (!trimmed) return undefined
	const negative = trimmed.startsWith('-')
	const body = trimmed.replace(/^[+-]\s*/, '')
	let seconds: number | undefined
	if (/^\d+(\.\d+)?$/.test(body)) {
		seconds = Number(body)
	} else if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(body)) {
		seconds = body.split(':').reduce((total, part) => total * 60 + Number(part), 0)
	} else if (/^(\d+(\.\d+)?\s*(h|m|s|hr|hrs|min|mins|sec|secs)\s*)+$/.test(body)) {
		seconds = 0
		for (const match of body.matchAll(/(\d+(?:\.\d+)?)\s*(hr|hrs|h|mins|min|m|secs|sec|s)/g)) {
			const unit = match[2].startsWith('h') ? 3600 : match[2].startsWith('m') ? 60 : 1
			seconds += Number(match[1]) * unit
		}
	}
	if (seconds === undefined || !Number.isFinite(seconds)) return undefined
	return negative ? -seconds : seconds
}

/** Where a video is now, counted on from the moment Slides last reported it. */
export function transportPosition(row: TransportRow, receivedAt: number, now: number): number {
	const moved = row.playing ? Math.max(0, (now - receivedAt) / 1000) : 0
	const position = row.position + moved
	if (row.duration <= 0) return position
	return row.looping ? position % row.duration : Math.min(position, row.duration)
}

export function busPosition(bus: AudioBus, receivedAt: number, now: number): number {
	const moved = bus.playing ? Math.max(0, (now - receivedAt) / 1000) : 0
	const position = (bus.position ?? 0) + moved
	return bus.duration && bus.duration > 0 ? Math.min(position, bus.duration) : position
}

/** Seconds a recording or stream has been running; 0 when it is not. */
export function captureElapsed(side: CaptureSide | undefined, now: number): number {
	const started = began(side?.startedAt)
	if (!side?.active || started === undefined) return 0
	return Math.max(0, (now - started) / 1000)
}

/** Incoming timecode as `HH:MM:SS`, counted on from its anchor. Empty when there is none. */
export function timecodeClock(status: TimecodeStatus | undefined, now: number): string {
	const anchor = status?.anchor
	const anchored = began(anchor?.anchoredAt)
	if (!anchor || anchored === undefined) return ''
	const moved = anchor.running ? ((now - anchored) / 1000) * (anchor.reverse ? -1 : 1) : 0
	const total = Math.max(0, Math.trunc(anchor.seconds + moved))
	return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
}

/**
 * This computer's clock against the one MxU Slides runs on, in milliseconds to add to our own.
 * Slides stamps each timer with whole seconds it showed when it sent the list; when our own
 * count from the anchors disagrees by more than rounding allows, the two clocks differ and the
 * difference is the correction. Undefined when the list gives nothing to compare.
 */
export function clockCorrection(timers: TimerStatus[], receivedAt: number): number | undefined {
	let smallest: number | undefined
	for (const timer of timers) {
		if (!timerIsTicking(timer)) continue
		const drift = timerValue(timer, receivedAt) - timer.displaySeconds
		// Two clocks that differ disagree on every timer alike, so one timer that agrees settles it.
		if (Math.abs(drift) <= 1.5) return 0
		// A countdown that reads high here means our clock is behind theirs, and the reverse for a count-up.
		const correction = (timer.mode === 'countUp' ? -drift : drift) * 1000
		if (smallest === undefined || Math.abs(correction) < Math.abs(smallest)) smallest = correction
	}
	return smallest
}
