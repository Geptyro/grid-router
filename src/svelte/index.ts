export { default as GridDiagram } from './GridDiagram.svelte';
export type { ConnStyle, RoutedInfo } from './types.js';
export {
	routeGrid,
	corridorGaps,
	withLayers,
	portsLayer,
	keepOutLayer,
	corridorLayer,
	BOX_INFLATE,
	type Rect,
	type RouterLayer,
	type GridBox,
	type GridEdge,
	type GridConn,
	type GridOpts,
	type GridResult,
	type GridDebugCell,
	type BoxSide,
	type CorridorGaps
} from '../index.js';
