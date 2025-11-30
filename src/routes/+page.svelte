<script lang="ts">
	import { tick } from 'svelte';
	import { marked } from 'marked';
	import markedFootnote from 'marked-footnote';

	marked.use(markedFootnote());
	import { SendHorizontal, Square, Copy, Check, Brain, Search, FileText, File as FileIcon, ChevronDown, BookOpen, Wrench, MessageSquare } from '@lucide/svelte';
	import { Tooltip, Collapsible } from 'bits-ui';
	import { getFileHash } from '$lib/client/hash';
	import { sendMessage as sendMessageRemote } from './chat.remote';
	import { uploadFile } from './embedding.remote';
	import { sessionFiles } from './file.remote';
	import type { ThinkingStep, DocumentReference } from '$lib/server/chat/state';

	interface Message {
		id: string;
		role: 'user' | 'assistant';
		content: string;
		suggestions?: string[];
		thinkingSteps?: ThinkingStep[];
		documentReferences?: DocumentReference[];
	}

	interface UploadedFile {
		id: string;
		name: string;
		status: 'uploading' | 'done' | 'linked' | 'error';
		stage?: string;
		chunksCount?: number;
		message?: string;
	}

	interface SessionFile {
		id: string;
		filename: string;
		topic: string | null;
		context: string | null;
		suggested_questions: string[] | null;
	}

	const UPLOAD_STAGES = ['해시 계산중...', '중복 확인중...', '파일 저장중...', '임베딩중...'];

	let messages = $state<Message[]>([]);
	let inputValue = $state('');
	let files = $state<UploadedFile[]>([]);
	let isLoading = $state(false);
	let loadingStage = $state('');
	let abortController: AbortController | null = null;
	let sessionId = $state('');
	let uploadFormRef: HTMLFormElement | null = $state(null);
	let pendingFile: { file: File; id: string } | null = $state(null);
	let sessionFileData = $state<SessionFile[]>([]);
	let copiedMessageId = $state<string | null>(null);
	async function copyMessage(messageId: string, content: string) {
		await navigator.clipboard.writeText(content);
		copiedMessageId = messageId;
		setTimeout(() => {
			copiedMessageId = null;
		}, 2000);
	}

	const suggestedQuestions = $derived(
		sessionFileData.flatMap((f) => f.suggested_questions ?? [])
	);

	$effect(() => {
		sessionId = crypto.randomUUID();
	});

	async function refreshFiles() {
		if (sessionId) {
			const result = await sessionFiles({ sessionId });
			sessionFileData = result.map((f) => ({
				...f,
				suggested_questions: f.suggested_questions as string[] | null
			}));
		}
	}

	function selectQuestion(question: string) {
		inputValue = question;
		sendMessage();
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) {
			handleFiles(input.files);
		}
	}

	async function handleFiles(fileList: FileList) {
		for (const file of fileList) {
			const id = crypto.randomUUID();
			files.push({
				id,
				name: file.name,
				status: 'uploading',
				stage: UPLOAD_STAGES[0]
			});

			try {
				const hash = await getFileHash(file);
				updateFileStage(id, UPLOAD_STAGES[1]);

				const checkResponse = await fetch('/api/files/check', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ hash, chatId: sessionId })
				});
				const checkResult = await checkResponse.json();

				if (checkResult.exists) {
					updateFileStatus(id, 'linked', undefined, '기존 파일과 연결됨');
					await refreshFiles();
					continue;
				}

				updateFileStage(id, UPLOAD_STAGES[2]);
				updateFileStage(id, UPLOAD_STAGES[3]);

				pendingFile = { file, id };
				await tick();

				const fileInput = uploadFormRef?.querySelector('input[type="file"]') as HTMLInputElement;
				if (fileInput) {
					const dataTransfer = new DataTransfer();
					dataTransfer.items.add(file);
					fileInput.files = dataTransfer.files;
				}

				uploadFormRef?.requestSubmit();
			} catch {
				updateFileStatus(id, 'error');
			}
		}
	}

	function updateFileStage(id: string, stage: string) {
		const fileIndex = files.findIndex((f) => f.id === id);
		if (fileIndex !== -1 && files[fileIndex].status === 'uploading') {
			files[fileIndex].stage = stage;
		}
	}

	function updateFileStatus(id: string, status: UploadedFile['status'], chunksCount?: number, message?: string) {
		const fileIndex = files.findIndex((f) => f.id === id);
		if (fileIndex !== -1) {
			files[fileIndex].status = status;
			files[fileIndex].chunksCount = chunksCount;
			files[fileIndex].message = message;
			files[fileIndex].stage = undefined;
		}
	}

	function removeFile(id: string) {
		files = files.filter((f) => f.id !== id);
	}

	async function sendMessage() {
		if (!inputValue.trim() || isLoading) return;

		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content: inputValue.trim()
		};

		messages.push(userMessage);
		const messageContent = inputValue.trim();
		inputValue = '';
		isLoading = true;
		loadingStage = '처리중...';
		abortController = new AbortController();

		try {
			const response = await sendMessageRemote({
				message: messageContent,
				sessionId
			});
			messages.push(response);
		} catch (error) {
			if ((error as Error).name !== 'AbortError') {
				messages.push({
					id: crypto.randomUUID(),
					role: 'assistant',
					content: '오류가 발생했습니다. 다시 시도해주세요.'
				});
			}
		} finally {
			isLoading = false;
			loadingStage = '';
			abortController = null;
		}
	}

	function cancelMessage() {
		abortController?.abort();
		isLoading = false;
		loadingStage = '';
		abortController = null;
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}
</script>

