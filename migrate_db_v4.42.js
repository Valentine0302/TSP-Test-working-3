// migrate_db_v4.41.js - One-time database schema migration script

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables (especially DATABASE_URL)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Render PostgreSQL
  }
});

async function migrateSchema() {
  console.log("[migrate_db_v4.41] Starting database schema migration...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("[migrate_db_v4.41] Connected to database.");

    // --- Alter base_rates table ---
    console.log("[migrate_db_v4.41] Checking/Altering 'base_rates' table...");
    // Ensure container_type_id exists. The original CREATE TABLE might have used origin_port_id and destination_port_id as text (regions).
    // The main server.js (v4.38+) expects origin_region, destination_region (text) and container_type_id (INT) for base_rates.
    // So, we only need to ensure container_type_id is present if it was missing from an older schema.
    // The CREATE TABLE in server.js v4.38+ already defines it correctly for new setups.
    // This script is for existing setups that might be missing it.
    await client.query(`
      ALTER TABLE base_rates 
      ADD COLUMN IF NOT EXISTS container_type_id INTEGER REFERENCES container_types(id) ON DELETE SET NULL ON UPDATE CASCADE;
    `);
    console.log("[migrate_db_v4.41] Ensured 'container_type_id' column exists in 'base_rates' and is an INTEGER with FK.");
    // Note: The base_rates table in server_v4.38+ uses origin_region and destination_region (TEXT) and container_type_id (INT).
    // So, no need to add origin_port_id or destination_port_id to base_rates itself.

    // --- Alter calculation_history table ---
    console.log("[migrate_db_v4.41] Checking/Altering 'calculation_history' table...");
    await client.query(`
      ALTER TABLE calculation_history 
      ADD COLUMN IF NOT EXISTS origin_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL ON UPDATE CASCADE,
      ADD COLUMN IF NOT EXISTS destination_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL ON UPDATE CASCADE,
      ADD COLUMN IF NOT EXISTS container_type_id INTEGER REFERENCES container_types(id) ON DELETE SET NULL ON UPDATE CASCADE;
    `);
    console.log("[migrate_db_v4.41] Ensured 'origin_port_id', 'destination_port_id', 'container_type_id' columns exist in 'calculation_history' and are INTEGERs with FKs.");

    await client.query("COMMIT");
    console.log("[migrate_db_v4.41] Schema migration committed successfully.");

  } catch (error) {
    console.error("[migrate_db_v4.41] Error during schema migration, attempting rollback...", error);
    try {
      await client.query("ROLLBACK");
      console.log("[migrate_db_v4.41] Transaction rolled back.");
    } catch (rollbackError) {
      console.error("[migrate_db_v4.41] Rollback failed:", rollbackError);
    }
    throw error; // Re-throw error to indicate failure
  } finally {
    await client.release();
    console.log("[migrate_db_v4.41] Database client released.");
    await pool.end(); // Close all connections in the pool
    console.log("[migrate_db_v4.41] Connection pool closed.");
  }
}

migrateSchema()
  .then(() => {
    console.log("[migrate_db_v4.41] Migration script finished successfully.");
    process.exit(0); // Success
  })
  .catch((err) => {
    console.error("[migrate_db_v4.41] Migration script failed:", err);
    process.exit(1); // Failure
  });

