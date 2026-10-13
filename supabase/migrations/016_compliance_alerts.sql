-- 016: compliance alert dedupe log. The alerts/run endpoint records
-- every alert it sends (stable key + time) so deadline/expiry/bond
-- alerts respect their cooldowns instead of repeating every run.
create table if not exists compliance_alerts_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  alert_key text not null,
  kind text not null,
  sent_at timestamptz not null default now()
);
create index if not exists compliance_alerts_log_lookup_idx
  on compliance_alerts_log (user_id, alert_key, sent_at desc);
