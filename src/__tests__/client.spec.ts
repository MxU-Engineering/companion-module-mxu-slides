/* eslint-disable @typescript-eslint/no-floating-promises -- the node:test runner awaits describe() and it() itself */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { SlidesClient, SlidesError, type ClientStatus } from '../api/client.js'
import { FakeSlides, type FakeOptions } from './fake-slides.js'
import { sleep, TIMING, until } from './harness.js'

interface Session {
	fake: FakeSlides
	client: SlidesClient
	statuses: ClientStatus['kind'][]
	events: { topic: string; data: unknown }[]
	ready: { snapshots: boolean }[]
	responding: boolean[]
}

let open: Session | undefined

async function session(
	options: FakeOptions = {},
	overrides: { apiKey?: string; port?: number; topics?: string[]; timing?: typeof TIMING } = {},
): Promise<Session> {
	const fake = new FakeSlides(options)
	const port = await fake.start()
	const made: Session = { fake, statuses: [], events: [], ready: [], responding: [], client: undefined as never }
	made.client = new SlidesClient({
		host: '127.0.0.1',
		port: overrides.port ?? port,
		apiKey: overrides.apiKey ?? fake.options.key,
		topics: overrides.topics ?? ['show', 'timers', 'mixer'],
		onStatus: (status) => made.statuses.push(status.kind),
		onEvent: (topic, data) => made.events.push({ topic, data }),
		onReady: (_info, snapshots) => made.ready.push({ snapshots }),
		onResponding: (responding) => made.responding.push(responding),
		debug: () => undefined,
		timing: overrides.timing ?? TIMING,
	})
	open = made
	made.client.start()
	return made
}

afterEach(async () => {
	open?.client.stop()
	await open?.fake.stop()
	open = undefined
})

describe('connecting', () => {
	it('opens one socket, subscribes, and is told the state at once by a 1.1 Slides', async () => {
		const { client, fake, statuses, events, ready } = await session()
		await until(() => ready.length === 1 && events.length >= 3, 'ready')
		assert.deepEqual(statuses, ['connecting', 'connected'])
		assert.deepEqual(ready, [{ snapshots: true }])
		assert.equal(client.connected, true)
		assert.equal(client.info?.apiVersion, '1.1')
		assert.equal(client.supports('1.1'), true)
		assert.equal(fake.connections, 1)
		assert.deepEqual(events.map((event) => event.topic).sort(), ['mixer', 'show', 'timers'])
		assert.deepEqual(fake.requests, [], 'state came with the subscription, not from reads')
	})

	it('gets no state on subscribe from a 1.0 Slides, and says so', async () => {
		const { client, events, ready } = await session({ apiVersion: '1.0' })
		await until(() => ready.length === 1, 'ready')
		await sleep(60)
		assert.deepEqual(ready, [{ snapshots: false }])
		assert.equal(client.supports('1.1'), false)
		assert.deepEqual(events, [])
	})

	it('reports a key Slides does not accept', async () => {
		const { statuses, client } = await session({}, { apiKey: 'mxu_wrong' })
		await until(() => statuses.includes('unauthorized'), 'unauthorized')
		assert.equal(client.connected, false)
	})

	it('reports an address where nothing answers, and keeps trying with growing waits', async () => {
		const { statuses, fake } = await session()
		await until(() => statuses.includes('connected'), 'connected')
		await fake.stop()
		await until(() => statuses.filter((kind) => kind === 'unreachable').length >= 3, 'retries', 4000)
		assert.equal(statuses.includes('disconnected'), true)
	})

	it('refuses to talk to something that is not MxU Slides', async () => {
		const { statuses } = await session({ product: 'Something Else' })
		await until(() => statuses.includes('wrong-product'), 'wrong product')
	})

	it('comes back by itself when Slides returns', async () => {
		const { fake, ready, statuses } = await session()
		await until(() => ready.length === 1, 'ready')
		fake.dropConnections()
		await until(() => statuses.includes('disconnected'), 'disconnected')
		await until(() => ready.length === 2, 'ready again')
		assert.equal(fake.connections, 1)
	})

	it('closes everything on stop and does not come back', async () => {
		const { client, fake, ready, statuses } = await session()
		await until(() => ready.length === 1, 'ready')
		client.stop()
		await until(() => fake.connections === 0, 'socket closed')
		const seen = statuses.length
		await sleep(200)
		assert.equal(statuses.length, seen)
		assert.equal(client.connected, false)
		await assert.rejects(client.command('GET', '/v1/status'), /Not connected/)
	})
})

describe('commands', () => {
	it('runs a command over the socket and returns the answer', async () => {
		const { client, fake, ready } = await session()
		await until(() => ready.length === 1, 'ready')
		await client.post('/v1/show/advance', { steps: 1 })
		assert.deepEqual(fake.commands(), ['POST /v1/show/advance'])
		assert.deepEqual(fake.lastBody('/v1/show/advance'), { steps: 1 })
		const timers = await client.get<{ id: string }[]>('/v1/timers')
		assert.equal(timers.length, 3)
	})

	it('turns an error answer into an error with the message Slides wrote', async () => {
		const { client, ready } = await session()
		await until(() => ready.length === 1, 'ready')
		await assert.rejects(client.post('/v1/timers/none/play'), (error: unknown) => {
			assert.ok(error instanceof SlidesError)
			assert.equal(error.status, 404)
			assert.equal(error.code, 'not_found')
			assert.match(error.message, /No timer 'none'/)
			return true
		})
	})

	it('answers 403 through a key that can only view', async () => {
		const { client, ready } = await session({ scope: 'view' })
		await until(() => ready.length === 1, 'ready')
		await assert.rejects(
			client.post('/v1/show/clear-all'),
			(error: unknown) => error instanceof SlidesError && error.status === 403,
		)
	})

	it('gives up on a command that gets no answer', async () => {
		const { client, fake, ready } = await session()
		await until(() => ready.length === 1, 'ready')
		fake.silence(true)
		await assert.rejects(client.command('GET', '/v1/status'), /did not answer in time/)
	})

	it('fails the commands still waiting when the socket drops', async () => {
		const { client, fake, ready } = await session()
		await until(() => ready.length === 1, 'ready')
		fake.silence(true)
		const waiting = client.command('GET', '/v1/status')
		fake.dropConnections()
		await assert.rejects(waiting, /Connection closed/)
	})

	it('fetches a slide picture over plain HTTP as a data URL, and null when there is none', async () => {
		const { client, fake, ready } = await session()
		await until(() => ready.length === 1, 'ready')
		const picture = await client.fetchImage('/v1/show/thumbnail/live?width=96')
		assert.match(picture ?? '', /^data:image\/png;base64,iVBOR/)
		fake.deck = undefined
		assert.equal(await client.fetchImage('/v1/show/thumbnail/live'), null)
	})
})

describe('health', () => {
	it('drops a connection that stops answering pings, and connects again', async () => {
		const { fake, ready, statuses } = await session({}, { timing: { ...TIMING, pongTimeout: 150 } })
		await until(() => ready.length === 1, 'ready')
		fake.silence(true)
		await until(() => statuses.includes('disconnected'), 'the dead connection noticed')
		fake.silence(false)
		await until(() => ready.length === 2, 'ready again')
	})

	it('notices a Slides that answers but has stopped moving, and when it moves again', async () => {
		const { fake, ready, responding } = await session()
		await until(() => ready.length === 1, 'ready')
		fake.freeze(true)
		await until(() => responding.at(-1) === false, 'frozen')
		fake.freeze(false)
		await until(() => responding.at(-1) === true, 'moving again')
		assert.deepEqual(responding, [false, true])
	})
})
