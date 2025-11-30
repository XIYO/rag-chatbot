import type { HandleServerError } from '@sveltejs/kit';

export const handleError: HandleServerError = ({ error, event }) => {
	console.error('[Server Error]', event.url.pathname, error);
	return {
		message: 'Internal Error',
		code: 'INTERNAL_ERROR'
	};
};
