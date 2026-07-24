import type { GridConn } from '../router.js';

/** Per-connector rendering directives, returned by the consumer's
 * `connStyle(conn)` callback (called reactively on every render). */
export interface ConnStyle {
	/** stroke color (default #8b94a1) */
	color?: string;
	/** dashed stroke (e.g. "pending" semantics) */
	dashed?: boolean;
	/** which end carries the arrowhead: 'end' = at target (default),
	 * 'start' = back at the source (reversed buses), 'none' */
	arrowAt?: 'start' | 'end' | 'none';
	/** extra class(es) on the path — hook for consumer-driven highlight/dim
	 * (target them with :global() from the consumer component) */
	class?: string;
}

export interface RoutedInfo {
	conns: GridConn[];
	violations: number;
	/** routing time in ms */
	ms: number;
}
