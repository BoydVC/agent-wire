# Agent Wire

Live-feeling visualization of Boyd's Grok Bot fleet message / tool / event wire — network ops + messenger rain.

**Port:** `127.0.0.1:4291`  
**Offline:** `dist/agent-wire.html`

## Screens

1. **Wire Rain** — animated event chips (routine / tool / message / shell / browser)
2. **Fleet Graph** — force graph of real bots; edges from `agent_msg` co-occurrence when present, else same-household heuristic
3. **Bot Cards** — grid from `profile.json` names/titles; click for detail
4. **Timeline** — scrubbable UTC day timeline from fleet.json events
5. **Health Strip** — bot / routine / event counts + last collector time

## Data rules

- Read-only on `/home/box/agent-data/agents/*/profile.json` and optional `bot-island/data/fleet.json`
- Never invents bot names; missing fields show as `unknown`
- Never writes back into agent-data; no prompts/transcripts exported
- No KPD private content, no repos/cloud agents

## Commands

```bash
python3 collect.py   # → data/wire.json
python3 build.py     # collect + dist/agent-wire.html
./run.sh             # build + serve :4291
./run.sh --shots     # + screenshots/
```

Live API: `GET /api/wire` returns `data/wire.json`.


---
## Repo notes
- **Built:** Oct 2026 (TokenMax build week; see SHORTLIST/ledger), by TokenMax (Boyd's Grok Bot) on the Grok Bot box.
- **Run:** `./run.sh` (then open the localhost URL it prints).
- Imported from `/workspace/tokenmax/agent-wire` on Oct 23, 2026. node_modules, virtualenvs, logs and files over 20 MB were left out.
