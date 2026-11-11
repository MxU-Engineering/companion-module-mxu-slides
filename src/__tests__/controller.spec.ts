/* eslint-disable @typescript-eslint/no-floating-promises -- the node:test runner awaits describe() and it() itself */
import { InstanceStatus } from '@companion-module/base'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { SlidesController } from '../controller.js'
import { rig, sleep, TestHost, TIMING, until, type Rig } from './harness.js'

let open: Rig | undefined

async function connect(...args: Parameters<typeof rig>): Promise<Rig> {
	open = await rig(...args)
	return open
}

afterEach(async () => {
	await open?.close()
	open = undefined
})

describe('connecting', () => {
	it('is ready with the whole state of a 1.1 Slides, read from the subscription', async () => {
		const { host, controller, fake } = await connect()
		assert.equal(host.status, InstanceStatus.Ok)
		assert.equal(controller.state.timers.length, 3)
		assert.equal(controller.state.inputs.length, 4)
		assert.equal(controller.state.audioOutputs.length, 2)
		assert.equal(controller.state.combos.length, 3)
		assert.equal(controller.state.serviceTracking?.state, 'preService')
		assert.equal(controller.state.capture?.recording.active, false)
		const reads = fake.requests.filter((request) => request.method === 'GET').map((request) => request.path)
		for (const pushed of ['/v1/status', '/v1/timers', '/v1/audio/mixer', '/v1/capture', '/v1/outputs']) {
			assert.equal(reads.includes(pushed), false, `${pushed} came with the subscription`)
		}
		assert.equal(reads.includes('/v1/show/lock'), true, 'state without a topic is read once')
	})

	it('reads each topic once from a 1.0 Slides, which sends nothing on subscribe', async () => {
		const { host, controller, fake } = await connect({ apiVersion: '1.0' })
		assert.equal(host.status, InstanceStatus.Ok)
		assert.equal(controller.state.timers.length, 3)
		assert.equal(controller.state.inputs.length, 4)
		assert.equal(controller.state.mixes.length, 2)
		assert.equal(controller.state.audioOutputs.length, 0)
		assert.equal(controller.state.capture, undefined)
		const reads = fake.requests.filter((request) => request.method === 'GET').map((request) => request.path)
		assert.equal(reads.filter((path) => path === '/v1/status').length, 1)
		assert.equal(reads.includes('/v1/capture'), false)
		assert.equal(reads.includes('/v1/action-combos'), false)
	})

	it('never reads on a timer: a quiet Slides gets no requests at all', async () => {
		const { fake } = await connect()
		const before = fake.requests.length
		await sleep(600)
		assert.equal(fake.requests.length, before)
	})

	it('asks for a configuration before it tries anything', async () => {
		const host = new TestHost()
		const controller = new SlidesController(host, TIMING)
		controller.start({}, {})
		assert.equal(host.status, InstanceStatus.BadConfig)
		controller.restart({ host: '127.0.0.1', port: 6980 }, {})
		assert.equal(host.status, InstanceStatus.BadConfig)
		assert.match(host.statuses.at(-1)?.message ?? '', /API key/)
		controller.stop()
	})

	it('says when the key is wrong, and when it can only view', async () => {
		const view = await connect({ scope: 'view' })
		assert.equal(view.host.status, InstanceStatus.InsufficientPermissions)
		await view.press('clear_all')
		assert.match(view.host.problems().at(-1) ?? '', /Clear All: .*control scope.*Operate key/)

		const host = new TestHost()
		const controller = new SlidesController(host, TIMING)
		controller.start({ host: '127.0.0.1', port: view.fake.port }, { apiKey: 'mxu_wrong' })
		await until(() => host.status === InstanceStatus.AuthenticationFailure, 'the key refused')
		controller.stop()
	})

	it('empties every variable and forgets the state when Slides goes away, then fills them again', async () => {
		const { fake, host, controller } = await connect()
		assert.equal(host.values.deck_name, 'Goodness of God')
		assert.equal(host.values.timer_sermon, '35:00')
		fake.dropConnections()
		await until(() => host.status === InstanceStatus.Disconnected || controller.state.info === undefined, 'disconnect')
		assert.equal(host.values.deck_name, '')
		assert.equal(host.values.timer_sermon, '')
		assert.deepEqual(
			Object.entries(host.values).filter(([, value]) => value !== ''),
			[],
		)
		await until(() => host.values.deck_name === 'Goodness of God', 'variables back')
		assert.equal(host.status, InstanceStatus.Ok)
	})

	it('warns while Slides answers but its window has frozen', async () => {
		const { fake, host, feedback } = await connect()
		fake.freeze(true)
		await until(() => host.status === InstanceStatus.UnknownWarning, 'warning')
		assert.equal(await feedback('not_responding'), true)
		await until(() => host.values.health === 'not responding', 'the health variable')
		fake.freeze(false)
		await until(() => host.status === InstanceStatus.Ok, 'ok again')
		assert.equal(await feedback('not_responding'), false)
	})

	it('stops cleanly: no socket, no timers left running', async () => {
		const { fake, controller, press } = await connect()
		await press('timer', { timer: 'timer-sermon', action: 'play' })
		controller.stop()
		await until(() => fake.connections === 0, 'socket closed')
		const before = fake.requests.length
		await sleep(300)
		assert.equal(fake.requests.length, before)
	})
})

