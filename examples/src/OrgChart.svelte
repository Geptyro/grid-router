<script lang="ts">
	import { GridDiagram, type GridEdge } from 'grid-router/svelte';
	import Knobs from './Knobs.svelte';

	// An organigram: every manager's reports form one bus, so reporting lines
	// merge into shared trunks (the Steiner joins) and hovering any line
	// lights the whole team.
	interface Person {
		id: string;
		name: string;
		role: string;
		dept: 'exec' | 'eng' | 'product' | 'sales';
	}
	const LEVELS: Person[][] = [
		[{ id: 'ceo', name: 'Sam', role: 'CEO', dept: 'exec' }],
		[
			{ id: 'vpe', name: 'Ada', role: 'VP Eng', dept: 'eng' },
			{ id: 'vpp', name: 'Grace', role: 'VP Product', dept: 'product' },
			{ id: 'vps', name: 'Elon', role: 'VP Sales', dept: 'sales' }
		],
		[
			{ id: 'em1', name: 'Linus', role: 'EM Platform', dept: 'eng' },
			{ id: 'em2', name: 'Margaret', role: 'EM Apps', dept: 'eng' },
			{ id: 'pm1', name: 'Alan', role: 'PM', dept: 'product' },
			{ id: 'ae1', name: 'Steve', role: 'AE', dept: 'sales' }
		],
		[
			{ id: 'd1', name: 'Ken', role: 'Dev', dept: 'eng' },
			{ id: 'd2', name: 'Dennis', role: 'Dev', dept: 'eng' },
			{ id: 'd3', name: 'Bjarne', role: 'Dev', dept: 'eng' },
			{ id: 'ds1', name: 'Don', role: 'Designer', dept: 'product' },
			{ id: 'ae2', name: 'Woz', role: 'AE', dept: 'sales' }
		]
	];
	const REPORTS: Record<string, string[]> = {
		ceo: ['vpe', 'vpp', 'vps'],
		vpe: ['em1', 'em2'],
		em1: ['d1', 'd2'],
		em2: ['d3'],
		vpp: ['pm1'],
		pm1: ['ds1'],
		vps: ['ae1'],
		ae1: ['ae2']
	};
	const DEPT_COLORS: Record<Person['dept'], string> = {
		exec: '#3fb950',
		eng: '#6e8fe8',
		product: '#d55181',
		sales: '#c2842f'
	};
	const people = new Map(LEVELS.flat().map((p) => [p.id, p]));
	// bus per (manager, department): color follows the bus — the CEO's lines to
	// three differently-colored VPs must not share one trunk
	const edges: GridEdge[] = Object.entries(REPORTS).flatMap(([mgr, reports]) =>
		reports.map((r) => ({
			id: `${mgr}-${r}`,
			source: mgr,
			target: r,
			bus: people.get(r)?.dept ?? ''
		}))
	);

	// knobs (example defaults)
	let res = $state(12);
	let exitCost = $state(6);
	let costOwn = $state(0.02);
	let costTurn = $state(1);
	let hops = $state(true);
	let showGrid = $state(false);
	let showOccupancy = $state(false);

	// hover a line → the whole team; hover a PERSON → their team(s): reports
	// and manager
	let hoveredBus = $state<string | undefined>(undefined);
	let hoveredNode = $state<string | undefined>(undefined);
	const busKey = (e: GridEdge) => `${e.source}|${e.bus ?? ''}`;
	const activeBuses = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredBus) s.add(hoveredBus);
		else if (hoveredNode) {
			for (const e of edges) {
				if (e.source === hoveredNode || e.target === hoveredNode) s.add(busKey(e));
			}
		}
		return s;
	});
	const anyHover = $derived(activeBuses.size > 0);
	const teamNodes = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredNode) s.add(hoveredNode);
		for (const e of edges) {
			if (activeBuses.has(busKey(e))) {
				s.add(e.source);
				s.add(e.target);
			}
		}
		return s;
	});
</script>

<p class="hint">
	Each manager's reports are one bus → reporting lines merge · hover a line or a person to light
	the whole team
</p>
<Knobs bind:res bind:exitCost bind:costOwn bind:costTurn bind:hops bind:showGrid bind:showOccupancy />

<div class="board">
	<GridDiagram
		{edges}
		opts={{ res, exitCost, costOwn, costTurn }}
		{hops}
		{showGrid}
		{showOccupancy}
		connStyle={(c) => ({
			color: DEPT_COLORS[people.get(c.target)?.dept ?? 'exec'],
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
			{#each LEVELS as level, li (li)}
				<div class="level">
					{#each level as p (p.id)}
						<div
							class="chip person"
							class:lit={teamNodes.has(p.id)}
							class:faded={anyHover && !teamNodes.has(p.id)}
							style:--dept={DEPT_COLORS[p.dept]}
							use:register={p.id}
							onpointerenter={() => {
								hoveredBus = undefined;
								hoveredNode = p.id;
							}}
							onpointerleave={() => {
								if (hoveredNode === p.id) hoveredNode = undefined;
							}}
						>
							<span class="dot"></span>
							{p.name}
							<small>{p.role}</small>
						</div>
					{/each}
				</div>
			{/each}
		{/snippet}
	</GridDiagram>
</div>

<style>
	.hint {
		color: var(--dim);
		font-size: 12px;
		margin: 0 0 14px;
	}

	.board {
		width: 720px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 16px;
		--grid-diagram-bg: var(--panel);
	}

	.level {
		display: flex;
		justify-content: center;
		gap: var(--gr-chip-gap, 16px);
	}

	.level + .level {
		margin-top: var(--gr-row-gap, 44px);
	}

	.person .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--dept);
	}

	.person.lit {
		border-color: var(--dept);
	}

	.person.faded {
		opacity: 0.35;
	}

	.board :global(path.gr-conn.active) {
		stroke-width: 2.2;
	}

	.board :global(path.gr-conn.dim) {
		opacity: 0.15;
	}
</style>
