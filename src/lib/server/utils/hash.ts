import { createHash } from 'crypto';

/**
 * ArrayBuffer의 SHA-256 해시를 생성한다.
 * @param buffer 해시할 데이터
 * @returns 16진수 해시 문자열
 */
export function getFileHash(buffer: ArrayBuffer) {
	return createHash('sha256').update(Buffer.from(buffer)).digest('hex');
}