describe('updates', () => {
	it('rechecks only the feedbacks that read what changed', async () => {
		const { fake, host, settle } = await connect()
		host.clear()
		fake.overlays = [{ id: 'overlay-lower', name: 'Lower Third', layer: 'overlays' }]
		fake.push('show')
		await settle()
		assert.deepEqual(host.checks, [['live', 'overlay_live']])
		host.clear()
		fake.push('show')
		await settle()
		assert.deepEqual(host.checks, [], 'a push that changes nothing rechecks nothing')
		assert.deepEqual(host.valueUpdates, [])
	})

	it('sets only the variables whose value changed', async () => {
		const { fake, host, settle } = await connect()
		host.clear()
		fake.slideIndex = 3
		fake.push('show')
		await settle()
		const changed = host.valueUpdates.flat().sort()
		assert.deepEqual(
			changed,
			[
				'next_section_name',
				'next_slide_notes',
				'next_slide_text',
				'slide_name',
				'slide_notes',
				'slide_number',
				'slide_text',
				'slides_left',
			].sort(),
		)
		assert.equal(host.values.slide_number, 4)
	})

	it('rebuilds the lists when the library changes, and not when it does not', async () => {
		const { fake, host, settle } = await connect()
		const before = host.definitions
		fake.library.overlays.push({ id: 'overlay-new', name: 'Verse Reference' })
		fake.push('library')
		await until(() => 'overlay_overlay-new' in host.presets, 'the new overlay preset', 4000)
		assert.equal(host.definitions, before + 1)
		fake.push('library')
		await sleep(700)
		await settle()
		assert.equal(host.definitions, before + 1, 'an unchanged library is not redefined')
	})

	it('counts timers itself, once a second, from the anchors', async () => {
		const { fake, host, press } = await connect()
		await press('timer', { timer: 'timer-countdown', action: 'play' })
		await until(() => host.values.timer_countdown_state === 'running', 'running')
		host.clear()
		const requests = fake.requests.length
		await until(() => host.values.timer_countdown === '4:58', 'two seconds counted', 4000)
		assert.equal(fake.requests.length, requests, 'counting asks Slides for nothing')
		assert.ok(host.checks.some((ids) => ids.includes('timer_value')))
		assert.ok(host.valueUpdates.flat().includes('timer_countdown'))
		assert.equal(host.valueUpdates.flat().includes('deck_name'), false)
	})

	it('fetches a slide picture only when its version changes', async () => {
		const { fake, controller, settle } = await connect({}, { pictures: true })
		await until(() => controller.state.pictures.live !== null, 'the live picture')
		const pictures = (): number => fake.requests.filter((request) => request.path.includes('/thumbnail/')).length
		assert.equal(pictures(), 2)
		fake.overlays = [{ id: 'overlay-bug', name: 'Logo Bug' }]
		fake.push('show')
		await settle()
		assert.equal(pictures(), 2, 'the same slide is not fetched again')
		fake.slideIndex = 5
		fake.push('show')
		await until(() => pictures() === 4, 'new pictures')
		fake.deck = undefined
		fake.push('show')
		await until(() => controller.state.pictures.live === null, 'picture cleared')
	})

	it('leaves pictures and meters alone when they are switched off', async () => {
		const { fake, controller } = await connect({}, { pictures: false, meters: false })
		await sleep(250)
		assert.equal(fake.requests.filter((request) => request.path.includes('/thumbnail/')).length, 0)
		assert.deepEqual(controller.state.meters, {})
	})

	it('follows the meters about ten times a second when they are on', async () => {
		const { host, controller, feedback } = await connect({}, { meters: true })
		await until(() => Object.keys(controller.state.meters).length > 0, 'meters')
		host.clear()
		await sleep(550)
		const meterChecks = host.checks.filter((ids) => ids.includes('mix_meter'))
		assert.ok(
			meterChecks.length >= 3 && meterChecks.length <= 8,
			`rechecked ${meterChecks.length} times in half a second`,
		)
		assert.ok(host.valueUpdates.length <= 3, 'meter variables follow at an easier pace')
		const level = (await feedback('mix_meter', { strip: 'mix-stream', channel: 'left' })) as number
		assert.ok(level <= 0 && level >= -60)
		assert.equal(
			await feedback('input_meter', { strip: 'in-video', channel: 'max' }),
			-60,
			'a muted strip shows nothing',
		)
	})
})

