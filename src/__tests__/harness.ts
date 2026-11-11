import type {
	CompanionActionDefinitions,
	CompanionFeedbackDefinitions,
	CompanionPresetDefinitions,
	CompanionPresetSection,
	CompanionVariableDefinitions,
	InstanceStatus,
	JsonValue,
	LogLevel,
} from '@companion-module/base'
import type { ActionsSchema } from '../actions.js'
import { SlidesController, type ModuleHost } from '../controller.js'
import type { FeedbackId, FeedbacksSchema } from '../feedbacks.js'
import type { ModuleSchema } from '../main.js'
import type { VariablesSchema } from '../variables.js'
import { FakeSlides, type FakeOptions } from './fake-slides.js'

/** Fast waits, so a reconnect or a timeout takes milliseconds in a test. */
export const TIMING = {
	requestTimeout: 400,
	pingInterval: 40,
	pongTimeout: 3000,
	reconnectFirst: 30,
	reconnectMax: 120,
}

/** Stands in for Companion: records everything the controller tells it. */
export class TestHost implements ModuleHost {
	logs: { level: LogLevel; message: string }[] = []
	statuses: { status: InstanceStatus; message: string }[] = []
	actions: CompanionActionDefinitions<ActionsSchema> | undefined
	feedbacks: CompanionFeedbackDefinitions<FeedbacksSchema> | undefined
	variableDefinitions: CompanionVariableDefinitions<VariablesSchema> = {}
	sections: CompanionPresetSection<ModuleSchema>[] = []
	presets: CompanionPresetDefinitions<ModuleSchema> = {}
	/** Every variable's latest value. */
	values: Record<string, unknown> = {}
	/** Each `setVariableValues` call, as the ids it carried. */
	valueUpdates: string[][] = []
	/** Each `checkFeedbacks` call, as the ids it named. */
	checks: FeedbackId[][] = []
	checkAlls = 0
	definitions = 0
	composites: string[] = []

	log(level: LogLevel, message: string): void {
		this.logs.push({ level, message })
	}

	updateStatus(status: InstanceStatus, message?: string | null): void {
		this.statuses.push({ status, message: message ?? '' })
	}

	setActionDefinitions(actions: CompanionActionDefinitions<ActionsSchema>): void {
		this.actions = actions
		this.definitions++
	}

	setFeedbackDefinitions(feedbacks: CompanionFeedbackDefinitions<FeedbacksSchema>): void {
		this.feedbacks = feedbacks
	}

	setCompositeElementDefinitions(elements: object): void {
		this.composites = Object.keys(elements)
	}

	setVariableDefinitions(variables: CompanionVariableDefinitions<VariablesSchema>): void {
		this.variableDefinitions = variables
	}

	setPresetDefinitions(
		sections: CompanionPresetSection<ModuleSchema>[],
		presets: CompanionPresetDefinitions<ModuleSchema>,
	): void {
		this.sections = sections
		this.presets = presets
	}

	setVariableValues(values: Partial<VariablesSchema>): void {
		Object.assign(this.values, values)
		this.valueUpdates.push(Object.keys(values))
	}

	checkFeedbacks(first: FeedbackId, ...rest: FeedbackId[]): void {
		this.checks.push([first, ...rest])
	}

	checkAllFeedbacks(): void {
		this.checkAlls++
	}

	get status(): InstanceStatus | undefined {
		return this.statuses.at(-1)?.status
	}

	/** The log lines at warn or error, which is where an action that could not run reports. */
	problems(): string[] {
		return this.logs.filter((line) => line.level === 'warn' || line.level === 'error').map((line) => line.message)
	}

	/** Forgets what was recorded so far, so a test can look at one step alone. */
	clear(): void {
		this.logs = []
		this.checks = []
		this.valueUpdates = []
	}
}

export interface Rig {
	fake: FakeSlides
	host: TestHost
	controller: SlidesController
	/** Runs an action the way a button press would. */
	press: (actionId: keyof ActionsSchema, options?: Record<string, JsonValue>) => Promise<void>
	/** Evaluates a feedback the way Companion would. */
	feedback: (feedbackId: FeedbackId, options?: Record<string, JsonValue>) => Promise<unknown>
	/** Waits until the controller has caught up with everything the fake pushed. */
	settle: () => Promise<void>
	close: () => Promise<void>
}

export async function until(condition: () => boolean, what = 'condition', ms = 3000): Promise<void> {
	const deadline = Date.now() + ms
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
}

export async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms))
}

interface Callable {
	callback: (event: object, context: object) => unknown
}

/** A fake MxU Slides with a controller connected to it and ready. */
export async function rig(
	options: FakeOptions = {},
	config: { meters?: boolean; pictures?: boolean } = {},
): Promise<Rig> {
	const fake = new FakeSlides(options)
	const port = await fake.start()
	const host = new TestHost()
	const controller = new SlidesController(host, TIMING)
	controller.start({ host: '127.0.0.1', port, meters: false, ...config }, { apiKey: fake.options.key })
	const settle = async (): Promise<void> => {
		// Longer than the controller's own gathering of a burst, and its rebuild of the lists.
		await sleep(220)
	}
	await until(() => controller.state.info !== undefined && controller.state.show !== undefined, 'the first state')
	await until(() => controller.state.library.presentations.length > 0, 'the library')
	await settle()

	const context = { type: 'action', signal: new AbortController().signal, setCustomVariableValue: () => undefined }
	return {
		fake,
		host,
		controller,
		settle,
		press: async (actionId, options = {}) => {
			const definition = host.actions?.[actionId] as Callable | undefined
			if (!definition) throw new Error(`No action ${actionId}`)
			await definition.callback({ id: 'a', controlId: 'c', actionId, options, surfaceId: undefined }, context)
			await sleep(40)
		},
		feedback: async (feedbackId, options = {}) => {
			const definition = host.feedbacks?.[feedbackId] as Callable | undefined
			if (!definition) throw new Error(`No feedback ${feedbackId}`)
			return definition.callback(
				{ id: 'f', controlId: 'c', feedbackId, options, previousOptions: null, type: 'boolean' },
				{ ...context, type: 'feedback' },
			)
		},
		close: async () => {
			controller.stop()
			await fake.stop()
		},
	}
}
