import type { AgentConfig, AgentFactory, AgentMode, RegisteredAgent } from "./types.js";

export class AgentRegistry {
	private readonly registry = new Map<string, RegisteredAgent>();
	private readonly sourceIndex = new Map<string, Set<string>>();

	register(name: string, factory: AgentFactory, sourceId = "core"): void {
		this.registry.set(name, {
			factory,
			sourceId,
			registeredAt: new Date(),
			disabled: false,
		});

		const names = this.sourceIndex.get(sourceId) ?? new Set<string>();
		names.add(name);
		this.sourceIndex.set(sourceId, names);
	}

	get(name: string): AgentFactory | undefined {
		const entry = this.registry.get(name);
		if (!entry || entry.disabled) {
			return undefined;
		}
		return entry.factory;
	}

	instantiate(name: string, model: string): AgentConfig {
		const factory = this.get(name);
		if (!factory) {
			throw new Error(`Unknown agent: ${name}`);
		}
		return factory(model);
	}

	list(mode?: AgentMode, includeAllMode = true): string[] {
		const names: string[] = [];
		for (const [name, entry] of this.registry.entries()) {
			if (entry.disabled) {
				continue;
			}
			if (!mode) {
				names.push(name);
				continue;
			}
			if (entry.factory.mode === mode || (includeAllMode && entry.factory.mode === "all")) {
				names.push(name);
			}
		}
		return names;
	}

	setDisabled(name: string, disabled: boolean): void {
		const entry = this.registry.get(name);
		if (entry) {
			entry.disabled = disabled;
		}
	}

	unregisterBySource(sourceId: string): void {
		const names = this.sourceIndex.get(sourceId);
		if (!names) {
			return;
		}
		for (const name of names) {
			this.registry.delete(name);
		}
		this.sourceIndex.delete(sourceId);
	}

	getMetadata(name: string): { mode: AgentMode; description: string; whenToUse: string } | undefined {
		const entry = this.registry.get(name);
		if (!entry || entry.disabled) {
			return undefined;
		}
		const config = entry.factory("");
		return {
			mode: entry.factory.mode,
			description: config.description,
			whenToUse: config.whenToUse,
		};
	}
}

export const globalAgentRegistry = new AgentRegistry();