describe('actions on today’s routes', () => {
	it('moves through slides', async () => {
		const { fake, press, host } = await connect({ apiVersion: '1.0' })
		await press('slide_next', { skipBuilds: false })
		assert.deepEqual(fake.lastBody('/v1/show/advance'), { steps: 1, settled: false })
		await press('slide_next', { skipBuilds: true })
		assert.deepEqual(fake.lastBody('/v1/show/advance'), { steps: 1, settled: true })
		await press('slide_previous')
		assert.deepEqual(fake.lastBody('/v1/show/advance'), { steps: -1 })
		await press('slide_goto', { deck: 'live', slide: '7' })
		assert.deepEqual(fake.lastBody('/v1/show/slide'), { serviceItemId: 'item-song-1', occurrence: 6 })
		await press('slide_goto', { deck: 'deck-sermon', slide: 2 })
		assert.deepEqual(fake.lastBody('/v1/show/slide'), { presentationId: 'deck-sermon', slideIndex: 1 })
		assert.equal(host.values.slide_number, 2)
		assert.equal(host.values.deck_name, 'Sermon: Hope')
		await press('slide_goto', { deck: 'live', slide: 'x' })
		assert.match(host.problems().at(-1) ?? '', /not a slide number/)
		await press('slide_goto', { deck: 'live', slide: '99' })
		assert.match(host.problems().at(-1) ?? '', /Slide: Go to slide: Slide index 98 is out of range/)
		await press('service_select', { service: 'service-wednesday' })
		assert.equal(host.values.service_name, 'Wednesday Night')
	})

	it('clears', async () => {
		const { fake, press, feedback } = await connect({ apiVersion: '1.0' })
		assert.equal(await feedback('live', { target: 'slides' }), true)
		await press('clear', { target: 'slides' })
		assert.deepEqual(fake.lastBody('/v1/show/clear'), { function: 'slides' })
		assert.equal(await feedback('live', { target: 'slides' }), false)
		await press('clear_layer', { layer: 'overlays' })
		assert.deepEqual(fake.lastBody('/v1/show/clear'), { layer: 'overlays' })
		await press('clear_all')
		assert.equal(fake.commands().at(-1), 'POST /v1/show/clear-all')
		assert.equal(await feedback('live', { target: 'anything' }), false)
	})

	it('plays media and drives the video that is playing', async () => {
		const { fake, press, feedback, host } = await connect({ apiVersion: '1.0' })
		await press('video_transport', { target: 'any', action: 'toggle', seconds: '0' })
		assert.match(host.problems().at(-1) ?? '', /no video is playing/)
		await press('media_fire', { media: 'media-welcome' })
		assert.equal(fake.commands().at(-1), 'POST /v1/media/media-welcome/fire')
		assert.equal(await feedback('video_playing', { target: 'any' }), true)
		assert.equal(await feedback('live', { target: 'media' }), true)
		assert.equal(host.values.video_name, 'Welcome Loop')
		await press('video_transport', { target: 'any', action: 'pause', seconds: '0' })
		assert.deepEqual(fake.lastBody('/v1/transport/media-welcome'), { action: 'pause' })
		assert.equal(await feedback('video_playing', { target: 'videos' }), false)
		await press('video_transport', { target: 'any', action: 'seek', seconds: '1:30' })
		assert.deepEqual(fake.lastBody('/v1/transport/media-welcome'), { action: 'seek', position: 90 })
		await press('video_transport', { target: 'any', action: 'skip', seconds: '-10' })
		assert.deepEqual(fake.lastBody('/v1/transport/media-welcome'), { action: 'seek', position: 80 })
		await press('video_transport', { target: 'any', action: 'end', seconds: '5' })
		assert.deepEqual(fake.lastBody('/v1/transport/media-welcome'), { action: 'seek', position: 115 })
		assert.equal(await feedback('video_value', { target: 'any', field: 'remaining' }), '-0:05')
		assert.equal(await feedback('video_value', { target: 'any', field: 'name' }), 'Welcome Loop')
		await press('video_transport', { target: 'any', action: 'reset', seconds: '0' })
		assert.deepEqual(fake.lastBody('/v1/transport/media-welcome'), { action: 'reset' })
	})

	it('shows and hides overlays and alerts', async () => {
		const { fake, press, feedback, host } = await connect({ apiVersion: '1.0' })
		await press('overlay', { overlay: 'overlay-lower', mode: 'toggle' })
		assert.equal(fake.commands().at(-1), 'POST /v1/overlays/overlay-lower/fire', 'toggle works on 1.0 from the state')
		assert.equal(await feedback('overlay_live', { overlay: 'overlay-lower' }), true)
		assert.equal(await feedback('overlay_live', { overlay: 'any' }), true)
		assert.equal(await feedback('overlay_live', { overlay: 'overlay-bug' }), false)
		await press('overlay', { overlay: 'overlay-lower', mode: 'toggle' })
		assert.equal(fake.commands().at(-1), 'POST /v1/overlays/overlay-lower/dismiss')
		await press('overlay', { overlay: 'overlay-bug', mode: 'show' })
		await press('overlay', { overlay: 'overlay-bug', mode: 'hide' })
		assert.equal(await feedback('overlay_live', { overlay: 'any' }), false)

		await press('alert_preset', { preset: 'alert-nursery', tokens: 'number=214, room = B' })
		assert.deepEqual(fake.lastBody('/v1/alerts/fire'), {
			presetId: 'alert-nursery',
			tokens: { number: '214', room: 'B' },
		})
		assert.equal(await feedback('alert_showing', { match: 'any', preset: '', text: '' }), true)
		assert.equal(await feedback('alert_showing', { match: 'preset', preset: 'alert-nursery', text: '' }), true)
		assert.equal(await feedback('alert_showing', { match: 'preset', preset: 'alert-wrap', text: '' }), false)
		assert.equal(await feedback('alert_showing', { match: 'text', preset: '', text: '214' }), true)
		assert.equal(host.values.alert_text, 'Nursery 214 B')
		await press('alert_text', { message: 'Wrap it up', target: 'confidence', behavior: 'flash' })
		assert.deepEqual(fake.lastBody('/v1/alerts/fire'), {
			message: 'Wrap it up',
			target: 'confidence',
			behavior: 'flash',
		})
		assert.equal(host.values.alert_target, 'confidence')
		await press('alert_text', { message: '  ', target: 'both', behavior: 'persist' })
		assert.match(host.problems().at(-1) ?? '', /the message is empty/)
		await press('alert_hide')
		assert.equal(await feedback('alert_showing', { match: 'any', preset: '', text: '' }), false)
	})

	it('starts, pauses and resets timers', async () => {
		const { fake, press, feedback, host } = await connect({ apiVersion: '1.0' })
		const state = async (wanted: string): Promise<unknown> =>
			feedback('timer_state', { timer: 'timer-sermon', state: wanted })
		assert.equal(await state('idle'), true)
		await press('timer', { timer: 'timer-sermon', action: 'toggle' })
		assert.equal(fake.commands().at(-1), 'POST /v1/timers/timer-sermon/play', 'toggle works on 1.0 from the state')
		assert.equal(await state('running'), true)
		assert.equal(await feedback('timer_value', { timer: 'timer-sermon', field: 'name' }), 'Sermon')
		await press('timer', { timer: 'timer-sermon', action: 'toggle' })
		assert.equal(fake.commands().at(-1), 'POST /v1/timers/timer-sermon/pause')
		assert.equal(await state('paused'), true)
		assert.equal(await state('running'), false)
		await press('timer', { timer: 'timer-sermon', action: 'reset' })
		assert.equal(await state('idle'), true)
		assert.equal(await feedback('timer_value', { timer: 'timer-sermon', field: 'time' }), '35:00')
		assert.equal(await feedback('timer_value', { timer: 'timer-sermon', field: 'progress' }), 0)
		assert.equal(host.values.timer_sermon_length, 2100)
		assert.equal(await feedback('timer_state', { timer: 'timer-service', state: 'running' }), true)
		assert.match(String(host.values.timer_service), /^12:(4[89]|5\d)$/)
	})

	it('plays music', async () => {
		const { fake, press, feedback, host } = await connect({ apiVersion: '1.0' })
		await press('music_playlist', { playlist: 'playlist-pre' })
		assert.equal(await feedback('music_playing', { playlist: 'any' }), true)
		assert.equal(await feedback('music_playing', { playlist: 'playlist-pre' }), true)
		assert.equal(await feedback('music_playing', { playlist: 'playlist-walkout' }), false)
		assert.equal(await feedback('live', { target: 'audio' }), true)
		assert.equal(host.values.music_playlist, 'Pre-Service')
		assert.equal(host.values.music_track, 'Pre-Service 1')
		await press('music_transport', { action: 'next', position: '0' })
		assert.deepEqual(fake.lastBody('/v1/audio/transport'), { action: 'next' })
		await press('music_transport', { action: 'seek', position: '1:05' })
		assert.deepEqual(fake.lastBody('/v1/audio/transport'), { action: 'seek', position: 65 })
		await press('music_transport', { action: 'playPause', position: '0' })
		assert.equal(await feedback('music_playing', { playlist: 'any' }), false)
		await press('music_item', { item: 'audio-sting' })
		assert.equal(fake.commands().at(-1), 'POST /v1/audio/items/audio-sting/fire')
		await press('music_transport', { action: 'stop', position: '0' })
		assert.equal(fake.commands().at(-1), 'POST /v1/audio/stop')
		assert.equal(await feedback('live', { target: 'audio' }), false)
	})

	it('drives the input strips of the mixer, and reads them back on a Slides that does not push them', async () => {
		const { fake, press, feedback, host } = await connect({ apiVersion: '1.0' })
		assert.equal(await feedback('input_on_air', { strip: 'in-pastor' }), true)
		assert.equal(await feedback('input_on_air', { strip: 'in-lobby' }), false)
		assert.equal(await feedback('input_muted', { strip: 'in-video' }), true)
		assert.equal(await feedback('input_value', { strip: 'in-pastor', field: 'db' }), '-6.0')
		assert.equal(await feedback('input_value', { strip: 'in-video', field: 'state' }), 'muted')
		assert.equal(await feedback('input_value', { strip: 'in-lobby', field: 'state' }), 'off')
		assert.equal(await feedback('input_value', { strip: 'in-pastor', field: 'name' }), 'Pastor')
		await press('input_on_air', { strip: 'in-lobby', mode: 'toggle' })
		assert.deepEqual(fake.lastBody('/v1/inputs/audio/in-lobby/mixer'), { enabled: true })
		assert.equal(await feedback('input_on_air', { strip: 'in-lobby' }), true)
		await press('input_mute', { strip: 'in-video', mode: 'off' })
		assert.equal(await feedback('input_muted', { strip: 'in-video' }), false)
		await press('input_level', { strip: 'in-pastor', db: -12 })
		assert.equal(await feedback('input_value', { strip: 'in-pastor', field: 'db' }), '-12.0')
		await press('input_nudge', { strip: 'in-pastor', step: 2 })
		await press('input_nudge', { strip: 'in-pastor', step: 2 })
		assert.equal(
			await feedback('input_value', { strip: 'in-pastor', field: 'db' }),
			'-8.0',
			'two turns of a dial add up',
		)
		assert.equal(await feedback('input_value', { strip: 'in-pastor', field: 'fader' }), -8)
		assert.equal(host.values.input_pastor_db, '-8.0')
		await press('input_level', { strip: 'in-pastor', db: -60 })
		assert.equal(await feedback('input_value', { strip: 'in-pastor', field: 'db' }), '-inf')
		await press('input_nudge', { strip: 'in-pastor', step: 1 })
		assert.equal(await feedback('input_value', { strip: 'in-pastor', field: 'db' }), '-59.0')
		assert.ok(fake.requests.some((request) => request.method === 'GET' && request.path === '/v1/inputs/audio'))
	})

	it('switches screens and runs combos', async () => {
		const { fake, press, feedback, host } = await connect({ apiVersion: '1.0' })
		assert.equal(await feedback('output_preset_active', { preset: 'look-worship' }), true)
		await press('output_preset', { preset: 'look-sermon' })
		assert.equal(await feedback('output_preset_active', { preset: 'look-sermon' }), true)
		assert.equal(await feedback('output_preset_active', { preset: 'look-worship' }), false)
		assert.equal(host.values.output_preset, 'Sermon')
		await press('output_preset', { preset: 'none' })
		assert.equal(fake.commands().at(-1), 'POST /v1/output-presets/none/activate')
		assert.equal(await feedback('output_preset_active', { preset: 'none' }), true)
		await press('combo_run', { combo: 'combo-live' })
		assert.equal(fake.commands().at(-1), 'POST /v1/action-combos/combo-live/fire')
		await press('combo_run', { combo: 'nope' })
		assert.match(host.problems().at(-1) ?? '', /Action Combo: Run: No action combo 'nope'/)
	})

	it('runs the scheduler, MIDI devices, the Lock and Follow', async () => {
		const { fake, press, feedback, host } = await connect({ apiVersion: '1.0' })
		assert.equal(await feedback('scheduler_on'), true)
		await press('scheduler', { mode: 'toggle' })
		assert.deepEqual(fake.lastBody('/v1/scheduler/enabled'), { enabled: false })
		assert.equal(await feedback('scheduler_on'), false)
		assert.equal(await feedback('trigger_enabled', { trigger: 'trigger-doors' }), false)
		await press('scheduler_trigger', { trigger: 'trigger-doors', action: 'toggle' })
		assert.equal(await feedback('trigger_enabled', { trigger: 'trigger-doors' }), true)
		await press('scheduler_trigger', { trigger: 'trigger-doors', action: 'pause' })
		assert.equal(await feedback('trigger_enabled', { trigger: 'trigger-doors' }), false)
		await press('scheduler_trigger', { trigger: 'trigger-preservice', action: 'run' })
		assert.equal(fake.commands().at(-1), 'POST /v1/scheduler/triggers/trigger-preservice/fire')
		assert.equal(host.values.scheduler_next_name, 'Preservice')

		assert.equal(await feedback('midi_device_on', { device: 'midi-lights' }), true)
		await press('midi_device', { device: 'midi-lights', mode: 'off' })
		await until(() => host.checks.some((ids) => ids.includes('midi_device_on')), 'midi read back')
		assert.equal(await feedback('midi_device_on', { device: 'midi-lights' }), false)

		assert.equal(await feedback('lock_on'), false)
		await press('lock', { action: 'on' })
		assert.deepEqual(fake.lastBody('/v1/show/lock'), { locked: true })
		await until(() => host.values.lock === true, 'lock read back')
		assert.equal(await feedback('lock_on'), true)
		fake.lock = { ...fake.lock, waitingUpdates: 2, waiting: '2 updates from Sarah' }
		await press('lock', { action: 'toggle' })
		await until(() => host.values.updates_waiting === 2, 'updates waiting')
		assert.equal(await feedback('updates_waiting'), true)
		await press('lock', { action: 'pull' })
		assert.deepEqual(fake.lastBody('/v1/show/lock'), { pullUpdates: true })
		await until(() => host.values.updates_waiting === 0, 'updates pulled')

		assert.equal(await feedback('follow_role', { role: 'in_charge' }), true)
		assert.equal(
			await feedback('follow_role', { role: 'took_over' }),
			false,
			'a computer with no backup never took over',
		)
		await press('follow', { action: 'handback' })
		await until(() => host.values.in_charge === false, 'role read back')
		assert.equal(await feedback('follow_role', { role: 'backing_up' }), true)
		await press('follow', { action: 'takeover' })
		await until(() => host.values.in_charge === true, 'in charge again')
		assert.equal(await feedback('follow_role', { role: 'took_over' }), true)
		assert.equal(await feedback('follow_role', { role: 'in_charge' }), true)
		await press('follow', { action: 'takeback' })
		assert.equal(fake.commands().at(-1), 'POST /v1/follow/takeback')
	})
})

