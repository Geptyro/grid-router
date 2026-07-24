<script lang="ts">
	import {
		GridDiagram,
		portsLayer,
		withLayers,
		type BoxSide,
		type GridConn,
		type GridEdge
	} from 'grid-router/svelte';
	import Knobs from './Knobs.svelte';

	// A small LED driver schematic with POSITIONED NAMED PORTS: every component
	// declares its pins (bat:+, mcu:pb0, …) as tiny registered pads at the lead
	// tips — edges connect PORTS, the component body registers separately as a
	// pure obstacle. All consumer-side: a port is just a very small chip.
	// Circuits also exercise arrowAt 'none' and the schematic wire-jump hops.
	type Kind = 'battery' | 'switch' | 'cap' | 'resistor' | 'led' | 'ic';
	interface Port {
		name: string;
		x: number;
		y: number;
		side: BoxSide;
	}
	interface Part {
		id: string;
		kind: Kind;
		label: string;
		sub: string;
		color?: string;
		/** lead orientation: rotates the symbol; ports carry the exact pin spots */
		orient: 'h' | 'v';
		ports: Port[];
	}
	const H2: Port[] = [
		{ name: 'a', x: 0, y: 14, side: 'left' },
		{ name: 'b', x: 44, y: 14, side: 'right' }
	];
	const V2: Port[] = [
		{ name: 'a', x: 14, y: 0, side: 'top' },
		{ name: 'b', x: 14, y: 44, side: 'bottom' }
	];
	const PARTS: Part[] = [
		{
			id: 'bat',
			kind: 'battery',
			label: 'BAT1',
			sub: '9V',
			orient: 'h',
			ports: [
				{ name: '-', x: 0, y: 14, side: 'left' },
				{ name: '+', x: 44, y: 14, side: 'right' }
			]
		},
		{ id: 'sw', kind: 'switch', label: 'SW1', sub: 'on/off', orient: 'h', ports: H2 },
		{ id: 'c1', kind: 'cap', label: 'C1', sub: '100nF', orient: 'h', ports: H2 },
		{
			id: 'mcu',
			kind: 'ic',
			label: 'U1',
			sub: 'ATtiny85',
			orient: 'h',
			ports: [
				{ name: 'gnd', x: 0, y: 8, side: 'left' },
				{ name: 'pb0', x: 0, y: 20, side: 'left' },
				{ name: 'vcc', x: 44, y: 8, side: 'right' },
				{ name: 'pb1', x: 44, y: 20, side: 'right' }
			]
		},
		{ id: 'r1', kind: 'resistor', label: 'R1', sub: '220Ω', orient: 'v', ports: V2 },
		{ id: 'r2', kind: 'resistor', label: 'R2', sub: '220Ω', orient: 'v', ports: V2 },
		{
			id: 'led1',
			kind: 'led',
			label: 'LED1',
			sub: 'red',
			color: '#f0564f',
			orient: 'v',
			ports: [
				{ name: 'a', x: 14, y: 0, side: 'top' },
				{ name: 'c', x: 14, y: 44, side: 'bottom' }
			]
		},
		{
			id: 'led2',
			kind: 'led',
			label: 'LED2',
			sub: 'green',
			color: '#3fb950',
			orient: 'v',
			ports: [
				{ name: 'a', x: 14, y: 0, side: 'top' },
				{ name: 'c', x: 14, y: 44, side: 'bottom' }
			]
		}
	];

	const NET_COLORS: Record<string, string> = {
		vcc: '#f0564f',
		gnd: '#8b94a1',
		sig: '#3fb950'
	};

	// netlist: edges connect PORTS
	const edges: GridEdge[] = [
		{ id: 'v1', source: 'bat:+', target: 'sw:a', bus: 'vcc' },
		{ id: 'v2', source: 'sw:b', target: 'mcu:vcc', bus: 'vcc' },
		{ id: 'v3', source: 'sw:b', target: 'c1:a', bus: 'vcc' },
		{ id: 'g1', source: 'bat:-', target: 'mcu:gnd', bus: 'gnd' },
		{ id: 'g2', source: 'bat:-', target: 'c1:b', bus: 'gnd' },
		{ id: 'g3', source: 'bat:-', target: 'led1:c', bus: 'gnd' },
		{ id: 'g4', source: 'bat:-', target: 'led2:c', bus: 'gnd' },
		{ id: 's1', source: 'mcu:pb0', target: 'r1:a', bus: 'sig1' },
		{ id: 's2', source: 'r1:b', target: 'led1:a', bus: 'sig1' },
		{ id: 's3', source: 'mcu:pb1', target: 'r2:a', bus: 'sig2' },
		{ id: 's4', source: 'r2:b', target: 'led2:a', bus: 'sig2' }
	];

	const pid = (p: Part, port: Port) => `${p.id}:${port.name}`;
	const compOf = (id: string) => id.split(':')[0];
	const pins = portsLayer(
		Object.fromEntries(PARTS.flatMap((p) => p.ports.map((port) => [pid(p, port), [port.side]])))
	);

	const colorOf = (c: GridConn) => {
		const net = c.bus.split('|')[1] ?? '';
		return NET_COLORS[net] ?? NET_COLORS.sig;
	};

	// knobs (example defaults)
	let res = $state(10);
	let exitCost = $state(8);
	let costOwn = $state(0.02);
	let costTurn = $state(1);
	let hops = $state(true);
	let showGrid = $state(false);
	let showOccupancy = $state(false);

	// hover a wire → its whole net; hover a COMPONENT → every net on its pins
	let hoveredBus = $state<string | undefined>(undefined);
	let hoveredComp = $state<string | undefined>(undefined);
	const activeBuses = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredBus) s.add(hoveredBus);
		else if (hoveredComp) {
			for (const e of edges) {
				if (compOf(e.source) === hoveredComp || compOf(e.target) === hoveredComp) {
					s.add(`${e.source}|${e.bus}`);
				}
			}
		}
		return s;
	});
	const anyHover = $derived(activeBuses.size > 0);
	const litComps = $derived.by(() => {
		const s = new Set<string>();
		if (hoveredComp) s.add(hoveredComp);
		for (const e of edges) {
			if (activeBuses.has(`${e.source}|${e.bus}`)) {
				s.add(compOf(e.source));
				s.add(compOf(e.target));
			}
		}
		return s;
	});
