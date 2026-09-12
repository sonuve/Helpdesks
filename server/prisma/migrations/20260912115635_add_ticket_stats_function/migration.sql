-- Moves the dashboard's aggregate math (previously server/src/lib/ticket-stats.ts's
-- computeResolvedByAiPercent/computeAverageResolutionTimeMs/computeTicketsPerDay,
-- called from GET /api/tickets/stats after three separate prisma.ticket.count()s
-- and two findMany()s) into a single stored function, so the route does one
-- query instead of five and the arithmetic runs where the data already lives.
--
-- `as_of` defaults to now() but can be overridden, mirroring the JS versions'
-- `now: Date = new Date()` parameter — it's what let those functions be
-- unit-tested deterministically against fixed input, and keeps that same
-- override available here (e.g. from a test) even though this function reads
-- the live `ticket` table rather than an in-memory array.
CREATE OR REPLACE FUNCTION get_ticket_stats(days_back integer DEFAULT 30, as_of timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH counts AS (
    SELECT
      COUNT(*) AS total_tickets,
      COUNT(*) FILTER (WHERE status = 'OPEN') AS open_tickets,
      COUNT(*) FILTER (WHERE "resolvedByAi") AS resolved_by_ai_count
    FROM ticket
  ),
  resolution AS (
    -- resolvedAt (not updatedAt) is what marks when a ticket left OPEN, see
    -- its comment in schema.prisma. NULL (not 0) when nothing's resolved
    -- yet, same distinction ticket-stats.ts's computeAverageResolutionTimeMs
    -- used to make explicit.
    SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) * 1000) AS avg_resolution_ms
    FROM ticket
    WHERE "resolvedAt" IS NOT NULL
  ),
  -- `ticket.createdAt` is TIMESTAMP(3) WITHOUT TIME ZONE, written by Prisma
  -- as UTC wall-clock values (see schema.prisma / TicketsPerDayChart.tsx's
  -- formatChartDate comment) — "AT TIME ZONE 'UTC'" below converts as_of
  -- (a real instant) into that same naive-UTC representation so the two are
  -- comparable, matching computeTicketsPerDay's "bucket by UTC calendar day"
  -- behavior exactly.
  days AS (
    SELECT generate_series(
      date_trunc('day', as_of AT TIME ZONE 'UTC') - ((days_back - 1) || ' days')::interval,
      date_trunc('day', as_of AT TIME ZONE 'UTC'),
      '1 day'::interval
    ) AS day
  ),
  per_day AS (
    SELECT d.day, COUNT(t.id) AS count
    FROM days d
    LEFT JOIN ticket t
      ON t."createdAt" >= d.day AND t."createdAt" < d.day + interval '1 day'
    GROUP BY d.day
  )
  SELECT jsonb_build_object(
    'totalTickets', c.total_tickets,
    'openTickets', c.open_tickets,
    'resolvedByAiCount', c.resolved_by_ai_count,
    -- 0, not NaN, when there are no tickets at all yet.
    'resolvedByAiPercent', CASE WHEN c.total_tickets = 0 THEN 0
                                 ELSE (c.resolved_by_ai_count::double precision / c.total_tickets) * 100
                            END,
    'averageResolutionTimeMs', r.avg_resolution_ms,
    'ticketsPerDay', (
      SELECT jsonb_agg(jsonb_build_object('date', to_char(pd.day, 'YYYY-MM-DD'), 'count', pd.count) ORDER BY pd.day)
      FROM per_day pd
    )
  )
  FROM counts c, resolution r;
$$;