describe('actions that need a newer MxU Slides', () => {
	const newer: [action: Parameters<Rig['press']>[0], options: Record<string, string | number | boolean>][] = [
		['section_goto', { by: 'position', position: '1', name: '' }],
		['service_item', { direction: 'next' }],
		['service_start', {}],
		['video_input_fire', { input: 'cam-1' }],
		['timeline', { action: 'play' }],
		['timer_set', { timer: 'timer-sermon', mode: 'countdown', length: '5:00', hour: 9, minute: 0 }],
		['timer_adjust', { timer: 'timer-sermon', direction: 'add', amount: '30' }],
		['mix_mute', { strip: 'mix-stream', mode: 'on' }],
		['mix_level', { strip: 'mix-stream', db: -3 }],
		['mix_nudge', { strip: 'mix-stream', step: 1 }],
		['output_mute', { strip: 'out-main', mode: 'on' }],
		['output_level', { strip: 'out-main', db: -3 }],
		['output_nudge', { strip: 'out-main', step: 1 }],
		['confidence_layout', { screen: 'screen-stage', layout: 'layout-lyrics' }],
		['screens_identify', {}],
		['recording', { mode: 'start', preset: 'default' }],
		['streaming', { mode: 'start', preset: 'default' }],
	]

	it('logs one clear line against a 1.0 Slides and sends nothing', async () => {
		const { fake, press, host } = await connect({ apiVersion: '1.0' })
		for (const [action, options] of newer) {
			host.clear()
			const before = fake.commands().length
			await press(action, options)
			assert.equal(fake.commands().length, before, `${action} sent nothing`)
			assert.equal(host.problems().length, 1, `${action} logged one line`)
			assert.match(host.problems()[0], /needs a newer MxU Slides \(this one has API 1\.0\)/)
		}
	})

	it('goes to sections and service items', async () => {
		const { fake, press, feedback, host } = await connect()
		await press('section_goto', { by: 'name', position: '1', name: 'bridge' })
		assert.deepEqual(fake.lastBody('/v1/show/slide'), { serviceItemId: 'item-song-1', occurrence: 8 })
		assert.equal(await feedback('section_live', { by: 'name', position: '1', name: 'Bridge' }), true)
		assert.equal(await feedback('section_live', { by: 'position', position: '5', name: '' }), true)
		assert.equal(host.values.section_name, 'Bridge')
		assert.equal(host.values.section_color, '#BF5AF2')
		assert.equal(host.values.section_5_name, 'Bridge')
		await press('section_goto', { by: 'position', position: '4', name: '' })
		assert.deepEqual(fake.lastBody('/v1/show/slide'), { serviceItemId: 'item-song-1', occurrence: 6 })
		assert.equal(await feedback('section_live', { by: 'position', position: '4', name: '' }), true)
		assert.equal(
			await feedback('section_live', { by: 'position', position: '2', name: '' }),
			false,
			'the first Chorus is not the live one',
		)
		assert.equal(await feedback('section_value', { position: '2', field: 'name' }), 'Chorus')
		assert.equal(await feedback('section_value', { position: '2', field: 'color' }), 0xff9f0a)
		assert.equal(await feedback('section_value', { position: '9', field: 'name' }), '')
		await press('section_goto', { by: 'name', position: '1', name: 'Tag' })
		assert.match(host.problems().at(-1) ?? '', /no such section/)

		await press('service_item', { direction: 'next' })
		assert.deepEqual(fake.lastBody('/v1/show/advance-item'), { steps: 1 })
		assert.equal(host.values.current_item, 'Announcements')
		await press('service_item', { direction: 'previous' })
		assert.deepEqual(fake.lastBody('/v1/show/advance-item'), { steps: -1 })
		assert.equal(await feedback('service_state', { state: 'preService' }), true)
		await press('service_start')
		assert.equal(await feedback('service_state', { state: 'running' }), true)
		assert.equal(host.values.service_state, 'running')
	})

	it('reads the show for a button', async () => {
		const { feedback } = await connect()
		assert.equal(await feedback('show_value', { field: 'position' }), '3 / 14')
		assert.equal(await feedback('show_value', { field: 'next_position' }), '4 / 14')
		assert.equal(await feedback('show_value', { field: 'section' }), 'Chorus')
		assert.equal(await feedback('show_value', { field: 'section_color' }), 0xff9f0a)
		assert.equal(await feedback('show_value', { field: 'next_section' }), 'Chorus')
		assert.equal(await feedback('show_value', { field: 'deck' }), 'Goodness of God')
		assert.equal(await feedback('show_value', { field: 'notes' }), 'Notes for slide 3')
		assert.equal(await feedback('show_value', { field: 'item' }), 'Goodness of God')
		assert.equal(await feedback('deck_live', { deck: 'deck-goodness' }), true)
		assert.equal(await feedback('slide_number', { slide: '3' }), true)
		assert.equal(await feedback('slide_number', { slide: 4 }), false)
	})

	it('sets and adjusts timers by the rule for before and during a run', async () => {
		const { fake, press, feedback } = await connect()
		const time = async (): Promise<unknown> => feedback('timer_value', { timer: 'timer-countdown', field: 'time' })
		await press('timer_adjust', { timer: 'timer-countdown', direction: 'add', amount: '1:00' })
		assert.deepEqual(fake.lastBody('/v1/timers/timer-countdown/adjust'), { seconds: 60 })
		assert.equal(await time(), '6:00', 'time added before the start becomes the length')
		await press('timer', { timer: 'timer-countdown', action: 'toggle' })
		assert.equal(fake.commands().at(-1), 'POST /v1/timers/timer-countdown/play')
		await press('timer_adjust', { timer: 'timer-countdown', direction: 'subtract', amount: '30' })
		assert.deepEqual(fake.lastBody('/v1/timers/timer-countdown/adjust'), { seconds: -30 })
		assert.match(String(await time()), /^5:(29|30)$/)
		await press('timer', { timer: 'timer-countdown', action: 'reset' })
		assert.equal(await time(), '6:00', 'Reset returns to the length it had before the start')
		await press('timer_set', { timer: 'timer-countdown', mode: 'countdown', length: '9m', hour: 0, minute: 0 })
		assert.deepEqual(fake.lastBody('/v1/timers/timer-countdown/configure'), { mode: 'countdown', durationSeconds: 540 })
		assert.equal(await time(), '9:00')
		await press('timer_set', { timer: 'timer-countdown', mode: 'countdownToTime', length: '', hour: 9, minute: 30 })
		assert.deepEqual(fake.lastBody('/v1/timers/timer-countdown/configure'), {
			mode: 'countdownToTime',
			hour: 9,
			minute: 30,
		})
		assert.equal(await feedback('timer_state', { timer: 'timer-countdown', state: 'running' }), true)
	})

	it('reports an adjustment Slides refuses against that action only', async () => {
		const { press, host } = await connect()
		await press('timer_adjust', { timer: 'timer-service', direction: 'add', amount: '30' })
		assert.match(
			host.problems().at(-1) ?? '',
			/Timer: Add or subtract time: A service-tracking timer cannot be adjusted/,
		)
		await press('timer_adjust', { timer: 'timer-sermon', direction: 'add', amount: 'soon' })
		assert.match(host.problems().at(-1) ?? '', /"soon" is not an amount of time/)
		assert.equal(host.status, InstanceStatus.Ok, 'a failed command does not change the connection status')
	})

	it('drives mixes and outputs, and keeps up from the pushes', async () => {
		const { fake, press, feedback, host } = await connect()
		assert.equal(await feedback('mix_value', { strip: 'mix-stream', field: 'db' }), '-4.0')
		await press('mix_mute', { strip: 'mix-stream', mode: 'toggle' })
		assert.deepEqual(fake.lastBody('/v1/audio/mixes/mix-stream/mixer'), { muted: true })
		assert.equal(await feedback('mix_muted', { strip: 'mix-stream' }), true)
		assert.equal(await feedback('mix_value', { strip: 'mix-stream', field: 'state' }), 'muted')
		await press('mix_nudge', { strip: 'mix-room', step: -2 })
		assert.equal(await feedback('mix_value', { strip: 'mix-room', field: 'db' }), '-14.0')
		await press('output_level', { strip: 'out-stream', db: -10 })
		assert.equal(await feedback('output_value', { strip: 'out-stream', field: 'db' }), '-10.0')
		assert.equal(host.values.output_stream_out_db, '-10.0')
		assert.equal(await feedback('output_muted', { strip: 'all' }), false)
		await press('output_mute', { strip: 'all', mode: 'toggle' })
		assert.equal(
			fake.audioOutputs.every((output) => output.muted),
			true,
		)
		assert.equal(await feedback('output_muted', { strip: 'all' }), true)
		assert.equal(await feedback('output_muted', { strip: 'out-main' }), true)
		await press('output_mute', { strip: 'all', mode: 'toggle' })
		assert.equal(await feedback('output_muted', { strip: 'all' }), false)
		assert.equal(
			fake.requests.some((request) => request.method === 'GET' && request.path === '/v1/audio/mixer'),
			false,
			'the mixer pushes its changes; nothing is read back',
		)
		fake.inputs[0].muted = true
		fake.push('mixer')
		await until(() => host.values.input_pastor_muted === true, 'a change made in the app')
	})

	it('fires video inputs, timelines, layouts and identify', async () => {
		const { fake, press, feedback, host } = await connect()
		await press('video_input_fire', { input: 'cam-2' })
		assert.equal(fake.commands().at(-1), 'POST /v1/inputs/video/cam-2/fire')
		await until(() => host.checks.some((ids) => ids.includes('video_input_live')), 'inputs pushed')
		assert.equal(await feedback('video_input_live', { input: 'cam-2' }), true)
		assert.equal(await feedback('video_input_live', { input: 'cam-1' }), false)
		assert.equal(await feedback('live', { target: 'inputs' }), true)
		await press('clear', { target: 'inputs' })
		assert.equal(await feedback('live', { target: 'inputs' }), false)

		await press('timeline', { action: 'play' })
		assert.deepEqual(fake.lastBody('/v1/timeline'), { action: 'play' })
		assert.equal(await feedback('timeline_playing'), true)
		await press('timeline', { action: 'stop' })
		assert.equal(await feedback('timeline_playing'), false)

		assert.equal(await feedback('confidence_layout', { screen: 'screen-stage', layout: 'built-in' }), true)
		await press('confidence_layout', { screen: 'screen-stage', layout: 'layout-lyrics' })
		assert.deepEqual(fake.lastBody('/v1/confidence/screens/screen-stage/layout'), { layoutId: 'layout-lyrics' })
		assert.equal(await feedback('confidence_layout', { screen: 'screen-stage', layout: 'layout-lyrics' }), true)
		assert.equal(host.values.confidence_stage_layout, 'Lyrics Layout')
		await press('confidence_layout', { screen: 'screen-stage', layout: 'built-in' })
		assert.deepEqual(fake.lastBody('/v1/confidence/screens/screen-stage/layout'), { layoutId: null })
		assert.equal(host.values.confidence_stage_layout, 'Built-in Layout')
		await press('screens_identify')
		assert.equal(fake.commands().at(-1), 'POST /v1/outputs/identify')
	})

	it('records and streams, with the time running', async () => {
		const { fake, press, feedback, host } = await connect()
		assert.equal(await feedback('recording'), false)
		await press('recording', { mode: 'toggle', preset: 'default' })
		assert.equal(fake.commands().at(-1), 'POST /v1/capture/recording/toggle')
		assert.deepEqual(fake.lastBody('/v1/capture/recording/toggle'), {})
		assert.equal(await feedback('recording'), true)
		assert.equal(await feedback('streaming'), false)
		assert.equal(await feedback('capture_value', { side: 'recording' }), '0:00')
		assert.equal(await feedback('capture_value', { side: 'streaming' }), '')
		await until(() => host.values.recording_time === '0:01', 'the recording counting', 3000)
		await press('streaming', { mode: 'start', preset: 'stream-youtube' })
		assert.deepEqual(fake.lastBody('/v1/capture/streaming/start'), { presetId: 'stream-youtube' })
		assert.equal(host.values.streaming, true)
		await press('recording', { mode: 'stop', preset: 'stream-youtube' })
		assert.deepEqual(fake.lastBody('/v1/capture/recording/stop'), {}, 'stop names no preset')
		assert.equal(host.values.recording, false)
		assert.equal(host.values.recording_time, '')
	})

	it('toggles overlays through the state on any Slides', async () => {
		const { fake, press } = await connect()
		await press('overlay', { overlay: 'overlay-lower', mode: 'toggle' })
		assert.equal(fake.commands().at(-1), 'POST /v1/overlays/overlay-lower/fire')
	})
})