</script>

{#snippet symbol(kind: Kind, color: string)}
	<svg class="sym" width="44" height="28" viewBox="0 0 44 28" stroke="currentColor" fill="none" stroke-width="1.5">
		{#if kind === 'battery'}
			<path d="M2 14 H16 M28 14 H42" />
			<path d="M19 5 V23" stroke-width="2.4" />
			<path d="M25 9 V19" />
			<path d="M38 8 V4 M36 6 H40" stroke-width="1" />
		{:else if kind === 'switch'}
			<path d="M2 14 H12 M32 14 H42" />
			<circle cx="13.5" cy="14" r="1.7" />
			<circle cx="30.5" cy="14" r="1.7" />
			<path d="M15 13 L29 5" />
		{:else if kind === 'cap'}
			<path d="M2 14 H18 M26 14 H42" />
			<path d="M18 5 V23 M26 5 V23" />
		{:else if kind === 'resistor'}
			<path d="M2 14 H8 M36 14 H42" />
			<path d="M8 14 L11 8 L15 20 L19 8 L23 20 L27 8 L31 20 L34 14" />
		{:else if kind === 'led'}
			<path d="M2 14 H12 M30 14 H42" />
			<path d="M12 6 V22 L28 14 Z" fill="currentColor" fill-opacity="0.25" />
			<path d="M28 6 V22" stroke-width="2" />
			<path d="M20 4 L26 -1 M23 8 L29 3" stroke={color} stroke-width="1.4" />
			<path d="M26 -1 l-3.2 0.6 M26 -1 l-0.6 3.2 M29 3 l-3.2 0.6 M29 3 l-0.6 3.2" stroke={color} stroke-width="1.2" />
		{:else}
			<rect x="8" y="3" width="28" height="22" rx="2" />
			<circle cx="12.5" cy="7.5" r="1.5" />
			<path d="M2 8 H8 M2 14 H8 M2 20 H8 M36 8 H42 M36 14 H42 M36 20 H42" stroke-width="1.2" />
		{/if}
	</svg>
{/snippet}

<p class="hint">
	Positioned NAMED PORTS (bat:+, mcu:pb0 …) as tiny registered pads at the lead tips — the body is
	just an obstacle · hover a wire or a component
</p>
<Knobs bind:res bind:exitCost bind:costOwn bind:costTurn bind:hops bind:showGrid bind:showOccupancy />

<div class="board">
	<GridDiagram
		{edges}
		opts={withLayers({ res, exitCost, costOwn, costTurn }, pins)}
		{hops}
		{showGrid}
		{showOccupancy}
		connStyle={(c) => ({
			color: colorOf(c),
			arrowAt: 'none',
			class: anyHover ? (activeBuses.has(c.bus) ? 'active' : 'dim') : ''
		})}
		onconnenter={(c) => {
			hoveredComp = undefined;
			hoveredBus = c.bus;
		}}
		onconnleave={(c) => {
			if (hoveredBus === c.bus) hoveredBus = undefined;
		}}
	>
		{#snippet children(register)}
			{#snippet part(p: Part)}
				<div
					class="part"
					class:lit={litComps.has(p.id)}
					class:faded={anyHover && !litComps.has(p.id)}
					style:grid-area={p.id}
					style:color={p.color}
					onpointerenter={() => {
						hoveredBus = undefined;
						hoveredComp = p.id;
					}}
					onpointerleave={() => {
						if (hoveredComp === p.id) hoveredComp = undefined;
					}}
				>
					<span class="symwrap" class:vert={p.orient === 'v'} use:register={p.id}>
						{@render symbol(p.kind, p.color ?? 'currentColor')}
						{#each p.ports as port (port.name)}
							<span
								class="pin"
								title="{p.id}:{port.name}"
								style:left="{port.x}px"
								style:top="{port.y}px"
								use:register={pid(p, port)}
							></span>
						{/each}
					</span>
					<span class="ref">{p.label} <small>{p.sub}</small></span>
				</div>
			{/snippet}
			<div class="schematic">
				{#each PARTS as p (p.id)}
					{@render part(p)}
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

	.board {
		width: 660px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 16px;
		--grid-diagram-bg: var(--panel);
	}

	.schematic {
		display: grid;
		grid-template-areas:
			'bat sw c1'
			'. mcu .'
			'r1 . r2'
			'led1 . led2';
		justify-content: space-between;
		justify-items: center;
		row-gap: var(--gr-row-gap, 40px);
	}

	/* schematic parts: bare symbols, no chip box — highlight via color/ring */
	.part {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 3px 6px;
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--text);
		transition:
			opacity 0.12s ease,
			border-color 0.12s ease;
	}

	.sym {
		overflow: visible;
	}

	.symwrap {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* vertical parts: rotate the symbol and reserve the rotated footprint */
	.symwrap.vert {
		width: 28px;
		height: 44px;
	}

	.symwrap.vert .sym {
		transform: rotate(90deg);
	}

	/* a pin: an 8px registered pad centered on the lead tip, drawn as a
	   solder point */
	.pin {
		position: absolute;
		width: 8px;
		height: 8px;
		transform: translate(-50%, -50%);
	}

	.pin::after {
		content: '';
		position: absolute;
		inset: 2.5px;
		border-radius: 50%;
		background: #8b94a1;
	}

	.part.lit .pin::after {
		background: #dbe2ee;
	}

	.ref {
		font-size: 11px;
	}

	.ref small {
		color: var(--dim);
		font-size: 9px;
	}

	.part.lit {
		border-color: #5b78b4;
	}

	.part.faded {
		opacity: 0.3;
	}

	.board :global(path.gr-conn.active) {
		stroke-width: 2.2;
	}

	.board :global(path.gr-conn.dim) {
		opacity: 0.15;
	}
</style>
