-- Data retention for the anonymous public app. Run periodically (cron or by
-- hand) with: npm run db:cleanup

-- Sessions idle for 180+ days — cascades their conversations, messages and
-- prompts; UsageLog rows are kept (sessionId is set to NULL by the FK).
DELETE FROM "Session" WHERE "lastSeenAt" < now() - interval '180 days';

-- Usage logs only power the 7-day dashboard; 90 days is plenty of history.
DELETE FROM "UsageLog" WHERE "createdAt" < now() - interval '90 days';
