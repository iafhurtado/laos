import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'crypto';

// Simple seed for surcharges table with realistic dummy values
// Requires POSTGRES_URL or DATABASE_URL

const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Missing POSTGRES_URL/DATABASE_URL in env');
  process.exit(1);
}

const rows = [
  { code: 'THC', description: 'Terminal Handling Charge', kind: 'fixed', amount: 150, currency: 'EUR' },
  { code: 'DOC', description: 'Documentation Fee', kind: 'fixed', amount: 75, currency: 'EUR' },
  { code: 'SEC', description: 'Security Surcharge', kind: 'fixed', amount: 40, currency: 'EUR', applies_to_mode: 'air' },
  { code: 'FSCX', description: 'Extra Fuel Surcharge (seasonal)', kind: 'percent', amount: 2.5, currency: 'EUR' },
  { code: 'RESI', description: 'Residential Delivery', kind: 'fixed', amount: 35, currency: 'EUR', applies_to_mode: 'parcel' },
  { code: 'LIFT', description: 'Liftgate Service', kind: 'fixed', amount: 55, currency: 'EUR', applies_to_mode: 'ltl' },
];

async function main() {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('begin');

    // Ensure enum exists
    try {
      await client.query("CREATE TYPE surcharge_kind AS ENUM ('fixed','percent')");
    } catch (e: any) {
      // 42710 duplicate_object if already exists
      if (!(e && e.code === '42710')) throw e;
    }

    // Ensure table exists
    await client.query(
      `CREATE TABLE IF NOT EXISTS surcharges (
         id uuid PRIMARY KEY,
         code text UNIQUE NOT NULL,
         description text,
         applies_to_mode text,
         applies_to_rate_type text,
         kind surcharge_kind NOT NULL DEFAULT 'fixed',
         amount numeric NOT NULL,
         currency text DEFAULT 'EUR',
         is_active boolean DEFAULT true,
         created_at timestamp DEFAULT now(),
         updated_at timestamp DEFAULT now()
       )`
    );
    for (const r of rows) {
      const id = randomUUID();
      await client.query(
        `insert into surcharges(id, code, description, applies_to_mode, kind, amount, currency, is_active, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, true, now(), now())
         on conflict (code) do nothing`,
        [id, r.code, r.description, (r as any).applies_to_mode || null, r.kind, r.amount, r.currency]
      );
    }
    await client.query('commit');
    console.log('Seeded surcharges.');
  } catch (e) {
    await client.query('rollback');
    console.error('Seed surcharges failed:', e);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();