describe('what is defined', () => {
	it('defines every action, feedback and both composite elements', async () => {
		const { host } = await connect()
		assert.equal(Object.keys(host.actions ?? {}).length, 45)
		assert.equal(Object.keys(host.feedbacks ?? {}).length, 39)
		assert.deepEqual(host.composites, ['channel_strip', 'stereo_meter'])
		for (const [id, definition] of Object.entries({ ...host.actions, ...host.feedbacks })) {
			assert.ok(definition && definition.name.length > 0, `${id} has a name`)
		}
	})

	it('fills dropdowns from the library, and says so when a list is empty', async () => {
		const { host } = await connect()
		const choices = (action: string, option: string): { id: string; label: string }[] => {
			const definition = host.actions?.[action as keyof typeof host.actions] as {
				options: { id: string; choices?: { id: string; label: string }[] }[]
			}
			return definition.options.find((field) => field.id === option)?.choices ?? []
		}
		assert.deepEqual(
			choices('combo_run', 'combo').map((choice) => choice.label),
			['Preservice', 'Go Live', 'House Lights'],
		)
		assert.deepEqual(choices('media_fire', 'media')[0], { id: 'media-welcome', label: 'Loops / Welcome Loop' })
		assert.deepEqual(
			choices('timer', 'timer').map((choice) => choice.id),
			['timer-service', 'timer-sermon', 'timer-countdown'],
		)
		assert.equal(choices('slide_goto', 'deck')[0].id, 'live')
		assert.deepEqual(choices('music_item', 'item'), [{ id: 'audio-sting', label: 'Sting' }])

		const empty = new TestHost()
		const controller = new SlidesController(empty, TIMING)
		controller.start({}, {})
		const definition = empty.actions?.combo_run as { options: { choices?: { id: string; label: string }[] }[] }
		assert.deepEqual(definition.options[0].choices, [{ id: '', label: '(none in MxU Slides yet)' }])
		controller.stop()
	})

	it('defines a variable for every value it sets', async () => {
		const { host } = await connect()
		const defined = new Set(Object.keys(host.variableDefinitions))
		for (const id of Object.keys(host.values)) assert.ok(defined.has(id), `${id} is defined`)
		assert.ok(defined.has('timer_sermon_seconds'))
		assert.ok(defined.has('input_pastor_meter'))
		assert.ok(defined.has('output_stream_out_db'))
	})
})
