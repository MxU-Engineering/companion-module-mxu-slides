/* eslint-disable @typescript-eslint/no-floating-promises -- the node:test runner awaits describe() and it() itself */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TimerStatus } from '../api/types.js'
import {
	busPosition,
	captureElapsed,
	clockCorrection,
	formatClock,
	formatHms,
	formatMs,
	parseDuration,
	timecodeClock,
	timerProgress,
	timerRemaining,
	timerState,
	timerValue,
	transportPosition,
	wholeSeconds,
} from '../time.js'

const NOW = Date.parse('2026-11-15T15:00:00Z')
const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString()

function timer(extra: Partial<TimerStatus>): TimerStatus {
	return { id: 't', name: 'Sermon', mode: 'countdown', running: false, displaySeconds: 0, overrun: false, ...extra }
}

describe('timer maths', () => {
	it('counts a running countdown down from its anchors', () => {
		const sermon = timer({ durationSeconds: 300, running: true, runningSince: ago(100), bankedSeconds: 20 })
		assert.equal(timerValue(sermon, NOW), 180)
		assert.equal(timerValue(sermon, NOW + 1000), 179)
		assert.equal(timerRemaining(sermon, NOW), 180)
		assert.equal(timerProgress(sermon, NOW), 0.4)
		assert.equal(timerState(sermon, NOW), 'running')
	})

	it('holds a paused timer where it stopped', () => {
		const paused = timer({ durationSeconds: 300, bankedSeconds: 125 })
		assert.equal(timerValue(paused, NOW), 175)
		assert.equal(timerValue(paused, NOW + 60_000), 175)
		assert.equal(timerState(paused, NOW), 'paused')
	})

	it('reads idle before a timer is started, and uses `started` when Slides sends it', () => {
		assert.equal(timerState(timer({ durationSeconds: 300 }), NOW), 'idle')
		assert.equal(timerState(timer({ durationSeconds: 300, started: true }), NOW), 'paused')
		assert.equal(timerState(timer({}), NOW), 'idle')
	})

	it('goes into warning inside the last 30 seconds and over past zero', () => {
		const late = timer({ durationSeconds: 300, running: true, runningSince: ago(275) })
		assert.equal(timerState(late, NOW), 'warning')
		const over = timer({ durationSeconds: 300, running: true, runningSince: ago(342) })
		assert.equal(timerValue(over, NOW), -42)
		assert.equal(timerState(over, NOW), 'over')
		assert.equal(timerProgress(over, NOW), 1)
		assert.equal(formatClock(timerValue(over, NOW)), '-0:42')
	})

	it("honors a timer's own warning levels", () => {
		const custom = timer({
			durationSeconds: 600,
			running: true,
			runningSince: ago(500),
			warnings: [{ remainingSeconds: 120, colorHex: '#FFB826FF' }],
		})
		assert.equal(timerState(custom, NOW), 'warning')
		assert.equal(timerState({ ...custom, warnings: [] }, NOW), 'running')
	})

	it('counts up, with an optional limit that turns it over', () => {
		const service = timer({ mode: 'countUp', running: true, runningSince: ago(768) })
		assert.equal(timerValue(service, NOW), 768)
		assert.equal(timerRemaining(service, NOW), undefined)
		assert.equal(timerProgress(service, NOW), 0)
		assert.equal(timerState(service, NOW), 'running')
		const limited = timer({ mode: 'countUp', running: true, runningSince: ago(70), durationSeconds: 60 })
		assert.equal(timerState(limited, NOW), 'over')
	})

	it('counts down to a time of day whether or not it was started', () => {
		const toTime = timer({
			mode: 'countdownToTime',
			targetTime: new Date(NOW + 90_000).toISOString(),
			armedAt: ago(90),
		})
		assert.equal(timerValue(toTime, NOW), 90)
		assert.equal(timerProgress(toTime, NOW), 0.5)
		assert.equal(timerState(toTime, NOW), 'running')
		assert.equal(timerValue(timer({ mode: 'countdownToTime' }), NOW), 0)
	})

	it('follows an adjustment made during a run from the changed anchors alone', () => {
		const running = timer({ durationSeconds: 300, running: true, runningSince: ago(100) })
		assert.equal(timerValue({ ...running, durationSeconds: 330 }, NOW), 230)
	})
})

describe('formatting', () => {
	it('cuts toward zero, so 0:01 means a full second is left', () => {
		assert.equal(wholeSeconds(1.9), 1)
		assert.equal(wholeSeconds(-0.4), 0)
		assert.equal(formatClock(59.9), '0:59')
		assert.equal(formatClock(-0.5), '0:00')
	})

	it('reads like MxU Slides: m:ss under an hour, h:mm:ss over', () => {
		assert.equal(formatClock(768), '12:48')
		assert.equal(formatClock(125), '2:05')
		assert.equal(formatClock(3725), '1:02:05')
		assert.equal(formatClock(-3725), '-1:02:05')
		assert.equal(formatHms(125), '0:02:05')
		assert.equal(formatMs(3725), '62:05')
	})

	it('reads amounts of time people type', () => {
		assert.equal(parseDuration('90'), 90)
		assert.equal(parseDuration(' 1:30 '), 90)
		assert.equal(parseDuration('1:02:03'), 3723)
		assert.equal(parseDuration('5m'), 300)
		assert.equal(parseDuration('1h 30m'), 5400)
		assert.equal(parseDuration('45 sec'), 45)
		assert.equal(parseDuration('-30'), -30)
		assert.equal(parseDuration('+1:00'), 60)
		assert.equal(parseDuration('1.5'), 1.5)
		assert.equal(parseDuration(''), undefined)
		assert.equal(parseDuration('soon'), undefined)
		assert.equal(parseDuration('1:2:3:4'), undefined)
	})
})

