# @pi/multi-agent

Phase-1 multi-agent foundation extension.

## Included in this slice

- Agent registry and built-in agent factories (`sisyphus`, `sisyphus-junior`, `oracle`, `explore`, `hephaestus`, `librarian`, `metis`, `prometheus`)
- Category/model routing via `ModelRouter`
- `task` tool for in-process sub-agent delegation via `ctx.runSubAgent`
- IPC-aware remote delegation path (`task.delegate`) when discovered peer agents are available
- Lightweight dynamic prompt builder for orchestrator prompts
- Agent mesh commands: `/agent.discover`, `/agent.send`, `/agent.steer`, `/agent.subscribe`, `/session.mesh.status`
- Agent model routing commands: `/agent.list_models`, `/agent.get_model`, `/agent.set_model`, `/agent.set_provider`, `/agent.reset_model`, `/agent.list_available_models`

## RPC command coverage (when extension is loaded)

- Mesh: `agent.discover`, `agent.send`, `agent.steer`, `agent.subscribe`, `session.mesh.status`
- Model routing: `agent.list_models`, `agent.get_model`, `agent.set_model`, `agent.set_provider`, `agent.reset_model`, `agent.list_available_models`

## Settings

This extension reads `multiAgent` from:

- `~/.pi/agent/settings.json`
- `<project>/.pi/settings.json`

Project settings override global settings.

## Runtime requirement

The host session must expose `ctx.runSubAgent` (added in this slice to `AgentSession`).
