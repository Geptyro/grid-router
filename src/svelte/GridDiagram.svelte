<script lang="ts">
	import type { Snippet } from 'svelte';
	import { corridorGaps } from '../corridors.js';
	import {
		routeGrid,
		type GridBox,
		type GridConn,
		type GridDebugCell,
		type GridEdge,
		type GridOpts
	} from '../router.js';
	import type { ConnStyle, RoutedInfo } from './types.js';

	/**
	 * Generic grid-routed diagram canvas.
	 *
	 * The CONSUMER owns the chips: lay out any markup inside the default
	 * snippet and tag each connectable element with the provided `register`
	 * action (`use:register={'node-id'}`). The component measures registered
	 * elements, routes the edges on a grid, and draws the connector overlay.
	 * Chip events belong to the consumer's own DOM; connector events are
	 * surfaced via the onconn* callbacks, and per-connector styling (color,
	 * dash, arrow end, highlight classes) via the reactive `connStyle` hook.
	 *
	 * The canvas is sized by the consumer like any element — the component
	 * measures its own container; there is no width/height prop.
	 */
	type Register = (el: HTMLElement, id: string) => { destroy(): void };

	let {
		edges,
		opts = {},
		connStyle,
		hops = true,
		showGrid = false,
		showOccupancy = false,
		extraHeight = 40,
		revision = undefined,
		onrouted,
		onconnenter,
		onconnleave,
		onconnclick,
		children
	}: {
		edges: GridEdge[];
		opts?: GridOpts;
		/** per-connector rendering directives; called reactively */
		connStyle?: (conn: GridConn) => ConnStyle;
		/** crossing disambiguation: each bus cuts a small gap into the buses it
		 * crosses (the cut line "tunnels" under) */
		hops?: boolean;
		showGrid?: boolean;
		showOccupancy?: boolean;
		/** extra routable px below the content */
		extraHeight?: number;
		/** bump/replace to force a re-measure + re-route when chips MOVE without
		 * the canvas resizing (dynamic layouts) — pass e.g. your positions array */
		revision?: unknown;
		onrouted?: (info: RoutedInfo) => void;
		onconnenter?: (conn: GridConn) => void;
		onconnleave?: (conn: GridConn) => void;
		onconnclick?: (conn: GridConn, ev: MouseEvent) => void;
		children: Snippet<[Register]>;
	} = $props();

	const uid = $props.id();
	const res = $derived(opts.res ?? 12);
	const gaps = $derived(corridorGaps(res));

	const DEFAULT_COLOR = '#8b94a1';
	const styleOf = (c: GridConn): Required<ConnStyle> => {
		const s = connStyle?.(c) ?? {};
		return {
			color: s.color ?? DEFAULT_COLOR,
			dashed: s.dashed ?? false,
			arrowAt: s.arrowAt ?? 'end',
			class: s.class ?? ''
		};
	};

	// --- measure registered chips, route, expose results ---
	let canvasEl = $state<HTMLElement>();
	const chipEls = new Map<string, HTMLElement>();
	let conns = $state<GridConn[]>([]);
	let debugCells = $state<GridDebugCell[]>([]);
	let violations = $state(0);
	let svgW = $state(0);
	let svgH = $state(0);
	let overhang = $state(16);

	let raf = 0;
	function scheduleMeasure() {
		if (typeof requestAnimationFrame === 'undefined') return;
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(measure);
	}

	const register: Register = (el, id) => {
		chipEls.set(id, el);
		scheduleMeasure();
		return {
			destroy() {
				chipEls.delete(id);
				scheduleMeasure();
			}
		};
	};

	function measure() {
		const canvas = canvasEl;
		if (!canvas) return;
		const base = canvas.getBoundingClientRect();
		const boxes = new Map<string, GridBox>();
		for (const [id, el] of chipEls) {
			const r = el.getBoundingClientRect();
			boxes.set(id, {
				t: r.top - base.top,
				b: r.bottom - base.top,
				l: r.left - base.left,
				r: r.right - base.left,
				cx: r.left - base.left + r.width / 2,
				cy: r.top - base.top + r.height / 2
			});
		}
		// The grid must cover chips that OVERFLOW the canvas horizontally (a
		// scrolling consumer clips base.width to the viewport): an off-grid chip
		// gets its ring clamped onto the last on-grid column, where the stacked
		// stubs collide as lane violations. Route the full content extent plus a
		// routable side margin, so the rightmost chips keep an outer corridor.
		const contentRight = Math.max(0, ...[...boxes.values()].map((b) => b.r));
		const w = Math.max(base.width, Math.ceil(contentRight + gaps.sidePad));
		const t0 = performance.now();
		const routed = routeGrid(boxes, edges, w, canvas.scrollHeight + extraHeight, opts);
		const ms = Math.round((performance.now() - t0) * 10) / 10;
		conns = routed.conns;
		violations = routed.violations;
		debugCells = routed.debug.cells;
		const contentBottom = Math.max(0, ...[...boxes.values()].map((b) => b.b));
		overhang = Math.max(16, Math.ceil(routed.bottom - contentBottom + 10));
		svgW = w;
		svgH = Math.max(canvas.scrollHeight, Math.ceil(routed.bottom + 10));
		onrouted?.({ conns: routed.conns, violations: routed.violations, ms });
	}

	$effect(() => {
		void edges;
		void opts;
		void revision;
		scheduleMeasure();
	});

	$effect(() => {
		const canvas = canvasEl;
		if (!canvas || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => scheduleMeasure());
		ro.observe(canvas);
		return () => ro.disconnect();
	});

	// One marker pair (normal + start-reversed) per distinct color.
	const markerColors = $derived([...new Set(conns.map((c) => styleOf(c).color))]);
	const markerId = (color: string, rev: boolean) =>
		`gr-arrow${rev ? '-rev' : ''}-${uid}-${markerColors.indexOf(color)}`;

	// Bus groups for crossing "hops": each group paints a background halo under
	// its colored paths, cutting a gap into every EARLIER bus it crosses — the
	// cut line reads as tunneling under. Per-bus grouping keeps a bus's own
	// T-junctions intact (its color always repaints over its own halo).
	const busGroups = $derived.by(() => {
		const m = new Map<string, GridConn[]>();
		for (const c of conns) {
			const arr = m.get(c.bus);
			if (arr) arr.push(c);
			else m.set(c.bus, [c]);
		}
		return [...m.values()];
	});

	const hasConnEvents = $derived(!!(onconnenter || onconnleave || onconnclick));
