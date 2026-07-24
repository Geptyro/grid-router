import { BOX_INFLATE } from './router.js';

/**
 * Corridor supply rules — the layout side of the routing contract.
 *
 * The router can only use free cells; the LAYOUT decides how many exist. These
 * formulas are the empirically-validated minimums (violations = 0 across cell
 * sizes 6–12 on real diagrams):
 *
 * - rowGap: a gap between node rows must hold several free horizontal lanes
 *   after box inflation eats its borders;
 * - chipGap: a gap between nodes in a row must fit at least one ALIGNED free
 *   cell column (2·res + 2·inflate), or a dense row walls the grid off;
 * - sidePad: canvas side padding keeps the outer columns routable so paths
 *   can go AROUND a row instead of only through it.
 */
export interface CorridorGaps {
	rowGap: number;
	chipGap: number;
	sidePad: number;
}

export function corridorGaps(res: number, inflate: number = BOX_INFLATE): CorridorGaps {
	return {
		rowGap: Math.max(34, 4.5 * res),
		chipGap: Math.max(12, 2 * res + 2 * inflate),
		sidePad: 1.5 * res
	};
}
