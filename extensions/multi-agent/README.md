# @pi/multi-agent

Guided multi-agent orchestration extension for `pi`.

## Beginner quickstart (3 steps)

1. Run `/multi-agent init`.
2. Complete the integrated flow (provider auth discovery/onboarding + preset mapping + optional per-role customization).
3. Use `task()`; run `/multi-agent doctor` if anything looks wrong.

No manual JSON editing is required for the default path.

## What `/multi-agent init` does

- Detects connected/disconnected providers and available models.
- Offers in-flow onboarding for API-key providers.
- Generates role-aware recommendations from connected models, differentiating by:
	- speed
	- cost
	- reasoning support
	- context window
	- multimodal input
- Applies `balanced`, `quality`, or `budget` preset mapping.
- Supports full apply or per-mapping partial customization in the same flow.
- On rerun, detects newly connected providers, shows recommendation diff vs current mapping, and applies updates merge-safely with backup.

## Commands

- `/multi-agent init [balanced|quality|budget]` – integrated onboarding/recommend/apply flow.
- `/multi-agent preset <balanced|quality|budget>` – one-command preset switch.
- `/multi-agent doctor` – diagnostics for package load/runtime support, config validity, model availability, and common misconfiguration patterns.
- `/agents`, `/agent.get_model`, `/agent.set_model`, `/agent.set_provider`, `/agent.reset_model`, `/models` – lower-level controls.

## Advanced

### Settings source

This extension reads `multiAgent` from:

- `~/.pi/agent/settings.json`
- `<project>/.pi/settings.json`

Project settings override global settings.

### Runtime requirement

The host session must expose `ctx.runSubAgent`.

### Safety/merge behavior

When init/preset writes settings:

- Existing non-`multiAgent` settings are preserved.
- Existing advanced `multiAgent` fields are preserved unless explicitly updated.
- A timestamped backup file is written before changes.