describe('other clocks', () => {
	it('moves a playing video on from where Slides last reported it', () => {
		const row = {
			mediaId: 'm',
			name: 'Loop',
			layer: 'videos',
			playing: true,
			looping: false,
			position: 30,
			duration: 120,
		}
		assert.equal(transportPosition(row, NOW, NOW + 10_000), 40)
		assert.equal(transportPosition(row, NOW, NOW + 200_000), 120)
		assert.equal(transportPosition({ ...row, playing: false }, NOW, NOW + 10_000), 30)
		assert.equal(transportPosition({ ...row, looping: true }, NOW, NOW + 100_000), 10)
	})

	it('moves playing music on the same way', () => {
		assert.equal(busPosition({ playing: true, position: 5, duration: 200 }, NOW, NOW + 3000), 8)
		assert.equal(busPosition({ playing: false, position: 5, duration: 200 }, NOW, NOW + 3000), 5)
	})

	it('counts how long a recording has run', () => {
		assert.equal(captureElapsed({ active: true, startedAt: ago(2530) }, NOW), 2530)
		assert.equal(captureElapsed({ active: false, startedAt: ago(2530) }, NOW), 0)
		assert.equal(captureElapsed(undefined, NOW), 0)
	})

	it('counts incoming timecode on from its anchor', () => {
		const status = {
			hasInput: true,
			source: 'ltc',
			follows: true,
			state: 'locked',
			reverse: false,
			offsetFrames: 0,
			anchor: { seconds: 3600, anchoredAt: ago(65), running: true, reverse: false },
		}
		assert.equal(timecodeClock(status, NOW), '01:01:05')
		assert.equal(timecodeClock({ ...status, anchor: { ...status.anchor, running: false } }, NOW), '01:00:00')
		assert.equal(timecodeClock(undefined, NOW), '')
	})
})

describe('clock correction', () => {
	it('is zero when both computers agree to within rounding', () => {
		const sermon = timer({ durationSeconds: 300, running: true, runningSince: ago(100), displaySeconds: 200 })
		assert.equal(clockCorrection([sermon], NOW), 0)
		assert.equal(clockCorrection([{ ...sermon, displaySeconds: 199 }], NOW), 0)
	})

	it('finds a clock that runs behind or ahead of the one Slides is on', () => {
		// Slides showed 170 left; our clock says 200, so we are 30 seconds behind.
		const sermon = timer({ durationSeconds: 300, running: true, runningSince: ago(100), displaySeconds: 170 })
		assert.equal(clockCorrection([sermon], NOW), 30_000)
		assert.equal(timerValue(sermon, NOW + 30_000), 170)
		const service = timer({ mode: 'countUp', running: true, runningSince: ago(100), displaySeconds: 130 })
		assert.equal(clockCorrection([service], NOW), 30_000)
		assert.equal(clockCorrection([{ ...service, displaySeconds: 60 }], NOW), -40_000)
	})

	it('reads a start sent to the whole second as the middle of that second', () => {
		// Started at 14:58:20.770; Slides sends 14:58:20. At 15:00:00.000 the app shows 99 (99.23 s).
		const whole = timer({ mode: 'countUp', running: true, runningSince: '2026-11-15T14:58:20Z' })
		assert.equal(timerValue(whole, NOW), 99.5)
		// A start sent with its fraction is taken as it is.
		const exact = timer({ mode: 'countUp', running: true, runningSince: '2026-11-15T14:58:20.770Z' })
		assert.equal(timerValue(exact, NOW), 99.23)
	})

	it('trusts the timer that agrees: one odd timer does not move every clock on the buttons', () => {
		// A timer Slides shows by a rule of its own (it reads 0 here, the anchors say -45) and one that agrees.
		const odd = timer({ durationSeconds: 0, running: true, runningSince: ago(45), displaySeconds: 0 })
		const service = timer({ mode: 'countUp', running: true, runningSince: ago(100), displaySeconds: 100 })
		assert.equal(clockCorrection([odd, service], NOW), 0)
		// With both clocks really apart, every timer says so and the closest reading is used.
		const late = timer({ mode: 'countUp', running: true, runningSince: ago(100), displaySeconds: 130 })
		assert.equal(clockCorrection([odd, late], NOW), 30_000)
	})

	it('has nothing to say when no timer is running', () => {
		assert.equal(clockCorrection([timer({ durationSeconds: 300 })], NOW), undefined)
		assert.equal(clockCorrection([], NOW), undefined)
	})
})
