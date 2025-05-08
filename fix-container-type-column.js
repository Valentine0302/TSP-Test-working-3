import pg from 'pg';
const { Pool } = pg;

async function fixContainerTypeColumns() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    console.log('✅ Подключение к базе данных успешно');

    // Исправляем колонку в base_rates
    await client.query(`
      ALTER TABLE base_rates 
      ALTER COLUMN container_type_id TYPE VARCHAR(20)
    `);

    // Исправляем колонку в calculation_history
    await client.query(`
      ALTER TABLE calculation_history 
      ALTER COLUMN container_type_id TYPE VARCHAR(20)
    `);

    // Исправляем колонку в container_types
    await client.query(`
      ALTER TABLE container_types 
      ALTER COLUMN id TYPE VARCHAR(20)
    `);

    console.log('✅ Типы колонок успешно изменены на VARCHAR');
    await client.release();
  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    await pool.end();
  }
}

fixContainerTypeColumns();
