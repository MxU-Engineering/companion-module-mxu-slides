/**
 * The shapes MxU Slides sends over its Local API (`/openapi.json` on a running app is the
 * authority). Fields marked "1.1" only arrive from a Slides that reports `apiVersion` 1.1 or
 * newer, so every one of them is optional here.
 */

export interface ServerInfo {
	name: string
	product: string
	apiVersion: string
	schemaVersion?: number
	stationName?: string
}

export interface ApiErrorBody {
	status?: number
	code?: string
	message?: string
}

export interface FireSource {
	kind: string
	name?: string
}

export interface LiveSlide {
	presentationId: string
	presentationName?: string
	slideId: string
	/** Position in the live run, counted from 0. */
	slideIndex?: number
	slideName?: string
	serviceItemId?: string
	occurrence?: number
	stepIndex?: number
	stepCount?: number
	text?: string
	slideCount?: number
	firedBy?: FireSource
	firedAt?: string
	/** 1.1 */
	sectionId?: string
	sectionName?: string
	sectionColorHex?: string
	notes?: string
	thumbnailVersion?: string
}

export interface NextSlide {
	text?: string
	presentationId?: string
	slideId?: string
	slideIndex?: number
	/** 1.1 */
	sectionName?: string
	sectionColorHex?: string
	notes?: string
	thumbnailVersion?: string
}

/** 1.1: one section of the live presentation, in run order. */
export interface ShowSection {
	id: string
	name: string
	colorHex?: string
	firstSlideIndex: number
	slideCount: number
}

export interface ShowOverlay {
	id: string
	name: string
	layer?: string
}

export interface ShowAlert {
	id: string
	message: string
	behavior: string
	target: string
	layer?: string
}

export interface LayerContent {
	mediaId: string
	mediaName?: string
	loops?: boolean
}

export interface ConfidenceScreen {
	id: string
	name: string
	/** Absent = the Built-in Layout. */
	layoutId?: string
}

export interface ShowPosition {
	currentItemName?: string
	nextItemName?: string
	/** 1.1 */
	currentItemId?: string
	nextItemId?: string
	currentItemIndex?: number
	itemCount?: number
}

export interface ShowStatus {
	liveSlide?: LiveSlide
	nextSlideText?: string
	mediaLayers: Record<string, LayerContent>
	overlays: ShowOverlay[]
	alert?: ShowAlert
	currentServiceId?: string
	service?: { id: string; name: string }
	nextSlide?: NextSlide
	position?: ShowPosition
	confidence?: { screens: ConfidenceScreen[] }
	/** 1.1 */
	sections?: ShowSection[]
}

export type TimerMode = 'countdown' | 'countdownToTime' | 'countUp'

export interface TimerWarning {
	remainingSeconds: number
	colorHex: string
}

export interface TimerStatus {
	id: string
	name: string
	mode: TimerMode
	running: boolean
	displaySeconds: number
	overrun: boolean
	folderId?: string
	folderName?: string
	runningSince?: string
	bankedSeconds?: number
	durationSeconds?: number
	targetTime?: string
	armedAt?: string
	warnings?: TimerWarning[]
	/** 1.1: true from Start until Reset. */
	started?: boolean
}

export interface AudioBus {
	playlistId?: string
	audioItemId?: string
	trackName?: string
	playing: boolean
	position?: number
	duration?: number
	entryId?: string
}

export interface AudioStatus {
	buses: AudioBus[]
}

export interface TransportRow {
	mediaId: string
	name: string
	layer: string
	playing: boolean
	looping: boolean
	position: number
	duration: number
}

export interface OutputScreen {
	id: string
	name: string
	role: string
	backed: boolean
}

export interface OutputPreset {
	id: string
	name: string
	active: boolean
}

export interface OutputsStatus {
	screens: OutputScreen[]
	presets: OutputPreset[]
}

export interface SchedulerTrigger {
	id: string
	name: string
	enabled: boolean
	folderEnabled: boolean
	folderName?: string
	nextFire?: string
	lastFired?: string
	archived?: boolean
}

export interface SchedulerStatus {
	enabled: boolean
	nextFire?: { triggerId: string; name: string; at: string }
	triggers: SchedulerTrigger[]
}

export interface TimecodeAnchor {
	seconds: number
	anchoredAt: string
	running: boolean
	reverse: boolean
}

export interface TimecodeTimeline {
	serviceItemId: string
	position: number
	anchoredAt: string
	running: boolean
	length: number
}

export interface TimecodeStatus {
	hasInput: boolean
	source: string
	follows: boolean
	state: string
	label?: string
	rate?: string
	reverse: boolean
	offsetFrames: number
	serviceItemId?: string
	anchor?: TimecodeAnchor
	timeline?: TimecodeTimeline
}

export interface LockStatus {
	locked: boolean
	automatic: boolean
	waitingUpdates: number
	waiting?: string
}

export interface FollowStatus {
	/** `none`, `backingUp`, `inCharge` or `steppedDown`. */
	role: string
	name?: string
	health?: string
}

export interface MidiDeviceStatus {
	id: string
	name: string
	enabled: boolean
	direction: string
	connected: boolean
}

export interface VideoInputStatus {
	id: string
	name: string
	kind?: string
	/** 1.1 */
	live?: boolean
}

export interface AudioInputStatus {
	id: string
	name: string
	/** Switched on and heard through the mixer right now. */
	live: boolean
	/** The operator's own on-air switch. */
	enabled: boolean
	/** Fader position, 0 to 1 (1 = unity). */
	gain: number
	muted: boolean
	mixId?: string
	/** 1.1 */
	gainDb?: number
	pan?: number
}

export interface AudioMixStatus {
	id: string
	name: string
	gain: number
	muted: boolean
	outputIds?: string[]
	/** 1.1 */
	gainDb?: number
}

/** 1.1 */
export interface AudioOutputStatus {
	id: string
	name: string
	deviceUid?: string
	gain: number
	muted: boolean
	gainDb?: number
}

/** 1.1 */
export interface MixerStatus {
	inputs: AudioInputStatus[]
	mixes: AudioMixStatus[]
	outputs: AudioOutputStatus[]
}

export interface MeterLevels {
	/** dBFS, one entry per channel, floor -90. */
	peak: number[]
	rms: number[]
}

/** 1.1 */
export interface MetersFrame {
	inputs?: Record<string, MeterLevels>
	mixes?: Record<string, MeterLevels>
	outputs?: Record<string, MeterLevels>
}

export interface CaptureSide {
	active: boolean
	startedAt?: string
	presetId?: string
	presetName?: string
}

/** 1.1 */
export interface CaptureStatus {
	recording: CaptureSide
	streaming: CaptureSide
}

/** 1.1 */
export interface ServiceTrackingStatus {
	/** `idle`, `preService`, `running` or `ended`. */
	state: string
	plannedStart?: string
	startedAt?: string
}

export interface LibraryEntry {
	id: string
	name: string
	kind?: string
	folder?: string
}

/** 1.1 */
export interface ActionComboEntry {
	id: string
	name: string
	colorHex?: string
	iconName?: string
	folderName?: string
}

export interface FireEvent {
	seq: number
	kind: string
	id?: string
	locked?: boolean
}

/** The library sections the module lists in dropdowns and presets. */
export const LIBRARY_KINDS = [
	'presentations',
	'services',
	'media',
	'audio',
	'playlists',
	'overlays',
	'alert-presets',
	'stream-presets',
	'action-combos',
	'confidence-layouts',
] as const
export type LibraryKind = (typeof LIBRARY_KINDS)[number]

export type MixerKind = 'input' | 'mix' | 'output'
