import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface IpcTokenPayload {
	sessionId: string;
	expiresAt: number;
	nonce: string;
}

export interface IpcAuthManagerOptions {
	secret?: string;
	clock?: () => number;
}

function encodePayload(payload: IpcTokenPayload): string {
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value: string): IpcTokenPayload | null {
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as IpcTokenPayload;
		if (typeof parsed.sessionId !== "string") return null;
		if (typeof parsed.expiresAt !== "number") return null;
		if (typeof parsed.nonce !== "string") return null;
		return parsed;
	} catch {
		return null;
	}
}

export class IpcAuthManager {
	private readonly secret: string;
	private readonly clock: () => number;

	constructor(options: IpcAuthManagerOptions = {}) {
		this.secret = options.secret ?? randomBytes(32).toString("hex");
		this.clock = options.clock ?? (() => Date.now());
	}

	generateToken(sessionId: string, ttlMs = 60_000): string {
		const payload: IpcTokenPayload = {
			sessionId,
			expiresAt: this.clock() + ttlMs,
			nonce: randomBytes(12).toString("hex"),
		};

		const encodedPayload = encodePayload(payload);
		const signature = this.sign(encodedPayload);
		return `${encodedPayload}.${signature}`;
	}

	verifyToken(token: string, expectedSessionId: string): boolean {
		const separator = token.indexOf(".");
		if (separator === -1) {
			return false;
		}

		const payloadPart = token.slice(0, separator);
		const signaturePart = token.slice(separator + 1);
		const expectedSignature = this.sign(payloadPart);

		const provided = Buffer.from(signaturePart);
		const expected = Buffer.from(expectedSignature);
		if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
			return false;
		}

		const payload = decodePayload(payloadPart);
		if (!payload) {
			return false;
		}
		if (payload.sessionId !== expectedSessionId) {
			return false;
		}
		return payload.expiresAt > this.clock();
	}

	private sign(payload: string): string {
		return createHmac("sha256", this.secret).update(payload).digest("base64url");
	}
}
