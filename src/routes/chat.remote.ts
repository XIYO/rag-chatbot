import { command } from '$app/server';
import * as v from 'valibot';
import { chat } from '$lib/server/chat.service';

const ChatInput = v.object({
	message: v.pipe(v.string(), v.nonEmpty()),
	sessionId: v.string()
});

export const sendMessage = command(ChatInput, async ({ message, sessionId }) => {
	return await chat(sessionId, message);
});
