---
name: daily-update
description: Write the end-of-day update for the Project POC on SPI dashboard / data work - what was done, findings, what is live, what is waiting on whom, and next steps. Use when asked for the daily update, an update for the POC, an EOD/status update, or "share my updates".
---

# Daily update for the Project POC

Turn the day's work into a short status update the Project POC can read in under a minute. The POC was not in the conversation, so every line must stand on its own.

## Sources (use in this order)

1. `findings_log.csv` in the project root: rows dated today (and older rows whose Resolution changed today).
2. Git: commits merged to `main` today (`git log origin/main --since=<today 00:00> --first-parent`). Use the commit title, not the hash, unless the POC needs to look it up.
3. What was delivered or decided in this session today (files, exports, queries, decisions).
4. Anything the user tells you to add.

If a source is missing (e.g. no findings_log.csv), use the others and say nothing about the missing one. Never invent work, numbers, dates or owners. If unsure whether something happened today, ask.

## Recipient and channel

- Project POC: **Challakonda Bharath**.
- Channel: **Microsoft Teams only** (chat message). No email, Slack or WhatsApp.

## Format (exactly these sections, skip a section only if it is empty)

```
Hi Bharath,

NIAT SPI Dashboard – Daily update (<DD Mon YYYY>)

Done today
- <change or delivery, in plain words> – <where / impact, with numbers>

Findings
- [Area] <short title> – <one line: what and how many> → <owner: next step>

Live / needs republish
- <merged changes that need a Replit republish to go live, or "All merged changes are live">

Waiting on
- <who> – <what we need from them>

Next
- <1–3 concrete next steps>
```

## Writing rules

- Lead with outcomes, not activity: "Overview attendance now matches Hexacon (51.5%)", not "Worked on attendance".
- Plain, short sentences. Numbers over adjectives. Name pages and campuses the POC knows.
- Use the same [Area] tags as the findings-log skill.
- No code, file paths, SQL, commit hashes or table internals unless the user asks; say "dashboard", "student report", "Hex", "DA team".
- No credentials, internal URLs or student personal data (names / IDs).
- Keep it under ~15 lines. If there is more, keep the top items and say "+N smaller fixes".
- Language: English unless the user asks otherwise.

## Delivery (Teams)

1. Show the update in chat, ready to paste into a Teams chat with Bharath: plain text, short bullet lines with "- ", no tables, no Markdown headings (Teams shows them as raw symbols).
2. Save it to `daily_updates/<YYYY-MM-DD>.md` in the project root (create the folder if needed; overwrite only today's file).
3. Never send it on your own. Only if the user explicitly says to send it in Teams (e.g. "send it to Bharath"): find the Teams chat with Challakonda Bharath (Microsoft 365 connector), show the exact message once more, and send it after the user confirms. If the connector is not available, say so and leave it for the user to paste.
4. End with one line: "Ready to share with Bharath on Teams – N done, M findings, K waiting."
