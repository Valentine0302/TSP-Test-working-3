// fix-db-schema.js
import pg from 'pg';
const { Pool } = pg;

async function fixDatabaseSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL database');

    await client.query(`
      ALTER TABLE calculation_config 
      ALTER COLUMN destination_port TYPE INTEGER USING destination_port::integer,
      ALTER COLUMN container_type TYPE INTEGER USING container_type::integer
    `);
    
    console.log('Schema updated successfully');
    await client.release();
  } catch (error) {
    console.error('Error during schema migration:', error);
  } finally {
    await pool.end();
  }
}

fixDatabaseSchema();
