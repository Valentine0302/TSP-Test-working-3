// migrate_db.js - Скрипт для добавления столбца calculated_rate в calculation_history

import { Pool } from 'pg';
import dotenv from 'dotenv';

// Загрузка переменных окружения (для DATABASE_URL)
dotenv.config();

// Подключение к базе данных
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL configuration based on environment (e.g., Render)
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com') 
       ? { rejectUnauthorized: false } 
       : false 
});

async function runMigration() {
  console.log('Starting database migration: Add calculated_rate column...');
  let client;
  try {
    client = await pool.connect();
    console.log('Connected to the database.');

    const alterTableQuery = `
      ALTER TABLE calculation_history 
      ADD COLUMN IF NOT EXISTS calculated_rate NUMERIC;
    `;

    console.log('Executing SQL:', alterTableQuery);
    await client.query(alterTableQuery);
    console.log('Migration successful: Column "calculated_rate" added or already exists in "calculation_history".');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1; // Устанавливаем код выхода при ошибке
  } finally {
    if (client) {
      await client.release();
      console.log('Database client released.');
    }
    await pool.end(); // Закрываем пул соединений
    console.log('Database pool closed.');
  }
}

runMigration();

