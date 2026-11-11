import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig, ModuleSecrets } from './config.js'

/**
 * Upgrade scripts run in order when a saved connection or button was made by an older version
 * of this module. A script that has shipped is never removed or reordered.
 *
 * 1.0.0 is the first version, so there is nothing to upgrade from yet.
 */
export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>[] = []
