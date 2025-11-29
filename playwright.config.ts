import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'bun run build && bun run preview',
		port: 4173
	},
	testDir: 'e2e',
	timeout: 120000,
	use: {
		baseURL: 'http://localhost:4173'
	}
});
