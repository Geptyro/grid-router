<script lang="ts">
	import { GridDiagram, type GridEdge } from 'grid-router/svelte';
	import Knobs from './Knobs.svelte';
	import rawFlow from './mission-flow-data.json';

	// Real-world stress data: the trigger graph of the StarCraft II arcade map
	// "Undead Assault Reborn" (249 triggers), as rendered by the UAR unit
	// database's mission-flow page. Pick a trigger and its neighborhood routes
	// as a left→right timeline. The interesting selections are the timer hubs:
	// nearly every mission trigger enables AND disables the same scheduler
	// trigger, so 40+ buses converge on one chip — more arrowheads than a
	// coarse grid's ring around the chip can seat (endpoints are exclusive).
	// At 12px cells "Activate Timer2" exhausts its ring and the router's
	// desperate pass reports violations; at 8px the same chip offers 1.5× the
	// endpoint cells and routes clean. Corridor gaps can't fix that — only a
	// finer grid grows a chip's perimeter.
	interface FlowNode {
		id: string;
		name: string;
		armed: boolean;
		enables: string[];
		executes: string[];
		disables: string[];
		timerTo: string[];
	}
	const flowNodes = rawFlow as FlowNode[];
	const flowById = new Map(flowNodes.map((n) => [n.id, n]));

	let selectedId = $state('gt_ActivateTimer2');
	const options = [...flowNodes].sort((a, b) => a.name.localeCompare(b.name));

	// ---- neighborhood: layers by chain depth around the selection ----
	const UP = 2;
	const DOWN = 3;

	const graph = $derived.by(() => {
		const depth = new Map<string, number>([[selectedId, 0]]);
		let frontier = [selectedId];
		for (let d = 1; d <= DOWN && frontier.length; d++) {
			const next: string[] = [];
			for (const id of frontier) {
				const n = flowById.get(id);
				if (!n) continue;
				for (const t of [...n.enables, ...n.executes, ...n.timerTo]) {
					if (!depth.has(t) && flowById.has(t)) {
						depth.set(t, d);
						next.push(t);
					}
				}
			}
			frontier = next;
		}
		frontier = [selectedId];
		for (let d = 1; d <= UP && frontier.length; d++) {
			const next: string[] = [];
			for (const id of frontier) {
				for (const p of flowNodes) {
					if (
						(p.enables.includes(id) || p.executes.includes(id) || p.timerTo.includes(id)) &&
						!depth.has(p.id)
					) {
						depth.set(p.id, -d);
						next.push(p.id);
					}
				}
			}
			frontier = next;
		}

		const layers: FlowNode[][] = [];
		for (let d = -UP; d <= DOWN; d++) {
			const all = [...depth.entries()]
				.filter(([, dd]) => dd === d)
				.map(([id]) => flowById.get(id))
				.filter((n): n is FlowNode => !!n)
				.sort((a, b) => a.name.localeCompare(b.name));
			if (all.length) layers.push(all);
		}
		const shown = new Set(layers.flat().map((n) => n.id));

		// median-of-neighbors ordering (barycenter sweeps): chained triggers
		// line up across columns instead of scattering alphabetically
		const pos = new Map<string, number>();
		for (const l of layers) l.forEach((n, i) => pos.set(n.id, i));
		const neigh = new Map<string, string[]>();
		for (const id of shown) neigh.set(id, []);
		for (const id of shown) {
			const n = flowById.get(id)!;
			for (const t of [...n.enables, ...n.executes, ...n.timerTo, ...n.disables]) {
				if (shown.has(t)) {
					neigh.get(id)!.push(t);
					neigh.get(t)!.push(id);
				}
			}
		}
		for (let sweep = 0; sweep < 4; sweep++) {
			for (let li = 0; li < layers.length; li++) {
				layers[li] = layers[li]
					.map((n) => {
						const ps = neigh
							.get(n.id)!
							.map((m) => pos.get(m)!)
							.sort((a, b) => a - b);
						const med = ps.length ? ps[Math.floor(ps.length / 2)] : pos.get(n.id)!;
						return { n, med };
					})
					.sort((a, b) => a.med - b.med || a.n.name.localeCompare(b.n.name))
					.map((x) => x.n);
				layers[li].forEach((n, i) => pos.set(n.id, i));
			}
		}

		const edges: GridEdge[] = [];
		for (const id of shown) {
			const n = flowById.get(id)!;
			for (const t of n.enables)
				if (shown.has(t))
					edges.push({ id: `${id}>e>${t}`, source: id, target: t, bus: `${id}|en`, data: 'enable' });
			for (const t of n.executes)
				if (shown.has(t) && !n.enables.includes(t))
					edges.push({ id: `${id}>x>${t}`, source: id, target: t, bus: `${id}|ex`, data: 'execute' });
			for (const t of n.timerTo)
				if (shown.has(t) && !n.enables.includes(t) && !n.executes.includes(t))
					edges.push({ id: `${id}>t>${t}`, source: id, target: t, bus: `${id}|tm`, data: 'timer' });
			for (const t of n.disables)
				if (shown.has(t))
					edges.push({ id: `${id}>d>${t}`, source: id, target: t, bus: `${id}|off`, data: 'disable' });
		}
		return { layers, edges };
	});

	const KIND_COLOR: Record<string, string> = {
		enable: '#7fa35c',
		execute: '#7fadd1',
		disable: '#d06a52',
		timer: '#cfa95c'
	};

	// knobs — 8px default: the Timer2 hub needs the finer ring (raise to 12px
	// to watch the endpoint supply run out and the violation counter appear)
	let res = $state(8);
	let exitCost = $state(6);
	let costOwn = $state(0.02);
	let costTurn = $state(1);
	let hops = $state(true);
	let showGrid = $state(false);
	let showOccupancy = $state(false);

	let violations = $state(0);

	// hover: light a whole bus, or everything touching a node
	let hoveredBus = $state<string | undefined>(undefined);
	let hoveredNode = $state<string | undefined>(undefined);
	const busKey = (e: GridEdge) => `${e.source}|${e.bus ?? ''}`;
	const activeBuses = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredBus) s.add(hoveredBus);
		else if (hoveredNode) {
			for (const e of graph.edges) {
				if (e.source === hoveredNode || e.target === hoveredNode) s.add(busKey(e));
			}
		}
		return s;
	});
	const anyHover = $derived(activeBuses.size > 0);
	const litNodes = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredNode) s.add(hoveredNode);
		for (const e of graph.edges) {
			if (activeBuses.has(busKey(e))) {
				s.add(e.source);
				s.add(e.target);
			}
		}
		return s;
	});