<Tooltip.Provider delayDuration={200}>
	<div class="flex h-screen flex-col bg-surface-50 dark:bg-surface-900">
		<header class="border-surface-200 dark:border-surface-700 flex items-center border-b p-4">
			<h1 class="text-xl font-bold">RAG Chatbot</h1>
		</header>

	{#if files.length > 0}
		<div class="border-surface-200 dark:border-surface-700 flex flex-wrap gap-2 border-b p-3">
			{#each files as file (file.id)}
				<div
					class="flex items-center gap-2 rounded-lg px-3 py-2 {file.status === 'uploading' ? 'animate-pulse bg-primary-100 dark:bg-primary-900' : file.status === 'error' ? 'bg-error-100 dark:bg-error-900' : 'bg-surface-200 dark:bg-surface-700'}"
				>
					{#if file.name.endsWith('.pdf')}
						<FileIcon class="h-4 w-4 shrink-0 text-error-500" />
					{:else if file.name.endsWith('.txt')}
						<FileText class="h-4 w-4 shrink-0 text-primary-500" />
					{:else}
						<FileIcon class="h-4 w-4 shrink-0 text-surface-500" />
					{/if}
					<span class="max-w-32 truncate text-sm">{file.name}</span>
					<button
						type="button"
						onclick={() => removeFile(file.id)}
						class="hover:text-error-500 text-surface-500"
					>
						X
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<main class="flex-1 overflow-y-auto p-4">
		{#if messages.length === 0}
			<div class="flex h-full flex-col items-center justify-center">
				{#if suggestedQuestions.length > 0}
					<p class="text-surface-500 mb-6 text-lg">이런 질문을 해보세요</p>
					<div class="flex max-w-2xl flex-wrap justify-center gap-3">
						{#each suggestedQuestions as question}
							<button
								type="button"
								class="btn preset-outlined text-left"
								onclick={() => selectQuestion(question)}
							>
								{question}
							</button>
						{/each}
					</div>
				{:else}
					<p class="text-surface-500 text-lg">문서를 먼저 업로드 하세요</p>
				{/if}
			</div>
		{:else}
			<div class="mx-auto max-w-3xl space-y-4">
				{#each messages as message (message.id)}
					<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
						{#if message.role === 'user'}
							<div
								class="bg-primary-500 max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-white"
							>
								{message.content}
							</div>
						{:else}
							<div class="flex max-w-[80%] flex-col gap-3">
								{#if message.thinkingSteps && message.thinkingSteps.length > 0}
									<Collapsible.Root class="bg-surface-100 dark:bg-surface-800 rounded-xl text-sm">
										<Collapsible.Trigger class="text-surface-500 flex w-full items-center justify-between p-3 text-xs font-medium hover:bg-surface-200 dark:hover:bg-surface-700 rounded-xl transition-colors">
											<div class="flex items-center gap-1.5">
												<Brain class="h-3.5 w-3.5" />
												에이전트 추론 과정
											</div>
											<ChevronDown class="h-4 w-4 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
										</Collapsible.Trigger>
										<Collapsible.Content class="px-3 pb-3">
											<div class="space-y-2">
												{#each message.thinkingSteps as step}
													<div class="flex items-start gap-2">
														{#if step.type === 'tool_call'}
															<Wrench class="text-warning-500 mt-0.5 h-4 w-4 shrink-0" />
														{:else if step.type === 'tool_result'}
															<Search class="text-success-500 mt-0.5 h-4 w-4 shrink-0" />
														{:else}
															<MessageSquare class="text-primary-500 mt-0.5 h-4 w-4 shrink-0" />
														{/if}
														<span class="text-surface-600 dark:text-surface-300 whitespace-pre-wrap text-xs">{step.content}</span>
													</div>
												{/each}
											</div>
										</Collapsible.Content>
									</Collapsible.Root>
								{/if}
								{#if message.documentReferences?.some(r => r.cited)}
									<Collapsible.Root class="bg-surface-100 dark:bg-surface-800 rounded-xl text-sm">
										<Collapsible.Trigger class="text-surface-500 flex w-full items-center justify-between p-3 text-xs font-medium hover:bg-surface-200 dark:hover:bg-surface-700 rounded-xl transition-colors">
											<div class="flex items-center gap-1.5">
												<BookOpen class="h-3.5 w-3.5" />
												인용된 참조 ({message.documentReferences.filter(r => r.cited).length}개)
											</div>
											<ChevronDown class="h-4 w-4 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
										</Collapsible.Trigger>
										<Collapsible.Content class="px-3 pb-3">
											<div class="space-y-3">
												{#each message.documentReferences.filter(r => r.cited) as ref}
													<div class="bg-surface-50 dark:bg-surface-900 rounded-lg p-3 border-l-2 border-primary-500">
														<div class="flex items-center justify-between mb-2">
															<span class="text-xs font-medium text-primary-500">[{ref.id}]</span>
															<span class="text-xs text-surface-500">p.{ref.pageNumber}</span>
														</div>
														<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed line-clamp-4">
															{ref.content}
														</p>
													</div>
												{/each}
											</div>
										</Collapsible.Content>
									</Collapsible.Root>
								{/if}
								{#if message.documentReferences?.some(r => !r.cited)}
									<Collapsible.Root class="bg-surface-100 dark:bg-surface-800 rounded-xl text-sm">
										<Collapsible.Trigger class="text-surface-500 flex w-full items-center justify-between p-3 text-xs font-medium hover:bg-surface-200 dark:hover:bg-surface-700 rounded-xl transition-colors">
											<div class="flex items-center gap-1.5">
												<FileText class="h-3.5 w-3.5" />
												추가 검색 결과 ({message.documentReferences.filter(r => !r.cited).length}개)
											</div>
											<ChevronDown class="h-4 w-4 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
										</Collapsible.Trigger>
										<Collapsible.Content class="px-3 pb-3">
											<div class="space-y-3">
												{#each message.documentReferences.filter(r => !r.cited) as ref}
													<div class="bg-surface-50 dark:bg-surface-900 rounded-lg p-3 opacity-75">
														<div class="flex items-center justify-between mb-2">
															<span class="text-xs font-medium text-surface-400">[{ref.id}]</span>
															<span class="text-xs text-surface-500">p.{ref.pageNumber}</span>
														</div>
														<p class="text-xs text-surface-600 dark:text-surface-300 leading-relaxed line-clamp-3">
															{ref.content}
														</p>
													</div>
												{/each}
											</div>
										</Collapsible.Content>
									</Collapsible.Root>
								{/if}
								<div
									class="prose prose-sm dark:prose-invert bg-surface-200 dark:bg-surface-700 rounded-2xl px-4 py-2"
								>
									{@html marked.parse(message.content)}
								</div>
								<div class="flex items-center gap-2">
									<button
										type="button"
										class="flex items-center gap-1.5 rounded px-2 py-1 text-sm transition-all {copiedMessageId === message.id ? 'bg-success-100 dark:bg-success-900 text-success-600 dark:text-success-400' : 'bg-surface-100 dark:bg-surface-800 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700'}"
										onclick={() => copyMessage(message.id, message.content)}
									>
										{#if copiedMessageId === message.id}
											<Check class="h-4 w-4" />
											<span>복사됨</span>
										{:else}
											<Copy class="h-4 w-4" />
											<span>복사</span>
										{/if}
									</button>
								</div>
								{#if message.suggestions && message.suggestions.length > 0}
									<div class="flex flex-wrap gap-2">
										{#each message.suggestions as suggestion}
											<button
												type="button"
												class="btn preset-outlined-primary-500 text-left text-sm"
												onclick={() => selectQuestion(suggestion)}
											>
												{suggestion}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
				{#if isLoading}
					<div class="flex justify-start">
						<div class="bg-surface-200 dark:bg-surface-700 flex items-center gap-2 rounded-2xl px-4 py-2">
							<span
								class="border-primary-500 h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
							></span>
							<span class="text-primary-500">{loadingStage || '처리중...'}</span>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</main>

	{#if sessionId}
		<form
			bind:this={uploadFormRef}
			class="hidden"
			enctype="multipart/form-data"
			{...uploadFile.enhance(async ({ submit }) => {
				const currentFile = pendingFile;
				try {
					await submit();
					if (uploadFile.result && currentFile) {
						updateFileStatus(currentFile.id, 'done', uploadFile.result.chunksCount);
						await refreshFiles();
					}
				} catch {
					if (currentFile) {
						updateFileStatus(currentFile.id, 'error');
					}
				} finally {
					pendingFile = null;
				}
			})}
		>
			<input type="hidden" name="sessionId" value={sessionId} />
			<input type="hidden" name="fileName" value={pendingFile?.file.name ?? ''} />
			<input type="file" name="file" />
		</form>
	{/if}

	<footer class="border-surface-200 dark:border-surface-700 border-t p-4">
		<div class="mx-auto flex max-w-3xl gap-2">
			<label class="btn preset-outlined cursor-pointer">
				<input type="file" class="hidden" accept=".pdf,.txt" multiple onchange={handleFileInput} />
				+
			</label>
			<input
				data-sveltekit-keepfocus
				type="text"
				class="input flex-1"
				placeholder="메시지를 입력하세요..."
				bind:value={inputValue}
				onkeydown={handleKeyDown}
			/>
			{#if isLoading}
				<button type="button" class="btn preset-filled-error-500 w-20" onclick={cancelMessage}>
					<Square class="h-4 w-4" />
					중지
				</button>
			{:else}
				<button
					type="button"
					class="btn preset-filled w-20"
					onclick={sendMessage}
					disabled={!inputValue.trim()}
				>
					<SendHorizontal class="h-4 w-4" />
					전송
				</button>
			{/if}
		</div>
	</footer>
	</div>
</Tooltip.Provider>
