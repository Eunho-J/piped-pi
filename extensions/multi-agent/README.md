# @pi/multi-agent

Phase-1 multi-agent foundation extension.

## Included in this slice

- Agent registry and built-in agent factories (`sisyphus`, `sisyphus-junior`, `oracle`, `explore`)
- Category/model routing via `ModelRouter`
- `task` tool for in-process sub-agent delegation via `ctx.runSubAgent`
- Lightweight dynamic prompt builder for orchestrator prompts

## Settings

This extension reads `multiAgent` from:

- `~/.pi/agent/settings.json`
- `<project>/.pi/settings.json`

Project settings override global settings.

## Runtime requirement

The host session must expose `ctx.runSubAgent` (added in this slice to `AgentSession`).
