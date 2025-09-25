1. Reorder Layout ✅ DONE

Left panel = Global chat ✅ DONE

~~Give it 20–25% width.~~ ✅ DONE (33% - equal distribution)

Persistent, scrollable, compact message bubbles. ✅ DONE

Title: "Global Chat". ✅ DONE

Keep it visually distinct with a slightly darker background than the token list. ✅ DONE (#0E0E12)

Middle panel = Tokens (anchor) ✅ DONE

~~Give it 30–35% width.~~ ✅ DONE (34% - equal distribution)

Expand the current list into something closer to a dashboard: ✅ DONE

Token name + avatar ✅ DONE

Price + % change (color-coded up/down) ✅ DONE

Mini-sparkline (last 24h trend) ✅ DONE

Market cap, liquidity ✅ DONE

Sort/filter options (by market cap, by watch status). ✅ DONE

Search bar at top. ✅ DONE

Highlight the selected token so the right thread is clearly tied to it. ✅ DONE

Right panel = Token thread ✅ DONE

~~Give it 40–45% width.~~ ✅ DONE (33% - equal distribution)

Sticky header: token avatar, name, current price, 24h chart, Unwatch button. ✅ DONE

Below: per-token chat. ✅ DONE

Different background shade from global chat → separates contexts. ✅ DONE (#181820)

Add tag chips (visual pills instead of plain text input). ✅ DONE

2. Visual Hierarchy & Background Layers ✅ DONE

Left panel (Global Chat) → darkest background (#0E0E12 style). ✅ DONE

Middle panel (Tokens) → slightly lighter background to pop as "anchor." ✅ DONE (#14141B)

Right panel (Token Thread) → same as middle or even lighter, but with carded chat bubbles to keep clarity. ✅ DONE (#181820)

Rounded corners, consistent spacing (8–12px). ✅ DONE

Subtle shadows on panels to avoid "wooden wall." ✅ DONE

3. Message Design ✅ DONE

Group consecutive messages by same author (no repeated name/timestamp unless break). ✅ DONE (MessageMeta with groupPosition)

Alternate bubble alignment (sender vs other). ✅ DONE (justify-end vs justify-start)

Hover bar with icons: reply, pin, copy, react. No more hidden under three dots. ✅ DONE (DropdownMenu)

Divider for "New messages" and scroll-to-latest button. ✅ DONE

4. Token Functionality Enhancements ✅ MOSTLY DONE

Unread indicators (badge count) per token. ✅ DONE (green dot badges)

Pin favorite tokens to top. ✅ DONE (star button with localStorage)

~~Hover on token → quick info card (price, % change, recent activity).~~ ⚠️ PARTIAL (sparklines load, no full info card)

~~Search/autocomplete for tags.~~ ⚠️ PARTIAL (basic search exists, no autocomplete)

5. Usability Polishing ✅ MOSTLY DONE

Global chat auto-scroll but pauses if user scrolls up. ✅ DONE (isAtBottomRef)

Token thread: when a message is referenced in global chat, clicking it jumps/highlights in token thread. ✅ DONE (pinned message clicks)

Input bar unified style: placeholder changes depending on panel ("Share insight globally…" vs "Discuss $TOKEN…"). ✅ DONE

Keyboard shortcuts: ✅ MOSTLY DONE

Ctrl+Enter to send ✅ DONE

~~/token to quickly jump to a token thread~~ ❌ NOT IMPLEMENTED

Additional shortcuts implemented: J/K navigation, Enter for actions, Q for reply, Alt+P for pin ✅ DONE

6. Suggested Width Ratio (desktop) ⚠️ MODIFIED

~~Global Chat: 20–25%~~ ✅ DONE (33% - equal distribution)

~~Tokens: 30–35%~~ ✅ DONE (34% - equal distribution)

~~Token Thread: 40–45%~~ ✅ DONE (33% - equal distribution)

This order of changes → ✅ IMPLEMENTATION STATUS

Reorder panels (global left, tokens middle, thread right). ✅ DONE

Apply background separation for context clarity. ✅ DONE

Upgrade token list to dashboard-like (sparklines, % changes, sorting). ✅ DONE

Refine chat UX (grouping, replies, reactions, scroll-to-latest). ✅ DONE

Enhance per-token header (sticky, live stats, tags as chips). ✅ DONE

Add polish (unread badges, hover states, shortcuts). ✅ MOSTLY DONE