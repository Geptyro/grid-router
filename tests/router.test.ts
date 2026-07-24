import { describe, expect, it } from 'vitest';
import { corridorGaps, routeGrid, type GridBox } from '../src/index.js';

const box = (l: number, t: number, w = 60, h = 30): GridBox => ({
	l,
	t,
	r: l + w,
	b: t + h,
	cx: l + w / 2,
	cy: t + h / 2
});

/** parse "M x y L x y …" into [[x,y], …] */
const pts = (d: string): number[][] =>
	d
		.split(/[ML]/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => s.split(/\s+/).map(Number));

describe('routeGrid', () => {
	it('routes every edge with zero violations on an open grid', () => {
		const boxes = new Map<string, GridBox>([
			['S', box(120, 200)],
			['T1', box(40, 40)],
			['T2', box(200, 40)]
		]);
		const r = routeGrid(
			boxes,
			[
				{ id: 'a', source: 'S', target: 'T1' },
				{ id: 'b', source: 'S', target: 'T2' }
			],
			300,
			300,
			{ res: 8 }
		);
		expect(r.conns).toHaveLength(2);
		expect(r.violations).toBe(0);
	});

	it('gives distinct endpoints to different buses reaching the same target', () => {
		const boxes = new Map<string, GridBox>([
			['A', box(40, 200)],
			['B', box(200, 200)],
			['T', box(120, 40)]
		]);
		const r = routeGrid(
			boxes,
			[
				{ id: 'a', source: 'A', target: 'T', bus: 'x' },
				{ id: 'b', source: 'B', target: 'T', bus: 'y' }
			],
			300,
			300,
			{ res: 8 }
		);
		expect(r.conns).toHaveLength(2);
		expect(r.violations).toBe(0);
		const endA = pts(r.conns[0].d).at(-1)!;
		const endB = pts(r.conns[1].d).at(-1)!;
		// same target edge (same y), but never the same entry point
		expect(Math.abs(endA[0] - endB[0])).toBeGreaterThanOrEqual(8);
	});

	it('merges same-bus edges into a shared trunk when exitCost is high', () => {
		const boxes = new Map<string, GridBox>([
			['S', box(120, 300)],
			['T1', box(80, 40)],
			['T2', box(160, 40)]
		]);
		const r = routeGrid(
			boxes,
			[
				{ id: 'a', source: 'S', target: 'T1', bus: 'g' },
				{ id: 'b', source: 'S', target: 'T2', bus: 'g' }
			],
			300,
			380,
			{ res: 8, exitCost: 16 }
		);
		expect(r.conns).toHaveLength(2);
		// one trunk out of the source: both full paths start at the same contact
		const startA = pts(r.conns[0].d)[0];
		const startB = pts(r.conns[1].d)[0];
		expect(startA).toEqual(startB);
	});

	it('never drops an edge: a walled-off target routes desperately and reports it', () => {
		const boxes = new Map<string, GridBox>([
			['T', box(0, 0)],
			// full-width wall below the target + the canvas edges seal it in
			['W', box(0, 40, 300, 30)],
			['S', box(120, 200)]
		]);
		const r = routeGrid(boxes, [{ id: 'a', source: 'S', target: 'T' }], 300, 300, { res: 8 });
		expect(r.conns).toHaveLength(1);
		expect(r.violations).toBeGreaterThanOrEqual(1);
	});

	it('cost layers repel routes from biased regions', () => {
		const boxes = new Map<string, GridBox>([
			['S', box(120, 200)],
			['T', box(120, 40)]
		]);
		const edges = [{ id: 'a', source: 'S', target: 'T' }];
		// a repulsive band between S and T, covering the direct drop but open
		// on the right — the route should detour around it
		const region = { l: 0, t: 100, r: 220, b: 130, bias: 50 };
		const direct = routeGrid(boxes, edges, 300, 300, { res: 8 });
		const biased = routeGrid(boxes, edges, 300, 300, { res: 8, costRegions: [region] });
		const maxX = (d: string) => Math.max(...pts(d).map((p) => p[0]));
		expect(maxX(biased.conns[0].d)).toBeGreaterThan(220);
		expect(maxX(direct.conns[0].d)).toBeLessThanOrEqual(220);
	});

	it('respects port constraints (nodeSides): a left/right-only target is entered sideways', () => {
		const boxes = new Map<string, GridBox>([
			['S', box(120, 200)],
			['T', box(120, 40)]
		]);
		const r = routeGrid(boxes, [{ id: 'a', source: 'S', target: 'T' }], 300, 300, {
			res: 8,
			nodeSides: { T: ['left', 'right'] }
		});
		expect(r.conns).toHaveLength(1);
		expect(r.violations).toBe(0);
		const [endX, endY] = pts(r.conns[0].d).at(-1)!;
		const t = boxes.get('T')!;
		// entry point sits on a vertical edge of T, not its top/bottom
		expect(endY).toBeGreaterThan(t.t);
		expect(endY).toBeLessThan(t.b);
		expect(endX <= t.l || endX >= t.r).toBe(true);
	});

	it('passes edge data through onto conns and keys buses by (source, bus)', () => {
		const boxes = new Map<string, GridBox>([
			['S', box(120, 200)],
			['T', box(120, 40)]
		]);
		const r = routeGrid(
			boxes,
			[{ id: 'a', source: 'S', target: 'T', bus: 'approved', data: { tone: 'approved' } }],
			300,
			300,
			{ res: 8 }
		);
		expect(r.conns[0].bus).toBe('S|approved');
		expect(r.conns[0].data).toEqual({ tone: 'approved' });
	});
});

describe('corridorGaps', () => {
	it('scales corridor supply with cell size', () => {
		expect(corridorGaps(8)).toEqual({ rowGap: 36, chipGap: 22, sidePad: 12 });
		expect(corridorGaps(12)).toEqual({ rowGap: 54, chipGap: 30, sidePad: 18 });
		// floors keep small cells sane
		expect(corridorGaps(6).rowGap).toBe(34);
	});
});
