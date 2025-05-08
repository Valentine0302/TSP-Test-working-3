// create-tables.js
import pg from 'pg';
const { Pool } = pg;

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    console.log('✅ Подключение к базе данных успешно');

    // Создаем основную таблицу
    await client.query(`
      CREATE TABLE IF NOT EXISTS calculation_config (
        id SERIAL PRIMARY KEY,
        destination_port INTEGER NOT NULL,
        container_type INTEGER NOT NULL,
        base_rate NUMERIC(10,2),
        weight_coefficient NUMERIC(5,2),
        email VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ Таблица calculation_config создана/проверена');
    
    // Добавляем тестовые данные (опционально)
    await client.query(`
      INSERT INTO calculation_config 
        (destination_port, container_type, base_rate, weight_coefficient, email)
      VALUES
        (68, 1, 150.00, 0.85, 'admin@example.com')
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ Тестовые данные добавлены');
    await client.release();
  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    await pool.end();
  }
}

main();
