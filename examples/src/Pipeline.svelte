<script lang="ts">
	import { GridDiagram, keepOutLayer, withLayers, type GridEdge } from 'grid-router/svelte';
	import Knobs from './Knobs.svelte';

	// An oil & gas network on an absolutely-positioned board — the router
	// doesn't care about flow direction or layout system. Buses are PRODUCTS
	// (crude / gas / refined) so parallel pipelines share trunks; the
	// maintenance zone is a keepOutLayer the flows detour around.
	const NODES: { id: string; label: string; sub: string; x: number; y: number }[] = [
		{ id: 'riga', label: '🛢 Rig Alpha', sub: 'offshore', x: 20, y: 30 },
		{ id: 'rigb', label: '🛢 Rig Bravo', sub: 'offshore', x: 20, y: 150 },
		{ id: 'gasf', label: '🔥 Gas field', sub: 'onshore', x: 20, y: 270 },
		{ id: 'pump', label: '⚙ Pump st.', sub: 'crude hub', x: 210, y: 90 },
		{ id: 'refinery', label: '🏭 Refinery', sub: 'distill', x: 390, y: 60 },
		{ id: 'gasplant', label: '⚗ Gas plant', sub: 'process', x: 250, y: 260 },
		{ id: 'tanks', label: '⛽ Tank farm', sub: 'storage', x: 590, y: 60 },
		{ id: 'power', label: '⚡ Power', sub: 'turbines', x: 430, y: 260 },
		{ id: 'port', label: '🚢 Terminal', sub: 'export', x: 590, y: 260 }
	];
	const edges: GridEdge[] = [
		{ id: 'ra-pump', source: 'riga', target: 'pump', bus: 'crude' },
		{ id: 'rb-pump', source: 'rigb', target: 'pump', bus: 'crude' },
		{ id: 'pump-ref', source: 'pump', target: 'refinery', bus: 'crude' },
		{ id: 'gf-gp', source: 'gasf', target: 'gasplant', bus: 'gas' },
		{ id: 'gp-power', source: 'gasplant', target: 'power', bus: 'gas' },
		{ id: 'gp-ref', source: 'gasplant', target: 'refinery', bus: 'gas' },
		{ id: 'ref-tanks', source: 'refinery', target: 'tanks', bus: 'refined' },
		{ id: 'ref-port', source: 'refinery', target: 'port', bus: 'refined' },
		{ id: 'tanks-port', source: 'tanks', target: 'port', bus: 'refined' }
	];
	const COLORS: Record<string, string> = {
		crude: '#c2842f',
		gas: '#6e8fe8',
		refined: '#3fb950'
	};

	// knobs (example defaults)
	let res = $state(10);
	let exitCost = $state(6);
	let costOwn = $state(0.02);
	let costTurn = $state(1);
	let hops = $state(true);
	let showGrid = $state(false);
	let showOccupancy = $state(false);

	// The maintenance zone: a visible overlay div AND a keepOutLayer with the
	// same rect — the consumer keeps them in sync, the router only sees
	// "cells here cost +40 each".
	const ZONE = { l: 300, t: 120, r: 480, b: 200 };
	let zoneOn = $state(true);
	const opts = $derived(
		withLayers({ res, exitCost, costOwn, costTurn }, zoneOn && keepOutLayer([ZONE]))
	);

	// hover: an edge lights its bus; a node lights every bus touching it
	let hoveredBus = $state<string | undefined>(undefined);
	let hoveredNode = $state<string | undefined>(undefined);
	const activeBuses = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredBus) s.add(hoveredBus);
		else if (hoveredNode) {
			for (const e of edges) {
				if (e.source === hoveredNode || e.target === hoveredNode) s.add(`${e.source}|${e.bus}`);
			}
		}
		return s;
	});
	const anyHover = $derived(activeBuses.size > 0);
	const litNodes = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredNode) s.add(hoveredNode);
		for (const e of edges) {
			if (activeBuses.has(`${e.source}|${e.bus}`)) {
				s.add(e.source);
				s.add(e.target);
			}
		}
		return s;
	});

	// Dynamic layout: scatter the nodes over random slots — the router
	// re-measures and re-routes instantly (`revision` triggers it, since chip
	// MOVES don't resize the canvas). This is the point of runtime routing:
	// no hand-drawn connectors survive a layout change.
	let nodes = $state(NODES.map((n) => ({ ...n })));
	function randomize() {
		// 4×3 slot grid + jitter, shuffled — random but never overlapping
		const slots: { x: number; y: number }[] = [];
		for (const x of [20, 200, 380, 580]) {
			for (const y of [30, 150, 270]) slots.push({ x, y });
		}
		for (let i = slots.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[slots[i], slots[j]] = [slots[j], slots[i]];
		}
		nodes = nodes.map((n, i) => ({
			...n,
			x: slots[i].x + Math.round(Math.random() * 24 - 12),
			y: slots[i].y + Math.round(Math.random() * 24 - 12)
		}));
	}
</script>

<p class="hint">
	Oil &amp; gas network — buses are products (crude / gas / refined) ·
	<label><input type="checkbox" bind:checked={zoneOn} /> pipeline maintenance (keepOutLayer)</label>
	— flows detour ·
	<button class="rnd" onclick={randomize}>randomize layout</button>
	— the router just re-routes
</p>
<Knobs bind:res bind:exitCost bind:costOwn bind:costTurn bind:hops bind:showGrid bind:showOccupancy />

<div class="board">
	<GridDiagram
		{edges}
		{opts}
		{hops}
		{showGrid}
		{showOccupancy}
		revision={nodes}
		connStyle={(c) => ({
			color: COLORS[c.bus.split('|')[1] ?? ''] ?? '#8b94a1',
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
			<div class="flow">
				{#if zoneOn}
					<div
						class="zone"
						style:left="{ZONE.l}px"
						style:top="{ZONE.t}px"
						style:width="{ZONE.r - ZONE.l}px"
						style:height="{ZONE.b - ZONE.t}px"
					>
						maintenance
					</div>
				{/if}
				{#each nodes as n (n.id)}
					<div
						class="chip node"
						class:lit={litNodes.has(n.id)}
						class:faded={anyHover && !litNodes.has(n.id)}
						style:left="{n.x}px"
						style:top="{n.y}px"
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
						<small>{n.sub}</small>
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
		width: 760px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 16px;
		--grid-diagram-bg: var(--panel);
	}

	.flow {
		position: relative;
		height: 340px;
	}

	.node {
		position: absolute;
	}

	.node.lit {
		border-color: #5b78b4;
	}

	.node.faded {
		opacity: 0.35;
	}

	.board :global(path.gr-conn.active) {
		stroke-width: 2.2;
	}

	.board :global(path.gr-conn.dim) {
		opacity: 0.15;
	}

	.zone {
		position: absolute;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding-bottom: 4px;
		border: 1px dashed rgba(240, 86, 79, 0.6);
		border-radius: 8px;
		background: repeating-linear-gradient(
			45deg,
			rgba(240, 86, 79, 0.06),
			rgba(240, 86, 79, 0.06) 8px,
			transparent 8px,
			transparent 16px
		);
		color: rgba(240, 86, 79, 0.8);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		pointer-events: none;
	}
</style>
