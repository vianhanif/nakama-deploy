# 2026-11-07 — NAKAMA-006 — One profile, explicit model

## Summary
Removed the second profile and pinned the remaining one to a concrete model. The instance now has
exactly one agent, so "which profile am I talking to" stops being a question.

## Changes (live instance only — nothing in this repo's manifests)
- Deleted profile `Super Nakama` (`50iDrfrHVk1oB7WGldj9K`, `isSuper=true`). It had 0 automations,
  0 sessions, 0 MCP servers, 12 bundled skills, 15 tools — all stock, nothing user-authored lost.
- `Default Bot` (`Y4RzRpU9XrgHampfC1a3r`) now carries `model = <9router provider id>::General`.

## Verification
```
sqlite3 ~/Data/nakama/sqlite/nakama.sqlite "select id,name,model,is_default,is_super from profiles;"
Y4RzRpU9XrgHampfC1a3r|Default Bot|49c9ba71-...::General|1|0
```
`GET /health` → 200, and only one profile directory remains under `orgs/<org>/profiles/`.

## Gotcha worth remembering
**The stored model separator is `::`, not `:`** (`decodeStoredModelSelection` in
`provider-instance-helpers.ts` looks for `indexOf("::")`). A single colon is accepted by the API,
returns 200, and then silently fails to resolve — the profile falls back to the default model and
looks correct in the UI. Always write `providerId::modelId`.

## Risks
- `Super Nakama` is the only profile that may create new profiles (`createProfileWithSuperNakama`
  requires an `isSuper` profile). With it gone, adding a second agent means the dashboard flow,
  not an in-app request.
