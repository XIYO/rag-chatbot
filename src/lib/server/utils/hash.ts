import { createHash } from 'crypto';

export function getFileHash(buffer: ArrayBuffer) {
	return createHash('sha256').update(Buffer.from(buffer)).digest('hex');
}