</script>

<p class="hint">
	249 real triggers from a StarCraft II arcade map (Undead Assault Reborn) · pick a trigger to route
	its chain neighborhood · the timer hubs collect 40+ arrowheads on one chip — endpoints are
	exclusive, so at 12px cells the ring runs out and violations appear; 8px seats them all
</p>
<div class="controls">
	<label>
		trigger
		<select bind:value={selectedId}>
			{#each options as n (n.id)}
				<option value={n.id}>{n.name}</option>
			{/each}
		</select>
	</label>
	<Knobs bind:res bind:exitCost bind:costOwn bind:costTurn bind:hops bind:showGrid bind:showOccupancy />
	<span class="legend">
		{#if violations > 0}<b class="viol">{violations} violations</b>{/if}
		<span><i style="background: {KIND_COLOR.enable}"></i> enables</span>
		<span><i style="background: {KIND_COLOR.execute}"></i> runs</span>
		<span><i style="background: {KIND_COLOR.timer}"></i> via timer</span>
		<span><i style="background: {KIND_COLOR.disable}"></i> shuts down</span>
	</span>
</div>

<div class="board">
	<GridDiagram
		edges={graph.edges}
		opts={{ res, exitCost, costOwn, costTurn }}
		{hops}
		{showGrid}
		{showOccupancy}
		revision={selectedId}
		connStyle={(c) => ({
			color: KIND_COLOR[String(c.data ?? 'enable')] ?? KIND_COLOR.enable,
			dashed: c.data === 'disable',
			class: anyHover ? (activeBuses.has(c.bus) ? 'active' : 'dim') : ''
		})}
		onrouted={(info) => (violations = info.violations)}
		onconnenter={(c) => {
			hoveredNode = undefined;
			hoveredBus = c.bus;
		}}
		onconnleave={(c) => {
			if (hoveredBus === c.bus) hoveredBus = undefined;
		}}
	>
		{#snippet children(register)}
			<div class="levels">
				{#each graph.layers as layer, li (li)}
					<div class="level">
						{#each layer as n (n.id)}
							<button
								class="chip trig"
								class:sel={n.id === selectedId}
								class:lit={litNodes.has(n.id)}
								class:faded={anyHover && !litNodes.has(n.id)}
								use:register={n.id}
								onclick={() => (selectedId = n.id)}
								onpointerenter={() => {
									hoveredBus = undefined;
									hoveredNode = n.id;
								}}
								onpointerleave={() => {
									if (hoveredNode === n.id) hoveredNode = undefined;
								}}
							>
								{n.name}
								<small>{n.armed ? 'armed' : 'chained'}</small>
							</button>
						{/each}
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
		margin: 0 0 14px;
		max-width: 78ch;
	}

	.controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 14px;
		margin: 0 0 14px;
		font-size: 12px;
		color: var(--dim);
	}

	.controls > label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.controls select {
		background: #1c2230;
		color: var(--text);
		border: 1px solid #39445c;
		border-radius: 5px;
		padding: 1px 4px;
		font: inherit;
		max-width: 220px;
	}

	.legend {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		margin-left: auto;
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.legend i {
		width: 14px;
		height: 3px;
		border-radius: 2px;
		display: inline-block;
	}

	.viol {
		color: #f0564f;
	}

	.board {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 16px;
		overflow-x: auto;
		--grid-diagram-bg: var(--panel);
	}

	/* horizontal timeline: layers are columns, earliest on the left. The
	   vertical gap between stacked chips carries the horizontal lanes, so it
	   gets the row-gap supply; the column gap gets it too for the trunks. */
	.levels {
		display: flex;
		align-items: center;
		gap: calc(var(--gr-row-gap, 54px) * 1.8);
		min-width: max-content;
		padding-block: 16px;
	}

	.level {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: calc(var(--gr-row-gap, 54px) + 6px);
	}

	.trig {
		font: inherit;
		font-size: 12px;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		max-width: 200px;
		white-space: normal;
	}

	.trig.sel {
		border-color: #5b78b4;
		box-shadow: 0 0 0 2px rgba(91, 120, 180, 0.3);
		cursor: default;
	}

	.trig.lit {
		border-color: #5b78b4;
	}

	.trig.faded {
		opacity: 0.35;
	}

	.board :global(path.gr-conn.active) {
		stroke-width: 2.2;
	}

	.board :global(path.gr-conn.dim) {
		opacity: 0.15;
	}
</style>
