import pg from 'pg';
const { Pool } = pg;

// ВНИМАНИЕ! Здесь не меняй ничего:
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addBaseRate() {
  try {
    // ЗДЕСЬ ВПИШИ СВОИ ДАННЫЕ:
    const origin_port_id = 1; // id порта отправления (например, 1)
    const destination_port_id = 2; // id порта назначения (например, 2)
    const container_type_id = '20DV'; // тип контейнера (например, '20DV')
    const rate = 1500.00; // ставка (например, 1500.00)

    // ВСТАВКА В БАЗУ
    await pool.query(
      `INSERT INTO base_rates (origin_port_id, destination_port_id, container_type_id, rate)
       VALUES ($1, $2, $3, $4)`,
      [origin_port_id, destination_port_id, container_type_id, rate]
    );
    console.log('Ставка успешно добавлена!');
  } catch (error) {
    console.error('Ошибка:', error);
  } finally {
    await pool.end();
  }
}

addBaseRate();
