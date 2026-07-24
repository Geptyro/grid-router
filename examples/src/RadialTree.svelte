<script lang="ts">
	import { GridDiagram, type GridConn, type GridEdge } from 'grid-router/svelte';
	import Knobs from './Knobs.svelte';

	// A radial tree (mind map): root at the CENTER, branches radiating in all
	// directions, leaves on an outer ring — no lanes, no flow direction, chips
	// placed by polar coordinates. Each parent's children are one bus, so limbs
	// fuse near the trunk (drive it with the merge knob). Randomize regenerates
	// the whole topology — the router just re-routes whatever appears.
	interface TreeNode {
		id: string;
		label: string;
		x: number;
		y: number;
		branch: number;
	}

	const W = 780;
	const H = 620;
	const CX = W / 2;
	const CY = H / 2;
	const R1 = 150;
	const R2 = 268;
	const COLORS = ['#3fb950', '#6e8fe8', '#d55181', '#c2842f', '#f0564f', '#39c5cf'];

	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
	const polar = (r: number, a: number) => ({
		x: clamp(CX + r * Math.cos(a), 70, W - 70),
		y: clamp(CY + r * Math.sin(a), 36, H - 30)
	});

	function buildRadial(rootLabel: string, spec: [string, string[]][]) {
		const nodes: TreeNode[] = [{ id: 'root', label: rootLabel, x: CX, y: CY, branch: -1 }];
		const edges: GridEdge[] = [];
		const N = spec.length;
		spec.forEach(([branchLabel, leaves], i) => {
			const a = (2 * Math.PI * i) / N - Math.PI / 2 + (Math.random() * 0.3 - 0.15);
			const bid = `b${i}`;
			const p = polar(R1, a);
			nodes.push({ id: bid, label: branchLabel, x: p.x, y: p.y, branch: i });
			// bus per LIMB: color follows the bus — root edges must not share one
			// bus, or differently-colored limbs would merge trunks
			edges.push({ id: `e-${bid}`, source: 'root', target: bid, bus: bid });
			// leaves fan inside the branch's angular window on the outer ring
			const win = ((2 * Math.PI) / N) * 0.72;
			leaves.forEach((leafLabel, j) => {
				const la =
					leaves.length === 1
						? a
						: a - win / 2 + (win * j) / (leaves.length - 1);
				const lp = polar(R2 + (Math.random() * 24 - 12), la);
				const lid = `${bid}l${j}`;
				nodes.push({ id: lid, label: leafLabel, x: lp.x, y: lp.y, branch: i });
				edges.push({ id: `e-${lid}`, source: bid, target: lid });
			});
		});
		return { nodes, edges };
	}

	function initialTree() {
		return buildRadial('grid-router', [
			['core', ['routeGrid', 'occupancy', 'A*', 'buses']],
			['svelte', ['GridDiagram', 'register', 'connStyle']],
			['layers', ['ports', 'keepOut', 'corridor']],
			['examples', ['circuit', 'org chart', 'oil & gas']]
		]);
	}

	const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
	function randomTree() {
		const N = 3 + Math.floor(Math.random() * 4); // 3–6 branches
		const spec: [string, string[]][] = Array.from({ length: N }, (_, i) => [
			WORDS[i],
			Array.from(
				{ length: Math.floor(Math.random() * 5) }, // 0–4 leaves
				(_, j) => `${WORDS[i]}-${j + 1}`
			)
		]);
		return buildRadial('root', spec);
	}

	let tree = $state(initialTree());
	const branchOf = $derived(new Map(tree.nodes.map((n) => [n.id, n.branch])));
	const colorOf = (c: GridConn) => COLORS[(branchOf.get(c.target) ?? 0) % COLORS.length];

	// knobs (example defaults)
	let res = $state(10);
	let exitCost = $state(4);
	let costOwn = $state(0.02);
	let costTurn = $state(1);
	let hops = $state(true);
	let showGrid = $state(false);
	let showOccupancy = $state(false);

	// hover: an edge lights its bus; a node lights every bus touching it
	let hoveredBus = $state<string | undefined>(undefined);
	let hoveredNode = $state<string | undefined>(undefined);
	const busKey = (e: GridEdge) => `${e.source}|${e.bus ?? ''}`;
	const activeBuses = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredBus) s.add(hoveredBus);
		else if (hoveredNode) {
			for (const e of tree.edges) {
				if (e.source === hoveredNode || e.target === hoveredNode) s.add(busKey(e));
			}
		}
		return s;
	});
	const anyHover = $derived(activeBuses.size > 0);
	const litNodes = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredNode) s.add(hoveredNode);
		for (const e of tree.edges) {
			if (activeBuses.has(busKey(e))) {
				s.add(e.source);
				s.add(e.target);
			}
		}
		return s;
	});
