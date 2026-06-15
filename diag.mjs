import postgres from 'postgres';
const sql = postgres('postgresql://analytics:analytics@localhost:5433/analytics', { ssl: false, max: 1 });

const r1 = await sql`
  SELECT 
    COUNT(*) AS total_rows,
    MIN(interval_key) AS oldest,
    MAX(interval_key) AS newest,
    COUNT(*) FILTER (WHERE interval_key >= CURRENT_DATE - INTERVAL '120 days') AS rows_120d,
    COUNT(DISTINCT email) FILTER (WHERE interval_key >= CURRENT_DATE - INTERVAL '120 days') AS patients_120d
  FROM supply_tracking
  WHERE supply_interval_total IS NOT NULL AND supply_interval_total::numeric > 0
`;
console.log('supply_tracking:', JSON.stringify(r1[0]));

const r2 = await sql`
  SELECT
    COUNT(*) FILTER (WHERE last_order >= CURRENT_DATE - INTERVAL '30 days') AS orders_30d,
    COUNT(*) FILTER (WHERE last_order >= CURRENT_DATE - INTERVAL '90 days') AS orders_90d,
    COUNT(*) AS total
  FROM (SELECT email, MAX(COALESCE(order_date::date, source_created_at::date)) AS last_order FROM orders_dispatched WHERE email IS NOT NULL GROUP BY email) t
`;
console.log('order recency:', JSON.stringify(r2[0]));

const r3 = await sql`
  SELECT
    COUNT(*) FILTER (WHERE ratio BETWEEN 0.75 AND 1.1) AS in_75_110,
    COUNT(*) AS total_recent
  FROM (
    SELECT email, SUM(supply_used_interval::numeric)/NULLIF(SUM(supply_interval_total::numeric),0) AS ratio
    FROM supply_tracking
    WHERE supply_interval_total IS NOT NULL AND supply_interval_total::numeric > 0
      AND interval_key >= CURRENT_DATE - INTERVAL '120 days'
    GROUP BY email
  ) t
`;
console.log('adherence 75-110% (120d):', JSON.stringify(r3[0]));

// Check repeat_count >= 3
const r4 = await sql`
  SELECT COUNT(DISTINCT email) FILTER (WHERE cnt >= 3) AS patients_3plus_cycles
  FROM (SELECT email, COUNT(*) AS cnt FROM supply_tracking WHERE supply_interval_total IS NOT NULL AND supply_interval_total::numeric > 0 GROUP BY email) t
`;
console.log('patients with >= 3 cycles:', JSON.stringify(r4[0]));

await sql.end();
