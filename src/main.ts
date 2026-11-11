import { InstanceBase, type SomeCompanionConfigField } from '@companion-module/base'
import type { ActionsSchema } from './actions.js'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { SlidesController } from './controller.js'
import type { CompositeElementsSchema } from './elements.js'
import type { FeedbacksSchema } from './feedbacks.js'
import { UpgradeScripts } from './upgrades.js'
import type { VariablesSchema } from './variables.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
	compositeElements: CompositeElementsSchema
}

export { UpgradeScripts }

/**
 * The connection to one MxU Slides. Companion's side of things lives here; everything the
 * module does is in the controller.
 */
export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	readonly #controller = new SlidesController(this)

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.#controller.start(config, secrets)
	}

	async destroy(): Promise<void> {
		this.#controller.stop()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.#controller.restart(config, secrets)
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}
}