</script>

<p class="hint">
	Radial tree — root at the center, branches in ALL directions (polar placement, no lanes) ·
	<button class="rnd" onclick={() => (tree = randomTree())}>randomize tree</button>
	— new topology, the router re-routes · raise <em>merge</em> to fuse limbs
</p>
<Knobs bind:res bind:exitCost bind:costOwn bind:costTurn bind:hops bind:showGrid bind:showOccupancy />

<div class="board">
	<GridDiagram
		edges={tree.edges}
		opts={{ res, exitCost, costOwn, costTurn }}
		{hops}
		{showGrid}
		{showOccupancy}
		revision={tree}
		connStyle={(c) => ({
			color: colorOf(c),
			arrowAt: 'none',
			class: anyHover ? (activeBuses.has(c.bus) ? 'active' : 'dim') : ''
		})}
		onconnenter={(c) => {
			hoveredNode = undefined;
			hoveredBus = c.bus;
		}}
		onconnleave={(c) => {
			if (hoveredBus === c.bus) hoveredBus = undefined;
		}}
	>
		{#snippet children(register)}
			<div class="sky" style:height="{H}px">
				{#each tree.nodes as n (n.id)}
					<div
						class="chip node"
						class:root={n.branch === -1}
						class:lit={litNodes.has(n.id)}
						class:faded={anyHover && !litNodes.has(n.id)}
						style:left="{n.x}px"
						style:top="{n.y}px"
						style:--branch={n.branch === -1 ? 'var(--text)' : COLORS[n.branch % COLORS.length]}
						use:register={n.id}
						onpointerenter={() => {
							hoveredBus = undefined;
							hoveredNode = n.id;
						}}
						onpointerleave={() => {
							if (hoveredNode === n.id) hoveredNode = undefined;
						}}
					>
						{n.label}
					</div>
				{/each}
			</div>
		{/snippet}
	</GridDiagram>
</div>

<style>
	.hint {
		color: var(--dim);
		font-size: 12px;
		margin: 0 0 10px;
	}

	.rnd {
		background: #1c2230;
		color: var(--text);
		border: 1px solid #39445c;
		border-radius: 6px;
		padding: 2px 10px;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}

	.rnd:hover {
		border-color: #5b78b4;
	}

	.board {
		width: 812px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 16px;
		--grid-diagram-bg: var(--panel);
	}

	.sky {
		position: relative;
	}

	/* polar placement: chips CENTERED on their computed point */
	.node {
		position: absolute;
		transform: translate(-50%, -50%);
		border-color: color-mix(in srgb, var(--branch) 45%, #39445c);
	}

	.node.root {
		font-weight: 700;
		font-size: 14px;
		padding: 7px 14px;
		border-width: 2px;
	}

	.node.lit {
		border-color: var(--branch);
	}

	.node.faded {
		opacity: 0.3;
	}

	.board :global(path.gr-conn.active) {
		stroke-width: 2.2;
	}

	.board :global(path.gr-conn.dim) {
		opacity: 0.15;
	}
</style>
