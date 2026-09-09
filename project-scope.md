# AI-Powered Ticket Management System

## Problem

We receive hundreds of support emails daily. Our agents manually read, classify, and respond to each ticket - which is slow and leads to impersonal, canned responses.

## Solution

Build a ticket management system that uses AI to automatically classify, respond to, and route support tickets - delivering faster, more personalized responses to students while freeing up agents for complex issues.

## Features

- Receive support emails and create tickets
- Auto-generate human-friendly responses using a knowledge base
- Ticket list with filtering and sorting
- Ticket detail view
- AI-powered ticket classification
- AI summaries
- AI-suggested replies
- User management (admin only)
- Dashboard to view and manage all tickets

## Decisions

- **AI autonomy:** Fully autonomous. The AI classifies, drafts, and sends replies without a human review step by default.
- **Escalation:** Low-confidence classifications or replies are escalated to a human queue instead of being auto-sent. A confidence threshold per classification category still needs to be defined (see Open Questions).
- **Routing:** Tickets route to agents/teams by AI classification category (e.g. "billing" -> billing team).
- **Categories:** Each ticket is classified into exactly one category: General Question, Technical Question, or Refund Request.
- **Ticket statuses:** Open, Resolved, Closed.
- **Knowledge base:** Built from past resolved tickets rather than hand-curated docs/FAQs.
- **Data privacy:** Student PII sent to the AI provider requires guardrails (redaction/exclusion rules, audit logging of AI actions) rather than being treated as ordinary support data.
- **Agent permissions:** Regular agents (not just admins) have full ticket control — claim, reassign, edit AI replies, close/reopen, override AI classification.
- **User provisioning:** The system is deployed with a single seeded admin account. The admin then creates additional agent accounts — there is no public/self-service signup.
- **Migration:** This replaces an existing helpdesk tool. Historical tickets need to be migrated — this also solves the knowledge-base cold-start problem, since the KB depends on past resolved tickets existing at launch.

## Tech Stack

See [tech-stack.md](tech-stack.md).

## Implementation Plan

See [implementation-plan.md](implementation-plan.md).

## Open Questions

- **Admin bootstrap & account management:** How is the seed admin's credential set at deploy time (config/env var vs. first-run setup flow)? Can there be more than one admin? Can the admin deactivate/remove an agent account, and does removing an agent reassign their open tickets?

- **Email ingestion:** Provider/API integration (e.g. Gmail API) vs. generic IMAP polling; how replies are threaded to existing tickets (Message-ID/References headers vs. subject matching); attachment handling; spam/phishing filtering before content reaches the AI prompt.
- **Confidence threshold:** What confidence level, per classification category, triggers escalation vs. autonomous handling.
- **PII guardrails specifics:** What exactly gets redacted/excluded before content is sent to the AI provider; what gets logged per AI action (classification, draft/sent reply, confidence score) for audit purposes.
- **Ticket lifecycle:** Statuses are Open/Resolved/Closed — need to define what distinguishes Resolved from Closed (e.g. Resolved = agent/AI marked it done, Closed = no further activity/auto-closed after a time window?), whether a Resolved ticket can be reopened by a student reply, and whether an "escalated" state is tracked separately or is just Open + assigned to a human queue. Also: duplicate-ticket detection for repeat emails from the same student.
- **Categories:** Only 3 categories are defined (General Question, Technical Question, Refund Request) — is this exhaustive, or is there a fallback/"Other" bucket for tickets that don't fit? A Refund Request likely needs different handling than a Q&A-style reply (e.g. verifying an order, approval workflow) — worth confirming whether AI can autonomously approve/process refunds or if that category always escalates.
- **Success metrics:** What "faster, more personalized" is measured against — response time, resolution rate, CSAT, % of tickets auto-resolved without escalation.
- **Channels:** Email only for v1, with chat/web-form explicitly out of scope or planned for later.
