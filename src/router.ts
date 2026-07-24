/**
 * Orthogonal edge router on a grid.
 *
 * Rasterizes a canvas into square cells and routes every edge with A*:
 *
 * - node rects ("boxes", inflated) hard-block cells;
 * - per-direction occupancy: a cell can host ONE horizontal and ONE vertical
 *   run — another bus reusing the same direction pays a near-prohibitive
 *   penalty (soft block, so routing never fails), while perpendicular
 *   crossings only pay a small toll → lanes separate themselves and crossings
 *   happen only where they're worth it;
 * - same-bus discount + tree seeding: a bus's later edges branch from the
 *   OPTIMAL point of the already-routed trunk (Steiner-style joins), and
 *   `exitCost` prices opening a new trunk out of a source, so merges can win
 *   even over shorter direct paths;
 * - turn penalty biases toward long straight runs;
 * - endpoints are exclusive per bus (no stacked stubs/arrowheads);
 * - an edge is NEVER dropped: when a node row walls the grid off, a desperate
 *   pass routes through obstacles at a huge cost and reports a violation.
 *
 * Pure geometry: the caller measures its DOM into {@link GridBox}es and
 * renders the returned SVG path strings. Framework-free.
 */

export interface GridBox {
	t: number;
	b: number;
	l: number;
	r: number;
	cx: number;
	cy: number;
}

export interface GridEdge {
	id: string;
	source: string;
	target: string;
	/** Bus discriminator: edges sharing (source, bus) merge into one trunk
	 * tree. Defaults to the source alone. */
	bus?: string;
	/** Opaque consumer payload, passed through untouched onto the conn. */
	data?: unknown;
}

export interface GridConn {
	id: string;
	source: string;
	target: string;
	/** Full bus key (`source|bus`) — stable grouping handle for rendering
	 * (e.g. crossing-hop halos are painted per bus). */
	bus: string;
	data?: unknown;
	/** Orthogonal SVG path: source contact → routed cells → target contact. */
	d: string;
}

export interface GridDebugCell {
	x: number;
	y: number;
	kind: 'chip' | 'h' | 'v' | 'hv' | 'bad';
}

export interface GridResult {
	conns: GridConn[];
	/** deepest y any path reaches (callers reserve layout height for it) */
	bottom: number;
	/** lane-sharing incidents (should be 0 — non-zero means the layout does
	 * not supply enough corridor space, see corridorGaps()) */
	violations: number;
	debug: { res: number; cols: number; rows: number; cells: GridDebugCell[] };
}

// Costs are in "cells". Tuning notes: TURN < the detour a straighter but
// longer route would take; CROSS small enough that crossing beats detouring
// around a whole row; OVERLAP practically prohibitive — any detour that
// exists at all must win, and a path that still pays it had NO alternative
// (a corridor-supply problem, reported as a violation).
const COST_STEP = 1;
const COST_CROSS = 0.4;
const COST_OVERLAP = 4000;
const GAP = 3; // endpoint stub clearance off the box edge

/** Box inflation in px: routed runs keep this clearance off every box. */
export const BOX_INFLATE = 3;

export interface GridOpts {
	/** grid cell size in px (default 12) */
	res?: number;
	/** cost per cell when riding cells the bus already owns (default 0.02) */
	costOwn?: number;
	/** penalty per 90° turn (default 1) */
	costTurn?: number;
	/** penalty for opening a NEW trunk out of a source (default 0) — raise it
	 * to make a bus's edges merge even when direct paths would be shorter */
	exitCost?: number;
	/**
	 * Cost layers: arbitrary rects (px) adding a per-cell bias to every step
	 * inside them — positive repels routes, negative attracts them. This is
	 * the generic hook for consumer concepts the router deliberately does not
	 * know about (e.g. a "lanes" layer biasing corridors negative, keep-out
	 * zones, preferred highways). The effective step cost is floored so
	 * negative biases can't break A*.
	 */
	costRegions?: { l: number; t: number; r: number; b: number; bias: number }[];
	/**
	 * Port constraints: restrict which box sides edges may attach to, per node
	 * id (schematic semantics — a horizontal resistor only connects via its
	 * left/right leads, an IC via its pin sides). Unlisted nodes accept all
	 * four sides. The desperate fallback relaxes the constraint rather than
	 * dropping the edge.
	 */
	nodeSides?: Record<string, BoxSide[]>;
}

export type BoxSide = 'top' | 'bottom' | 'left' | 'right';

