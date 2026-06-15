import postgres from 'postgres';
const sql = postgres('postgresql://analytics:analytics@localhost:5433/analytics', { ssl: false, max: 1 });

// Distribution of adherence ratios
const r1 = await sql`
  SELECT
    COUNT(*) FILTER (WHERE ratio IS NULL) AS null_ratio,
    COUNT(*) FILTER (WHERE ratio = 0) AS zero_ratio,
    COUNT(*) FILTER (WHERE ratio > 0 AND ratio < 0.25) AS under_25,
    COUNT(*) FILTER (WHERE ratio BETWEEN 0.25 AND 0.50) AS p25_50,
    COUNT(*) FILTER (WHERE ratio BETWEEN 0.50 AND 0.75) AS p50_75,
    COUNT(*) FILTER (WHERE ratio BETWEEN 0.75 AND 1.10) AS p75_110,
    COUNT(*) FILTER (WHERE ratio > 1.10) AS over_110,
    COUNT(*) AS total
  FROM (
    SELECT email, SUM(supply_used_interval::numeric)/NULLIF(SUM(supply_interval_total::numeric),0) AS ratio
    FROM supply_tracking
    WHERE supply_interval_total IS NOT NULL AND supply_interval_total::numeric > 0
      AND interval_key >= CURRENT_DATE - INTERVAL '120 days'
    GROUP BY email
  ) t
`;
console.log('ratio distribution (120d):', JSON.stringify(r1[0]));

// Sample of actual values
const r2 = await sql`
  SELECT email, 
    SUM(supply_used_interval::numeric) AS total_used,
    SUM(supply_interval_total::numeric) AS total_allotted,
    SUM(supply_used_interval::numeric)/NULLIF(SUM(supply_interval_total::numeric),0) AS ratio
  FROM supply_tracking
  WHERE supply_interval_total IS NOT NULL AND supply_interval_total::numeric > 0
    AND interval_key >= CURRENT_DATE - INTERVAL '120 days'
  GROUP BY email
  ORDER BY ratio DESC NULLS LAST
  LIMIT 5
`;
console.log('top adherence (120d):', r2.map(r => ({email: r.email?.substring(0,20), used: r.total_used, allotted: r.total_allotted, ratio: r.ratio})));

// Check used_interval nulls
const r3 = await sql`
  SELECT
    COUNT(*) AS rows_120d,
    COUNT(*) FILTER (WHERE supply_used_interval IS NULL) AS null_used,
    COUNT(*) FILTER (WHERE supply_used_interval::numeric = 0) AS zero_used,
    COUNT(*) FILTER (WHERE supply_used_interval::numeric > 0) AS positive_used
  FROM supply_tracking
  WHERE supply_interval_total IS NOT NULL AND supply_interval_total::numeric > 0
    AND interval_key >= CURRENT_DATE - INTERVAL '120 days'
`;
console.log('supply_used_interval coverage:', JSON.stringify(r3[0]));

// Check allowance_pct using saleor approach
const r4 = await sql`
  SELECT
    COUNT(*) FILTER (WHERE pct BETWEEN 75 AND 110) AS in_75_110,
    COUNT(*) FILTER (WHERE pct > 0) AS with_usage,
    COUNT(*) AS total
  FROM (
    SELECT zc.email,
      ROUND(COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0) * 100, 1) AS pct
    FROM zoho_contacts zc
    LEFT JOIN (SELECT email, SUM(allotted_grams::numeric) AS allotted_g FROM allowance_tracking GROUP BY email) at ON at.email = zc.email
    LEFT JOIN (SELECT customer_email AS email, SUM(quantity::numeric * product_weight_g::numeric) AS used_g FROM saleor_order_lines sol JOIN saleor_orders so ON so.id = sol.order_id WHERE so.status IN ('fulfilled','partially_fulfilled') GROUP BY customer_email) su ON su.email = zc.email
    WHERE zc.email IS NOT NULL
  ) t
`;
console.log('all-time allowance% distribution:', JSON.stringify(r4[0]));

await sql.end();
