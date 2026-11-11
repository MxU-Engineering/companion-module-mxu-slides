import { parseArgs } from 'node:util'
import { FakeSlides } from './fake-slides.js'

/**
 * Runs the fake MxU Slides by itself, so a real Companion can connect to it:
 *
 *     node dist/__tests__/fake-slides-cli.js --port 6991 --api 1.1 --key mxu_fake_key --demo
 *
 * `--demo` sets up a service in full swing (timers in every state, a video playing, a
 * recording running, a muted strip) so every preset has something to show.
 */

const { values } = parseArgs({
	options: {
		port: { type: 'string', default: '6991' },
		api: { type: 'string', default: '1.1' },
		key: { type: 'string', default: 'mxu_fake_key' },
		scope: { type: 'string', default: 'control' },
		demo: { type: 'boolean', default: false },
	},
})

const fake = new FakeSlides({
	port: Number(values.port),
	apiVersion: values.api === '1.0' ? '1.0' : '1.1',
	key: values.key,
	scope: values.scope === 'view' ? 'view' : 'control',
})

if (values.demo) {
	const ago = (seconds: number): string => new Date(Date.now() - seconds * 1000).toISOString()
	const [service, sermon, countdown] = fake.timers
	Object.assign(sermon, {
		running: true,
		started: true,
		runningSince: ago(2100 - 165),
		warnings: [
			{ remainingSeconds: 180, colorHex: '#FFB826FF' },
			{ remainingSeconds: 0, colorHex: '#FF4739FF' },
		],
	})
	fake.timers = [
		service,
		sermon,
		{
			...sermon,
			id: 'timer-offering',
			name: 'Offering',
			durationSeconds: 120,
			runningSince: ago(162),
			warnings: undefined,
		},
		countdown,
	]
	fake.lengths.set('timer-offering', 120)
	fake.mediaLayers = { loopingVideos: { mediaId: 'media-welcome', mediaName: 'Welcome Loop', loops: true } }
	fake.transport = [
		{
			mediaId: 'media-welcome',
			name: 'Welcome Loop',
			layer: 'loopingVideos',
			playing: true,
			looping: false,
			position: 46,
			duration: 430,
		},
	]
	fake.overlays = [{ id: 'overlay-lower', name: 'Lower Third', layer: 'overlays' }]
	fake.alert = { id: 'alert-wrap', message: 'Wrap Up', behavior: 'persist', target: 'confidence', layer: 'alerts' }
	fake.capture = {
		recording: { active: true, startedAt: ago(2530), presetId: 'stream-youtube', presetName: 'YouTube 1080p' },
		streaming: { active: false },
	}
	fake.confidenceLayout = 'layout-lyrics'
}

const port = await fake.start()
console.log(`Fake MxU Slides (API ${fake.options.apiVersion}) on http://127.0.0.1:${port}  key: ${fake.options.key}`)

// Stopping the server leaves nothing running, so the process ends by itself.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => void fake.stop())
}