</script>

<div
	class="gr-canvas"
	bind:this={canvasEl}
	style:padding-bottom="{overhang}px"
	style:padding-inline="{gaps.sidePad}px"
	style:--gr-row-gap="{gaps.rowGap}px"
	style:--gr-chip-gap="{gaps.chipGap}px"
>
	<svg class="gr-connectors" width={svgW} height={svgH} viewBox="0 0 {svgW} {svgH}" aria-hidden="true">
		{#if showGrid}
			<defs>
				<pattern id="gr-grid-{uid}" width={res} height={res} patternUnits="userSpaceOnUse">
					<path d="M {res} 0 L 0 0 0 {res}" fill="none" stroke="currentColor" stroke-width="0.4" />
				</pattern>
			</defs>
			<rect width={svgW} height={svgH} class="gr-grid-fill" fill="url(#gr-grid-{uid})" />
		{/if}
		{#if showOccupancy}
			{#each debugCells as c (c.y * 100000 + c.x)}
				<rect class="gr-occ gr-occ-{c.kind}" x={c.x * res} y={c.y * res} width={res} height={res} />
			{/each}
		{/if}
		<defs>
			{#each markerColors as color, i (color)}
				<marker
					id="gr-arrow-{uid}-{i}"
					markerWidth="8"
					markerHeight="7"
					refX="7"
					refY="3.5"
					orient="auto"
					markerUnits="userSpaceOnUse"
				>
					<path d="M1,1 L7,3.5 L1,6 Z" fill={color} />
				</marker>
				<marker
					id="gr-arrow-rev-{uid}-{i}"
					markerWidth="8"
					markerHeight="7"
					refX="7"
					refY="3.5"
					orient="auto-start-reverse"
					markerUnits="userSpaceOnUse"
				>
					<path d="M1,1 L7,3.5 L1,6 Z" fill={color} />
				</marker>
			{/each}
		</defs>
		{#each busGroups as group, gi (gi)}
			<g>
				{#if hops}
					<!-- halo capped below the lane pitch so it can't eat an
					     adjacent lane at small cell sizes -->
					{#each group as c (`${c.id}:halo`)}
						<path class="gr-halo" style:stroke-width="{Math.min(5.5, res - 1.5)}px" d={c.d} />
					{/each}
				{/if}
				{#each group as c (c.id)}
					{@const s = styleOf(c)}
					<path
						class="gr-conn {s.class}"
						d={c.d}
						stroke={s.color}
						stroke-dasharray={s.dashed ? '4 3' : undefined}
						marker-start={s.arrowAt === 'start' ? `url(#${markerId(s.color, true)})` : undefined}
						marker-end={s.arrowAt === 'end' ? `url(#${markerId(s.color, false)})` : undefined}
					/>
				{/each}
			</g>
		{/each}
	</svg>

	<div class="gr-content">
		{@render children(register)}
	</div>

	{#if hasConnEvents}
		<!-- Invisible wide hit paths so thin connectors are hoverable. Own layer
		     ABOVE the content: the content div would otherwise swallow pointer
		     events over the whole canvas. Safe because routed paths never run
		     under chips and hit strokes end short of chip edges. -->
		<svg class="gr-hits" width={svgW} height={svgH} viewBox="0 0 {svgW} {svgH}" aria-hidden="true">
			<!-- hit zone = the arrow's LANE: one cell wide, matching the territory
			     occupancy reserved for it — zones never overlap ambiguously -->
			{#each conns as c (`${c.id}:hit`)}
				<path
					class="gr-hit"
					style:stroke-width="{res}px"
					d={c.d}
					role="presentation"
					onpointerenter={() => onconnenter?.(c)}
					onpointerleave={() => onconnleave?.(c)}
					onclick={(ev) => onconnclick?.(c, ev)}
				/>
			{/each}
		</svg>
	{/if}
</div>

{#if violations > 0}
	<div class="gr-violations" role="status">
		{violations} lane violation{violations === 1 ? '' : 's'} — corridor supply too tight (see
		corridorGaps)
	</div>
{/if}

<style>
	/* Positioning context for the connector overlay. Side padding keeps the
	   outer grid columns routable; bottom padding reserves the routed extent.
	   --gr-row-gap / --gr-chip-gap are published for the consumer's layout. */
	.gr-canvas {
		position: relative;
	}

	.gr-connectors {
		position: absolute;
		top: 0;
		left: 0;
		overflow: visible;
		pointer-events: none;
		z-index: 0;
	}

	.gr-content {
		position: relative;
		z-index: 1;
	}

	.gr-conn {
		fill: none;
		stroke-width: 1.3;
	}

	/* Crossing hop: background-colored halo painted under each bus; set
	   --grid-diagram-bg to the page/panel background color. */
	.gr-halo {
		fill: none;
		stroke: var(--grid-diagram-bg, #ffffff);
	}

	.gr-hits {
		position: absolute;
		top: 0;
		left: 0;
		overflow: visible;
		pointer-events: none;
		z-index: 2;
	}

	.gr-hit {
		fill: none;
		stroke: transparent;
		pointer-events: stroke;
	}

	.gr-grid-fill {
		color: currentColor;
		opacity: 0.15;
	}

	.gr-occ {
		opacity: 0.22;
	}

	.gr-occ-chip {
		fill: #8b94a1;
	}

	.gr-occ-h {
		fill: #6e8fe8;
	}

	.gr-occ-v {
		fill: #d55181;
	}

	.gr-occ-hv {
		fill: #c2842f;
	}

	.gr-occ-bad {
		fill: #f0564f;
		opacity: 0.8;
	}

	.gr-violations {
		margin-top: 6px;
		font-size: 11px;
		font-weight: 700;
		color: #f0564f;
	}
</style>
