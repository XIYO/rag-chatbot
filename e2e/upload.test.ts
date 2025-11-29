import { chromium } from '@playwright/test';

const filePath = '/Users/gimtaehui/IdeaProjects/rag-chatbot/Market+Sharing+about+AI+Agent+-+Erica+Yu (2).pdf';

async function testUpload() {
	const browser = await chromium.launch({ headless: false });
	const page = await browser.newPage();

	page.on('console', msg => console.log('[Browser]', msg.type(), msg.text()));
	page.on('pageerror', err => console.log('[PageError]', err.message));

	console.log('Navigating to localhost:5173...');
	await page.goto('http://localhost:5173');
	await page.waitForLoadState('networkidle');

	console.log('Looking for file input...');
	const fileInput = page.locator('input[type="file"][accept=".pdf,.txt"]');

	console.log('Uploading file:', filePath);
	await fileInput.setInputFiles(filePath);

	console.log('Waiting for suggested questions to appear...');
	await page.waitForSelector('button:has-text("AI 에이전트")', { timeout: 90000 }).catch(() => {
		console.log('Suggested questions not found, taking screenshot anyway...');
	});

	await page.waitForTimeout(2000);

	console.log('Taking screenshot...');
	await page.screenshot({ path: '/tmp/upload-result.png', fullPage: true });

	console.log('Done. Screenshot saved to /tmp/upload-result.png');
	await browser.close();
}

testUpload().catch(console.error);
