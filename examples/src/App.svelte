<script lang="ts">
	import Circuit from './Circuit.svelte';
	import OrgChart from './OrgChart.svelte';
	import Pipeline from './Pipeline.svelte';

	const TABS = [
		{ key: 'circuit', title: 'Electronic circuit' },
		{ key: 'org', title: 'Org chart' },
		{ key: 'pipeline', title: 'Pipeline + cost layers' }
	] as const;
	let tab = $state<(typeof TABS)[number]['key']>('circuit');
</script>

<header>
	<h1>grid-router examples</h1>
	<nav>
		{#each TABS as t (t.key)}
			<button class:active={tab === t.key} onclick={() => (tab = t.key)}>{t.title}</button>
		{/each}
	</nav>
</header>

<main>
	{#if tab === 'circuit'}
		<Circuit />
	{:else if tab === 'org'}
		<OrgChart />
	{:else}
		<Pipeline />
	{/if}
</main>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 12px 20px;
		border-bottom: 1px solid var(--border);
	}

	h1 {
		margin: 0;
		font-size: 15px;
	}

	nav {
		display: flex;
		gap: 8px;
	}

	button {
		background: var(--panel);
		color: var(--dim);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 4px 12px;
		font: inherit;
		cursor: pointer;
	}

	button.active {
		color: var(--text);
		border-color: #5b78b4;
	}

	main {
		padding: 20px;
	}
</style>
