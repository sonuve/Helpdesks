# Implementation Plan

Tasks are grouped into phases, each building on the last. Tasks flagged **[blocked: open question]** depend on a decision in the Open Questions section of `project-scope.md` and should be resolved before or during that task, not deferred silently.

## Phase 0 — Foundations

- [ ] Scaffold repo structure (frontend, backend, shared types/schemas)
- [ ] Set up Postgres migration tooling (e.g. Drizzle or Prisma) with `pgvector` enabled
- [ ] Write `docker-compose.yml` for local dev: API, worker, Postgres, Redis
- [ ] Write Dockerfiles for the API and worker images
- [ ] Set up GitHub Actions: lint, type-check, test, build on every PR
- [ ] Set up env/config management (`.env.example`, secrets placeholders for Anthropic, Voyage, email provider)

## Phase 1 — Data model, auth & user management

- [ ] `users` table (email, password hash, role: admin/agent, active flag)
- [ ] `sessions` table + session middleware (database-backed sessions, e.g. `connect-pg-simple`)
- [ ] Login / logout endpoints
- [ ] Admin bootstrap script — seeds the single admin account on first deploy **[blocked: how the seed credential is set — env var vs. first-run flow]**
- [ ] Admin: create / deactivate agent accounts (API + UI)
- [ ] `tickets` table: status (Open/Resolved/Closed), category (General/Technical/Refund), subject, body, requester email, timestamps
- [ ] Frontend: login page, protected routing, app shell with role-aware nav

## Phase 2 — Ticket ingestion & manual workflow (no AI yet)

- [x] Connect to shared support mailbox — SendGrid Inbound Parse webhook (see project-scope.md's "Email ingestion provider" decision), not Gmail API/Microsoft Graph polling
- [x] Webhook endpoint to receive new-email push notifications — `POST /api/email/inbound/:secret` (`server/src/routes/inbound-email.ts`)
- [x] Email → ticket creation: parse sender, subject, body (attachments not yet — see below)
- [ ] Reply-threading: match incoming email to existing ticket **[blocked: threading strategy — Message-ID/References vs. subject matching]**
- [ ] Attachment storage (e.g. S3) and display on ticket detail
- [ ] Spam/phishing filter pass before ticket creation
- [ ] Ticket list UI: filter by status/category, sort
- [ ] Ticket detail UI: email thread view, manual status change
- [x] Manual reply: agent composes and sends a reply via the email API (no AI involved yet) — proves the ingestion/send loop end-to-end before adding AI. Sends via SendGrid's Mail Send API (`server/src/lib/email-sending.ts`), the send-side counterpart to the Inbound Parse webhook above.

## Phase 3 — AI classification & summarization

- [ ] Claude API client/service wrapper (shared across classification, summary, reply generation)
- [ ] Classification worker (BullMQ job): assigns category + confidence score to new tickets
- [ ] Routing: assign ticket to team/queue based on category
- [ ] AI summary generation, shown on ticket detail
- [ ] `ai_actions` audit table + logging wired into the classification step
- [ ] PII handling pass on ticket content before it's sent to Claude **[blocked: exact redaction/exclusion rules]**

## Phase 4 — Knowledge base & AI replies

- [ ] Embedding pipeline: embed resolved tickets (Voyage AI) into `pgvector`
- [ ] KB retrieval function: top-k similar past resolutions for a given ticket
- [ ] AI reply draft generation grounded in retrieved KB context
- [ ] Confidence-threshold logic: auto-send vs. escalate to human queue **[blocked: threshold value per category]**
- [ ] Refund Request handling — confirm whether this category can be auto-sent at all or always escalates **[blocked: open question]**
- [ ] Auto-send path: send AI reply, log to `ai_actions`, update ticket status
- [ ] Escalation path: flagged ticket appears in agent review queue with the AI draft attached
- [ ] Agent UI: review/edit AI draft, override, and send from the escalation queue

## Phase 5 — Agent workflow & dashboard

- [ ] Agent permissions: claim, reassign, close/reopen, override AI classification (API + UI)
- [ ] Ticket status lifecycle: define Resolved vs. Closed transition rules, reopen-on-reply behavior **[blocked: open question]**
- [ ] Duplicate-ticket detection for repeat emails from the same requester
- [ ] Dashboard: ticket volume, status breakdown, category breakdown, escalation rate

## Phase 6 — Migration & KB bootstrap

- [ ] Build import script for historical tickets from the existing helpdesk tool
- [ ] Backfill KB embeddings from migrated historical tickets (solves cold-start — see Decisions)
- [ ] Data validation / spot-check tooling for migrated records

## Phase 7 — AWS deployment

- [ ] Infra as code (Terraform or CDK): VPC, RDS (Postgres + pgvector), ElastiCache Redis
- [ ] ECS Fargate services for API and worker; ALB in front of the API
- [ ] ECR repositories + image push in CI
- [ ] S3 + CloudFront for the frontend build
- [ ] Secrets Manager entries for Anthropic, Voyage, email provider credentials
- [ ] CD pipeline: GitHub Actions deploys to ECS on merge to main
- [ ] CloudWatch logging + basic alarms (queue depth, error rate)

## Phase 8 — Hardening & launch

- [ ] Define and instrument success metrics **[blocked: which metrics — response time, resolution rate, CSAT, auto-resolve %]**
- [ ] Error handling/retry policy for email and AI-call failures
- [ ] Security review of the AI/email pipeline (prompt injection via email content, auth, secrets)
- [ ] Pilot rollout on a subset of ticket volume or categories
- [ ] Monitor AI accuracy and tune confidence thresholds against real traffic
- [ ] Full cutover from the existing helpdesk tool
