import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	bonjourDevice?: string
	host?: string
	port?: number
	meters?: boolean
	pictures?: boolean
}

export type ModuleSecrets = {
	apiKey?: string
}

export const DEFAULT_PORT = 6980

/** Where to connect: the MxU Slides picked from the network, else the address typed in. */
export function target(config: ModuleConfig): { host: string; port: number } | undefined {
	const found = config.bonjourDevice?.trim()
	if (found) {
		const split = found.lastIndexOf(':')
		const port = Number.parseInt(found.slice(split + 1), 10)
		if (split > 0 && port > 0) return { host: found.slice(0, split).replace(/^\[|\]$/g, ''), port }
	}
	const host = config.host?.trim()
	if (!host) return undefined
	return { host, port: config.port && config.port > 0 ? config.port : DEFAULT_PORT }
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Before you connect',
			width: 12,
			value:
				'In MxU Slides, open Settings › Network & API and turn on Serve the API. Connect at shows the address and port to use here, and Default key the key. The help for this connection has pictures of each step.',
		},
		{
			type: 'bonjour-device',
			id: 'bonjourDevice',
			label: 'MxU Slides on the network',
			width: 12,
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Address',
			description: 'The IP address or name of the computer running MxU Slides. Use 127.0.0.1 when it is this computer.',
			width: 8,
			default: '127.0.0.1',
			regex: Regex.HOSTNAME,
			isVisibleExpression: '!$(options:bonjourDevice)',
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			width: 4,
			min: 1,
			max: 65535,
			default: DEFAULT_PORT,
			isVisibleExpression: '!$(options:bonjourDevice)',
		},
		{
			type: 'secret-text',
			id: 'apiKey',
			label: 'API key',
			description:
				'From Settings › Network & API in MxU Slides. An Operate key can press buttons; a Watch key can only show state.',
			width: 12,
		},
		{
			type: 'checkbox',
			id: 'meters',
			label: 'Live audio meters',
			description: 'Level meters on mixer buttons, about ten times a second. Needs MxU Slides with API 1.1 or newer.',
			width: 6,
			default: true,
		},
		{
			type: 'checkbox',
			id: 'pictures',
			label: 'Slide pictures',
			description:
				'Pictures of the live and the next slide on the Current and Next buttons. Needs MxU Slides with API 1.1 or newer.',
			width: 6,
			default: true,
		},
	]
}
