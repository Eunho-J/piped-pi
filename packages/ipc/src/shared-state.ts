import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function ensureDir(path: string): void {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true, mode: 0o700 });
	}
}

function namespacePath(baseDir: string, namespace: string): string {
	return join(baseDir, namespace);
}

function entryPath(baseDir: string, namespace: string, key: string): string {
	return join(namespacePath(baseDir, namespace), `${key}.json`);
}

export interface SharedStateRecord<TValue = unknown> {
	namespace: string;
	key: string;
	value: TValue;
	updatedAt: string;
	updatedBy?: string;
}

export interface SharedStateManagerOptions {
	baseDir: string;
}

export class SharedStateManager {
	private readonly baseDir: string;

	constructor(options: SharedStateManagerOptions) {
		this.baseDir = options.baseDir;
		ensureDir(this.baseDir);
	}

	write<TValue>(namespace: string, key: string, value: TValue, updatedBy?: string): SharedStateRecord<TValue> {
		const namespaceDir = namespacePath(this.baseDir, namespace);
		ensureDir(namespaceDir);
		const record: SharedStateRecord<TValue> = {
			namespace,
			key,
			value,
			updatedAt: new Date().toISOString(),
			updatedBy,
		};
		writeFileSync(entryPath(this.baseDir, namespace, key), JSON.stringify(record, null, "\t"));
		return record;
	}

	read<TValue>(namespace: string, key: string): SharedStateRecord<TValue> | undefined {
		const path = entryPath(this.baseDir, namespace, key);
		if (!existsSync(path)) {
			return undefined;
		}
		try {
			return JSON.parse(readFileSync(path, "utf8")) as SharedStateRecord<TValue>;
		} catch {
			return undefined;
		}
	}

	update<TValue>(
		namespace: string,
		key: string,
		updater: (current: TValue | undefined) => TValue,
		updatedBy?: string,
	): SharedStateRecord<TValue> {
		const current = this.read<TValue>(namespace, key)?.value;
		const next = updater(current);
		return this.write(namespace, key, next, updatedBy);
	}

	delete(namespace: string, key: string): boolean {
		const path = entryPath(this.baseDir, namespace, key);
		if (!existsSync(path)) {
			return false;
		}
		rmSync(path, { force: true });
		return true;
	}
}