export function routeGrid(
	boxes: Map<string, GridBox>,
	edges: GridEdge[],
	width: number,
	height: number,
	opts: GridOpts = {}
): GridResult {
	const res = opts.res ?? 12;
	const costOwn = opts.costOwn ?? 0.02;
	const costTurn = opts.costTurn ?? 1;
	const exitCost = opts.exitCost ?? 0;
	const cols = Math.max(2, Math.ceil(width / res));
	const rows = Math.max(2, Math.ceil(height / res));
	const N = cols * rows;
	const blocked = new Uint8Array(N);
	const usageH = new Int32Array(N).fill(-1);
	const usageV = new Int32Array(N).fill(-1);
	// Path endpoints are EXCLUSIVE per bus: two buses sharing a start/goal cell
	// (one entering it vertically, one horizontally) would stack their stubs and
	// arrowheads on the same spot at the box edge.
	const endpointOwner = new Int32Array(N).fill(-1);
	// Consumer cost layers rasterized to a per-cell bias.
	const bias = new Float64Array(N);
	for (const rg of opts.costRegions ?? []) {
		const x0 = Math.max(0, Math.floor(rg.l / res));
		const x1 = Math.min(cols - 1, Math.floor(rg.r / res));
		const y0 = Math.max(0, Math.floor(rg.t / res));
		const y1 = Math.min(rows - 1, Math.floor(rg.b / res));
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bias[y * cols + x] += rg.bias;
	}

	const centerOf = (i: number) => ({
		x: ((i % cols) + 0.5) * res,
		y: (Math.floor(i / cols) + 0.5) * res
	});

	// --- block box cells (inflated so runs keep visual clearance) ---
	for (const b of boxes.values()) {
		const x0 = Math.max(0, Math.floor((b.l - BOX_INFLATE) / res));
		const x1 = Math.min(cols - 1, Math.floor((b.r + BOX_INFLATE) / res));
		const y0 = Math.max(0, Math.floor((b.t - BOX_INFLATE) / res));
		const y1 = Math.min(rows - 1, Math.floor((b.b + BOX_INFLATE) / res));
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) blocked[y * cols + x] = 1;
	}

	/** Ring of free cells just outside a box, CORNERS EXCLUDED: cells strictly
	 * over the box's horizontal span connect vertically, cells strictly beside
	 * its vertical span connect horizontally — so a path can never end with a
	 * sideways segment kissing a box corner. `includeBlocked` is the desperate
	 * mode: a fully sealed box still needs endpoints. */
	function ring(
		b: GridBox,
		includeBlocked = false,
		sides?: BoxSide[]
	): { cell: number; dir: 0 | 1 }[] {
		const out: { cell: number; dir: 0 | 1 }[] = [];
		const ok = (i: number) => includeBlocked || !blocked[i];
		const allow = (s: BoxSide) => !sides || sides.includes(s);
		// Small-box tolerance: a box narrower than two cells has no strict span —
		// fall back to the single column/row nearest its center, so tiny nodes
		// (consumer "port" pads) still get endpoints.
		const xs: number[] = [];
		for (let x = Math.max(0, Math.ceil(b.l / res)); x <= Math.floor(b.r / res) - 1; x++) {
			if (x <= cols - 1) xs.push(x);
		}
		if (!xs.length) xs.push(Math.min(cols - 1, Math.max(0, Math.floor(b.cx / res))));
		const yTop = Math.floor((b.t - BOX_INFLATE) / res) - 1;
		const yBot = Math.floor((b.b + BOX_INFLATE) / res) + 1;
		for (const x of xs) {
			if (allow('top') && yTop >= 0 && ok(yTop * cols + x)) {
				out.push({ cell: yTop * cols + x, dir: 1 });
			}
			if (allow('bottom') && yBot <= rows - 1 && ok(yBot * cols + x)) {
				out.push({ cell: yBot * cols + x, dir: 1 });
			}
		}
		const ys: number[] = [];
		for (let y = Math.max(0, Math.ceil(b.t / res)); y <= Math.floor(b.b / res) - 1; y++) {
			if (y <= rows - 1) ys.push(y);
		}
		if (!ys.length) ys.push(Math.min(rows - 1, Math.max(0, Math.floor(b.cy / res))));
		const xL = Math.floor((b.l - BOX_INFLATE) / res) - 1;
		const xR = Math.floor((b.r + BOX_INFLATE) / res) + 1;
		for (const y of ys) {
			if (allow('left') && xL >= 0 && ok(y * cols + xL)) out.push({ cell: y * cols + xL, dir: 0 });
			if (allow('right') && xR <= cols - 1 && ok(y * cols + xR)) {
				out.push({ cell: y * cols + xR, dir: 0 });
			}
		}
		return out;
	}

	// --- group edges into buses ---
	interface Bus {
		key: string;
		idx: number;
		items: GridEdge[];
		own: Set<number>; // cell*2+dir claimed by this bus
		/** routed tree: cell → previous cell toward the source (trunk parent) */
		prev: Map<number, number>;
	}
	const busMap = new Map<string, Bus>();
	for (const e of edges) {
		if (!boxes.has(e.source) || !boxes.has(e.target)) continue;
		const key = `${e.source}|${e.bus ?? ''}`;
		let bus = busMap.get(key);
		if (!bus) {
			bus = { key, idx: busMap.size, items: [], own: new Set(), prev: new Map() };
			busMap.set(key, bus);
		}
		bus.items.push(e);
	}
	// Bigger fans first: they claim their trunks before loners squeeze through.
	const buses = [...busMap.values()].sort((a, b) => b.items.length - a.items.length);

	// --- A* over (cell, dir) states ---
	// Tiny binary heap on f; lazy decrease (re-push, skip stale pops).
	function astar(
		bus: Bus,
		starts: { cell: number; dir: 0 | 1; g0: number }[],
		goals: Set<number>,
		/** desperate mode: blocked cells become traversable at a huge cost so a
		 * path ALWAYS exists — silently missing edges is worse than an ugly one */
		desperate = false
	): { cell: number; dir: 0 | 1 }[] | null {
		const S = N * 2;
		const g = new Float64Array(S).fill(Infinity);
		const parent = new Int32Array(S).fill(-1);
		const closed = new Uint8Array(S);
		// goal heuristic anchor: mean of goal cells
		let gx = 0;
		let gy = 0;
		for (const c of goals) {
			gx += c % cols;
			gy += Math.floor(c / cols);
		}
		gx /= goals.size || 1;
		gy /= goals.size || 1;
		const h = (cell: number) =>
			Math.abs((cell % cols) - gx) + Math.abs(Math.floor(cell / cols) - gy);

		type Entry = { f: number; s: number };
		const heap: Entry[] = [];
		const push = (e: Entry) => {
			heap.push(e);
			let i = heap.length - 1;
			while (i > 0) {
				const p = (i - 1) >> 1;
				if (heap[p].f <= heap[i].f) break;
				[heap[p], heap[i]] = [heap[i], heap[p]];
				i = p;
			}
		};
		const pop = (): Entry | undefined => {
			const top = heap[0];
			const last = heap.pop();
			if (heap.length && last) {
				heap[0] = last;
				let i = 0;
				for (;;) {
					const l = 2 * i + 1;
					const r = l + 1;
					let m = i;
					if (l < heap.length && heap[l].f < heap[m].f) m = l;
					if (r < heap.length && heap[r].f < heap[m].f) m = r;
					if (m === i) break;
					[heap[m], heap[i]] = [heap[i], heap[m]];
					i = m;
				}
			}
			return top;
		};

		for (const st of starts) {
			const s = st.cell * 2 + st.dir;
			if (g[s] > st.g0) {
				g[s] = st.g0;
				push({ f: st.g0 + h(st.cell), s });
			}
		}

		// A step covers HALF of each of its two cells — price the worst of both,
		// or an elbow's outgoing half would be free to overlap.
		const halfCost = (cell: number, dir: 0 | 1) => {
			const same = dir === 0 ? usageH[cell] : usageV[cell];
			if (same === bus.idx || bus.own.has(cell * 2 + dir)) return costOwn;
			if (same !== -1) return COST_OVERLAP;
			return COST_STEP;
		};
		const stepCost = (from: number, next: number, dir: 0 | 1) => {
			// floored so negative cost-layer biases can't break A* (no negative steps)
			let c = Math.max(0.05, Math.max(halfCost(from, dir), halfCost(next, dir)) + bias[next]);
			const cross = dir === 0 ? usageV[next] : usageH[next];
			if (cross !== -1 && cross !== bus.idx) c += COST_CROSS;
			return c;
		};

		let goalState = -1;
		while (heap.length) {
			const cur = pop()!;
			const s = cur.s;
			if (closed[s]) continue;
			closed[s] = 1;
			const cell = s >> 1;
			const dir = (s & 1) as 0 | 1;
			if (goals.has(cell)) {
				goalState = s;
				break;
			}
			const x = cell % cols;
			const y = (cell - x) / cols;
			const neigh: { cell: number; dir: 0 | 1 }[] = [];
			if (x > 0) neigh.push({ cell: cell - 1, dir: 0 });
			if (x < cols - 1) neigh.push({ cell: cell + 1, dir: 0 });
			if (y > 0) neigh.push({ cell: cell - cols, dir: 1 });
			if (y < rows - 1) neigh.push({ cell: cell + cols, dir: 1 });
			for (const nb of neigh) {
				if (blocked[nb.cell] && !desperate) continue;
				const ns = nb.cell * 2 + nb.dir;
				if (closed[ns]) continue;
				const cost =
					stepCost(cell, nb.cell, nb.dir) +
					(nb.dir === dir ? 0 : costTurn) +
					(blocked[nb.cell] ? 800 : 0);
				const ng = g[s] + cost;
				if (ng < g[ns]) {
					g[ns] = ng;
					parent[ns] = s;
					push({ f: ng + h(nb.cell), s: ns });
				}
			}
		}
		if (goalState < 0) return null;
		const path: { cell: number; dir: 0 | 1 }[] = [];
		for (let s = goalState; s >= 0; s = parent[s]) {
			path.push({ cell: s >> 1, dir: (s & 1) as 0 | 1 });
		}
		path.reverse();
		return path;
	}

	/** Contact point on a box edge for the path end at ring cell `i`. Stays
	 * aligned with the cell CENTER (corner-free rings guarantee it lies over
	 * the edge), so the stub is colinear with the routed run — never nudge the
	 * routed geometry instead: that would shift a run off its claimed lane. */
	function contact(b: GridBox, i: number): { x: number; y: number } {
		const c = centerOf(i);
		if (c.y < b.t) return { x: Math.min(Math.max(c.x, b.l + 2), b.r - 2), y: b.t - GAP };
		if (c.y > b.b) return { x: Math.min(Math.max(c.x, b.l + 2), b.r - 2), y: b.b + GAP };
		if (c.x < b.l) return { x: b.l - GAP, y: Math.min(Math.max(c.y, b.t + 2), b.b - 2) };
		return { x: b.r + GAP, y: Math.min(Math.max(c.y, b.t + 2), b.b - 2) };
	}

	const conns: GridConn[] = [];
	let bottom = 0;
	let violations = 0;
	const badCells = new Set<number>();

	for (const bus of buses) {
		const s = boxes.get(bus.items[0].source)!;
		// Route nearest targets first so the trunk grows outward and later
		// edges find own-bus cells to ride.
		const items = [...bus.items].sort((a, b) => {
			const ta = boxes.get(a.target)!;
			const tb = boxes.get(b.target)!;
			return (
				Math.abs(ta.cy - s.cy) + Math.abs(ta.cx - s.cx) -
				(Math.abs(tb.cy - s.cy) + Math.abs(tb.cx - s.cx))
			);
		});
		for (const e of items) {
			const t = boxes.get(e.target)!;
			// Seeds: the source's ring (opening a NEW trunk costs exitCost) PLUS
			// every cell the bus already routed at cost 0 — a later edge branches
			// from the OPTIMAL point of the existing trunk (Steiner-style join).
			// Endpoint cells owned by other buses are off limits (stacked stubs).
			const sSides = opts.nodeSides?.[e.source];
			const tSides = opts.nodeSides?.[e.target];
			const starts = ring(s, false, sSides)
				.filter((r) => endpointOwner[r.cell] === -1 || endpointOwner[r.cell] === bus.idx)
				.map((r) => ({ ...r, g0: exitCost }));
			for (const od of bus.own) {
				starts.push({ cell: od >> 1, dir: (od & 1) as 0 | 1, g0: 0 });
			}
			const goals = new Set(
				ring(t, false, tSides)
					.map((r) => r.cell)
					.filter((c) => endpointOwner[c] === -1 || endpointOwner[c] === bus.idx)
			);
			let path = starts.length && goals.size ? astar(bus, starts, goals) : null;
			if (!path) {
				// No legal route (a dense node row can wall the grid off at coarse
				// cell sizes, or port constraints seal a node in). NEVER drop the
				// edge silently: retry with blocked cells traversable at a huge
				// cost — and if even that fails, relax the port constraints too.
				const dStarts = ring(s, true, sSides).map((r) => ({ ...r, g0: exitCost }));
				for (const od of bus.own) {
					dStarts.push({ cell: od >> 1, dir: (od & 1) as 0 | 1, g0: 0 });
				}
				const dGoals = new Set(ring(t, true, tSides).map((r) => r.cell));
				path = dStarts.length && dGoals.size ? astar(bus, dStarts, dGoals, true) : null;
				if (!path && (sSides || tSides)) {
					const uStarts = ring(s, true).map((r) => ({ ...r, g0: exitCost }));
					for (const od of bus.own) {
						uStarts.push({ cell: od >> 1, dir: (od & 1) as 0 | 1, g0: 0 });
					}
					const uGoals = new Set(ring(t, true).map((r) => r.cell));
					path = uStarts.length && uGoals.size ? astar(bus, uStarts, uGoals, true) : null;
				}
				if (!path) continue;
				violations++;
				badCells.add(path[Math.floor(path.length / 2)].cell);
			}

			// Claim per STEP on BOTH cells (an elbow claims its outgoing direction
			// too) + extend the bus tree (first writer keeps the link).
			for (let i = 1; i < path.length; i++) {
				const dir = path[i].dir;
				for (const cell of [path[i - 1].cell, path[i].cell]) {
					const cur = dir === 0 ? usageH[cell] : usageV[cell];
					if (cur !== -1 && cur !== bus.idx && !bus.own.has(cell * 2 + dir)) {
						violations++;
						badCells.add(cell);
					}
					if (dir === 0) {
						if (usageH[cell] === -1) usageH[cell] = bus.idx;
					} else if (usageV[cell] === -1) usageV[cell] = bus.idx;
					bus.own.add(cell * 2 + dir);
				}
				if (!bus.prev.has(path[i].cell) && path[i - 1].cell !== path[i].cell) {
					bus.prev.set(path[i].cell, path[i - 1].cell);
				}
			}
			if (endpointOwner[path[0].cell] === -1) endpointOwner[path[0].cell] = bus.idx;
			const goalCell = path[path.length - 1].cell;
			if (endpointOwner[goalCell] === -1) endpointOwner[goalCell] = bus.idx;

			// Full source→target chain: if the A* seed was a mid-trunk cell, walk
			// the bus tree back to the source ring and prepend that trunk prefix.
			const chain: number[] = [];
			{
				let c = path[0].cell;
				const guard = new Set<number>();
				while (bus.prev.has(c) && !guard.has(c)) {
					guard.add(c);
					c = bus.prev.get(c)!;
					chain.push(c);
				}
				chain.reverse();
			}
			const fullCells = [...chain, ...path.map((p) => p.cell)];

			// polyline: source contact → cell centers (collinear-compressed) → target contact
			const pts: { x: number; y: number }[] = [];
			const first = contact(s, fullCells[0]);
			const last = contact(t, fullCells[fullCells.length - 1]);
			pts.push(first);
			for (const c of fullCells) pts.push(centerOf(c));
			pts.push(last);
			const simp: { x: number; y: number }[] = [];
			for (const p of pts) {
				const n = simp.length;
				if (n >= 2) {
					const a = simp[n - 2];
					const b3 = simp[n - 1];
					if ((a.x === b3.x && b3.x === p.x) || (a.y === b3.y && b3.y === p.y)) {
						simp[n - 1] = p;
						continue;
					}
				}
				simp.push(p);
			}
			// force pure orthogonal corners (cell centers already are; stubs may
			// introduce tiny diagonals — insert a corner point when needed)
			const ortho: { x: number; y: number }[] = [simp[0]];
			for (let i = 1; i < simp.length; i++) {
				const a = ortho[ortho.length - 1];
				const b4 = simp[i];
				if (a.x !== b4.x && a.y !== b4.y) ortho.push({ x: b4.x, y: a.y });
				ortho.push(b4);
			}
			const d = ortho
				.map((p, i) => `${i === 0 ? 'M' : 'L'} ${Math.round(p.x * 2) / 2} ${Math.round(p.y * 2) / 2}`)
				.join(' ');
			for (const p of ortho) bottom = Math.max(bottom, p.y);
			conns.push({ id: `e:${e.id}`, source: e.source, target: e.target, bus: bus.key, data: e.data, d });
		}
	}

	// --- debug cells ---
	const cells: GridDebugCell[] = [];
	for (let i = 0; i < N; i++) {
		const x = i % cols;
		const y = (i - x) / cols;
		if (badCells.has(i)) cells.push({ x, y, kind: 'bad' });
		else if (blocked[i]) cells.push({ x, y, kind: 'chip' });
		else if (usageH[i] !== -1 && usageV[i] !== -1) cells.push({ x, y, kind: 'hv' });
		else if (usageH[i] !== -1) cells.push({ x, y, kind: 'h' });
		else if (usageV[i] !== -1) cells.push({ x, y, kind: 'v' });
	}

	return { conns, bottom, violations, debug: { res, cols, rows, cells } };
}
