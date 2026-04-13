# Demo Video Script — @sova-intel/mcp
Target: 90–150 seconds. No voiceover required — screen + typing is enough.

---

## Setup (before recording)

- Claude Code open, terminal ready
- `sova-intel` NOT yet connected (so the install is real)
- Font size bumped for readability
- Use a real API key with credits

---

## [0:00 – 0:12] Start cold

Show Claude Code. No narration needed — just the clean editor.
Run `/mcp` or show the MCP panel to confirm `sova-intel` is NOT listed yet.

**Type in terminal:**
```
claude mcp add sova-intel -e SOVA_API_KEY=ak_your_key -- npx -y "@sova-intel/mcp"
```

Let it run. You'll see the install output scroll.

---

## [0:12 – 0:25] Confirm connected

Restart Claude Code (or the session).
Run `/mcp` — show `sova-intel · ✓ connected`.

Pause one beat. That's the install done.

---

## [0:25 – 0:55] Prompt 1 — wallet question

Type in the Claude Code chat (no explanation, just ask it):

```
What kind of trader is DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm?
```

Wait for response. The answer comes back in a few seconds.
**Show the result on screen** — behavior type, win rate, hold time, holdings.
Don't narrate. Let the output speak.

---

## [0:55 – 1:20] Prompt 2 — token holders

Type directly after, same session:

```
Who are the top holders of J5DnHXXmKsXmCAeSvPRc5qR64ruYKcZHKwZijv9HnZgK
and what are their trading styles?
```

This one queues server-side and may take 20–60 seconds.
If it returns `mode: queued`, the MCP will automatically call `job_wait` — let that happen, don't interrupt.
**Show the final result** — behavior distribution, avg PnL.

---

## [1:20 – 1:40] Prompt 3 — coordination check

Immediately follow up:

```
Do any of those holders look coordinated or like the same actor?
```

The MCP reuses the wallet list from the previous result.
**Show the coordination score and flagged pairs.**

---

## [1:40 – 1:50] End

Cut to: the three responses visible in the chat.
Optional: show `sova-intel.com` in a browser tab — nothing else needed.

Fade out.

---

## Notes

- Don't explain what MCP is. Show the prompts, show the output.
- If token_holder_profiles takes >45s and returns queued, that's fine — it's real, leave it in.
- The aha moment is prompt 3: one follow-up question, coordination score appears. That's the ending.
- Keep total under 2:30. Under 2:00 is better.
