# Tech Stack

- **Frontend:** React + TypeScript, Vite, Tailwind + shadcn/ui, React Query. Dashboard, ticket list/filter/sort, ticket detail view.
- **Backend:** Node.js + TypeScript (Fastify) — one language across the stack.
- **Database:** PostgreSQL with the `pgvector` extension — relational data (tickets, users, statuses, categories) and KB embeddings in one database.
- **Background jobs:** Redis + BullMQ — async email ingestion, AI classification/reply generation, and sending, so webhook handlers stay fast and retries are easy.
- **AI:** Anthropic Claude API for classification, summaries, and reply drafting. Voyage AI embeddings for KB search over past resolved tickets.
- **Email:** Gmail API or Microsoft Graph (whichever mailbox is used), via push/webhook notifications for both receiving and sending.
- **Auth:** Database-backed sessions — session records stored in Postgres (e.g. a `sessions` table, via `connect-pg-simple` or equivalent), not JWT. A `role` column (admin/agent) on the user table drives permissions. No self-service signup, matching the admin-provisioning decision in `project-scope.md`.
- **Audit log:** A dedicated `ai_actions` table recording every AI decision (classification, confidence score, draft text, sent/escalated).

## Deployment: Docker + AWS

- **Containers:** Backend API and BullMQ workers each run as a Docker image, built and pushed to **ECR**.
- **Compute:** **ECS Fargate** running the API and worker as separate services — no servers to patch/manage, scales independently (e.g. scale workers up during high email volume without scaling the API).
- **Load balancing / ingress:** **ALB** in front of the ECS API service — needed since email provider webhooks (Gmail/Graph push notifications) require a public HTTPS endpoint.
- **Database:** **RDS for PostgreSQL** (15+) with `pgvector` enabled. Also hosts the sessions table.
- **Queue:** **ElastiCache for Redis**, backing BullMQ.
- **Frontend hosting:** Static SPA build served from **S3 + CloudFront** — decoupled from backend deploys, cheap, simple.
- **Secrets:** **AWS Secrets Manager** (or SSM Parameter Store) for API keys — Anthropic, Voyage, email provider credentials.
- **Networking:** VPC with RDS/ElastiCache in private subnets, ALB in a public subnet.
- **CI/CD:** GitHub Actions builds the Docker image, pushes to ECR, deploys to ECS on merge to main.
- **Logging/monitoring:** CloudWatch Logs for API/worker output, CloudWatch Alarms for basic health (queue depth, error rate).
- **Cheaper MVP alternative:** A single EC2 instance running everything via `docker-compose` (API, worker, Postgres, Redis) is a valid starting point before migrating to the ECS/RDS/ElastiCache setup above once ticket volume or reliability needs justify it.
