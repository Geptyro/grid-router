# grid-router

Orthogonal edge routing on a grid for node-link diagrams: A\* with
per-direction cell occupancy, Steiner-style bus joins, and crossing "hops".
Framework-free core + an optional Svelte 5 canvas where **the consumer owns
the chips**.

**[Live examples →](https://geptyro.github.io/grid-router/)**

| Schematic with named ports | Org chart |
| --- | --- |
| ![Electronic circuit example: real schematic symbols with positioned named ports](https://raw.githubusercontent.com/Geptyro/grid-router/main/docs/circuit.png) | ![Org chart example: reporting lines merge into buses per manager](https://raw.githubusercontent.com/Geptyro/grid-router/main/docs/org-chart.png) |

| Oil & gas + cost layers | Radial tree |
| --- | --- |
| ![Oil & gas pipeline example: product buses detouring around a keep-out zone](https://raw.githubusercontent.com/Geptyro/grid-router/main/docs/pipeline.png) | ![Radial tree example: root at the center, color-coded limbs radiating in all directions](https://raw.githubusercontent.com/Geptyro/grid-router/main/docs/radial-tree.png) |

## Concepts

- **Grid & occupancy** — the canvas is rasterized into square cells
  (`res`, default 12px). Node boxes (inflated by `BOX_INFLATE`) hard-block
  cells. Each free cell can host **one horizontal and one vertical** run;
  same-direction reuse by another bus is practically prohibited, perpendicular
  crossings pay a small toll. Lanes separate themselves; crossings happen only
  where they're worth it.
- **Buses & joins** — edges sharing `(source, bus)` form a bus. Later edges of
  a bus seed their search from every cell the bus already routed (cost ~0), so
  branches leave the trunk at the optimal point. `exitCost` prices opening a
  *new* trunk out of a source: raise it to force merges even over shorter
  direct paths.
- **Endpoints are exclusive** — two buses never share a start/goal cell, so
  stubs and arrowheads never stack.
- **Nothing is dropped** — if a dense node row walls the grid off, a desperate
  pass routes through obstacles at a huge cost and the result counts it in
  `violations`. **`violations > 0` is a layout problem, not a router bug**:
  the layout does not supply enough corridor space.
- **Corridor supply** — `corridorGaps(res)` returns the empirically-validated
  minimum `rowGap` / `chipGap` / `sidePad` the *layout* must provide so that
  routing stays violation-free. A chip gap must fit one aligned free cell
  column (`2·res + 2·inflate`); side padding keeps the outer columns routable.
- **Hops** — crossings are disambiguated without geometry: each bus paints a
  background-colored halo under its paths, cutting a small gap into every bus
  drawn before it (the cut line reads as tunneling under). Per-bus grouping
  keeps a bus's own T-junctions intact.
- **Cost layers** — the router is deliberately agnostic of higher-level layout
  concepts (lanes, sections, keep-out zones). `opts.costRegions` lets the
  consumer express them anyway: rects with a per-cell `bias` — positive repels
  routes, negative attracts them (e.g. a "lanes layer" biasing its corridors
  negative). The step cost is floored, so negative biases are safe.
- **Port constraints** — `opts.nodeSides` restricts which box sides a node's
  edges may attach to (schematic pins, side-anchored UML). For POSITIONED
  named ports, register tiny pad elements at the pin locations as their own
  nodes (`mcu:pb0`) and connect edges to those — the body registers separately
  as a pure obstacle (see the circuit example); small boxes are first-class.
- **Pre-built layers** — `withLayers(base, portsLayer(…), keepOutLayer(…),
  corridorLayer(…))` composes declarative routing facts into opts; falsy
  entries are skipped so layers toggle inline
  (`withLayers(base, zoneOn && keepOutLayer([zone]))`).

## Core API (framework-free)

```ts
import { routeGrid, corridorGaps } from 'grid-router';

const result = routeGrid(
  boxes,   // Map<string, GridBox> — measured node rects (t/b/l/r/cx/cy)
  edges,   // { id, source, target, bus?, data? }[]
  width,   // routable canvas size in px
  height,
  { res: 12, costOwn: 0.02, costTurn: 1, exitCost: 0 } // defaults shown
);
// result.conns: { id, source, target, bus, data, d /* SVG path */ }[]
// result.violations: number (0 = clean; see corridorGaps)
// result.bottom, result.debug (occupancy cells for overlays)
```

## Svelte canvas

The component draws **only connectors**. You lay out arbitrary chip markup in
the default snippet and tag each connectable element with the provided
`register` action; chip events stay on your own DOM. Size the component's
container with CSS — it measures itself (no width/height props).

```svelte
<script lang="ts">
  import { GridDiagram, type GridConn } from 'grid-router/svelte';

  let hovered = $state<string | undefined>();
  const edges = [{ id: 'e1', source: 'a', target: 'b', bus: 'ok', data: { tone: 'ok' } }];
</script>

<GridDiagram
  {edges}
  opts={{ res: 12 }}
  connStyle={(c) => ({
    color: (c.data as { tone?: string })?.tone === 'ok' ? '#3fb950' : '#8b94a1',
    dashed: false,
    arrowAt: 'end',
    class: hovered && hovered !== c.id ? 'dim' : ''
  })}
  onconnenter={(c) => (hovered = c.id)}
  onconnleave={() => (hovered = undefined)}
  onrouted={({ violations, ms }) => console.log(violations, ms)}
>
  {#snippet children(register)}
    <div class="my-layout">
      <div use:register={'a'}>chip A</div>
      <div use:register={'b'}>chip B</div>
    </div>
  {/snippet}
</GridDiagram>

<style>
  /* consumer-driven highlight: connStyle classes land on package paths */
  :global(path.dim) { opacity: 0.15; }
</style>
```

Layout contract: use the published CSS vars `--gr-row-gap` / `--gr-chip-gap`
(from `corridorGaps(res)`) as your row/chip gaps, and set `--grid-diagram-bg`
to your panel background so crossing hops cut with the right color.

## Examples

Live at **https://geptyro.github.io/grid-router/**, or locally:

```sh
cd examples && npm install && npm run dev   # http://localhost:5200
```

- **Electronic circuit** — real schematic symbols with POSITIONED NAMED PORTS
  (`bat:+`, `mcu:pb0` — tiny registered pads at the lead tips; the body is
  just an obstacle); nets as buses (VCC/GND rails share trunks), no
  arrowheads (`arrowAt: 'none'`), hover a wire to trace its whole net.
- **Org chart** — one bus per manager, reporting lines merge; hover a line or
  a person to light the whole team.
- **Oil & gas + cost layers** — absolutely-positioned network, buses per
  product; toggle a maintenance keep-out zone (`keepOutLayer`) and watch the
  flows detour, or hit *randomize layout* — chips scatter and the router
  re-routes live (the `revision` prop triggers re-measure when chips move
  without resizing the canvas).
- **Radial tree** — a mind map: root at the CENTER, color-coded limbs
  radiating in all directions via polar placement; each parent's children are
  one bus, so limbs fuse near the trunk (drive it with the merge knob).
  *Randomize tree* regenerates the whole topology.

## Development

```sh
npm install
npm run build   # tsc → dist (core)
npm test        # vitest
```

The Svelte entry ships as source (`src/svelte`) and is compiled by the
consumer's bundler (Vite + svelte plugin resolve the `svelte` export
condition).
