import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	// GitHub Pages serves the site under /grid-router/ — set by the deploy workflow
	base: process.env.BASE_PATH ?? '/',
	plugins: [svelte({ preprocess: vitePreprocess() })],
	// linked package ships Svelte source — keep it out of prebundling
	optimizeDeps: { exclude: ['grid-router'] },
	server: { port: 5200 }
});
