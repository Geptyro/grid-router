import type { BoxSide, GridOpts } from './router.js';

/**
 * Layers: pre-built, composable producers of declarative routing facts.
 *
 * The router core stays agnostic — it only understands two substrates:
 * per-cell cost bias (`costRegions`) and per-node port constraints
 * (`nodeSides`). A layer is a small factory that expresses a CONSUMER concept
 * (keep-out zone, preferred corridor, schematic pins…) in those substrates;
 * `withLayers` merges any number of them into the opts.
 *
 *     const opts = withLayers(
 *       { res: 12 },
 *       portsLayer({ r1: ['left', 'right'] }),
 *       maintenance && keepOutLayer([zoneRect])
 *     );
 */

export interface Rect {
	l: number;
	t: number;
	r: number;
	b: number;
}

export interface RouterLayer {
	costRegions?: NonNullable<GridOpts['costRegions']>;
	nodeSides?: Record<string, BoxSide[]>;
}

/** Merge layers into base opts. Falsy entries are skipped, so layers can be
 * toggled inline: `withLayers(base, zoneOn && keepOutLayer([zone]))`. */
export function withLayers(
	base: GridOpts,
	...layers: (RouterLayer | false | null | undefined)[]
): GridOpts {
	const costRegions = [...(base.costRegions ?? [])];
	const nodeSides: Record<string, BoxSide[]> = { ...(base.nodeSides ?? {}) };
	for (const l of layers) {
		if (!l) continue;
		if (l.costRegions) costRegions.push(...l.costRegions);
		if (l.nodeSides) Object.assign(nodeSides, l.nodeSides);
	}
	const out: GridOpts = { ...base };
	if (costRegions.length) out.costRegions = costRegions;
	if (Object.keys(nodeSides).length) out.nodeSides = nodeSides;
	return out;
}

/** Port constraints: which box sides each node's edges may attach to
 * (schematic pins, UML side-anchoring, …). */
export function portsLayer(sides: Record<string, BoxSide[]>): RouterLayer {
	return { nodeSides: sides };
}

/** Keep-out zones: routes strongly avoid these rects (they still cross when
 * there is no alternative — routing never fails). */
export function keepOutLayer(rects: Rect[], bias = 40): RouterLayer {
	return { costRegions: rects.map((r) => ({ ...r, bias })) };
}

/** Preferred corridors: routes are gently attracted into these rects — the
 * "lanes layer": express your layout's gaps as corridors and buses gravitate
 * there. Negative bias is floored by the router, so any value is safe. */
export function corridorLayer(rects: Rect[], bias = -0.4): RouterLayer {
	return { costRegions: rects.map((r) => ({ ...r, bias })) };
}
