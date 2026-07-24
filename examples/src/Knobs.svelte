<script lang="ts">
	// Shared router-tuning bar: each example embeds it with its own defaults.
	let {
		res = $bindable(12),
		exitCost = $bindable(0),
		costOwn = $bindable(0.02),
		costTurn = $bindable(1),
		hops = $bindable(true),
		showGrid = $bindable(false),
		showOccupancy = $bindable(false)
	}: {
		res?: number;
		exitCost?: number;
		costOwn?: number;
		costTurn?: number;
		hops?: boolean;
		showGrid?: boolean;
		showOccupancy?: boolean;
	} = $props();
</script>

<div class="knobs">
	<label>
		cell
		<select bind:value={res}>
			{#each [6, 8, 10, 12, 16] as v (v)}
				<option value={v}>{v}px</option>
			{/each}
		</select>
	</label>
	<label>
		merge
		<select bind:value={exitCost}>
			{#each [0, 2, 4, 6, 8, 16] as v (v)}
				<option value={v}>{v}</option>
			{/each}
		</select>
	</label>
	<label>
		ride
		<select bind:value={costOwn}>
			{#each [0.02, 0.08, 0.3, 1] as v (v)}
				<option value={v}>{v}</option>
			{/each}
		</select>
	</label>
	<label>
		turn
		<select bind:value={costTurn}>
			{#each [1, 2, 3, 6] as v (v)}
				<option value={v}>{v}</option>
			{/each}
		</select>
	</label>
	<label><input type="checkbox" bind:checked={hops} /> hops</label>
	<label><input type="checkbox" bind:checked={showGrid} /> grid</label>
	<label><input type="checkbox" bind:checked={showOccupancy} /> occupancy</label>
</div>

<style>
	.knobs {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 14px;
		margin: 0 0 14px;
		font-size: 12px;
		color: var(--dim);
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	select {
		background: #1c2230;
		color: var(--text);
		border: 1px solid #39445c;
		border-radius: 5px;
		padding: 1px 4px;
		font: inherit;
	}
</style>
