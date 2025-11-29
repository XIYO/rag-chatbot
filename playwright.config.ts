import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
	webServer: {
		command: 'bun run build && bun run preview',
		port: 4173,
		timeout: 180000
	},
	testDir: 'e2e',
	timeout: 600000,
	use: {
		baseURL: 'http://localhost:4173'
	}
});
