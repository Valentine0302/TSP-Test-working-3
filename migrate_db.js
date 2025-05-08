// migrate_db_v4.44.js
// Этот скрипт предназначен для однократного выполнения для обновления схемы БД до версии 4.44.
// Он обеспечивает корректность имен столбцов (нижний регистр для container_type_id)
// и создает таблицы, если они не существуют, согласно server_v4.44_final.js.

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

async function migrateDatabase() {
    console.log('[v4.44 Migration] Начало миграции базы данных до версии 4.44...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Проверка и переименование столбца Container_Type_ID в container_type_id в base_rates
        const baseRatesColumns = await client.query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_name = 'base_rates' AND column_name = 'Container_Type_ID';`
        );
        if (baseRatesColumns.rows.length > 0) {
            const checkLowercaseColumnBaseRates = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_name = 'base_rates' AND column_name = 'container_type_id';`
            );
            if (checkLowercaseColumnBaseRates.rows.length === 0) {
                console.log('[v4.44 Migration] Обнаружен столбец "Container_Type_ID" в таблице "base_rates". Переименование в "container_type_id"...');
                await client.query('ALTER TABLE base_rates RENAME COLUMN "Container_Type_ID" TO container_type_id;');
                console.log('[v4.44 Migration] Столбец "Container_Type_ID" в "base_rates" успешно переименован в "container_type_id".');
            } else {
                 console.log('[v4.44 Migration] Столбец "container_type_id" уже существует в "base_rates". Переименование "Container_Type_ID" не требуется или уже выполнено.');
            }
        } else {
            console.log('[v4.44 Migration] Столбец "Container_Type_ID" не найден в "base_rates". Проверка на "container_type_id"...');
            const checkLowercaseColumnBaseRates = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_name = 'base_rates' AND column_name = 'container_type_id';`
            );
            if (checkLowercaseColumnBaseRates.rows.length === 0) {
                 console.warn('[v4.44 Migration] ВНИМАНИЕ: Ни "Container_Type_ID", ни "container_type_id" не найдены в "base_rates". Таблица может быть не в ожидаемом состоянии.');
            } else {
                 console.log('[v4.44 Migration] Столбец "container_type_id" уже существует в "base_rates".');
            }
        }

        // Проверка и переименование столбца Container_Type_ID в container_type_id в calculation_history
        const calcHistoryColumns = await client.query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_name = 'calculation_history' AND column_name = 'Container_Type_ID';`
        );
        if (calcHistoryColumns.rows.length > 0) {
            const checkLowercaseColumnCalcHistory = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_name = 'calculation_history' AND column_name = 'container_type_id';`
            );
            if (checkLowercaseColumnCalcHistory.rows.length === 0) {
                console.log('[v4.44 Migration] Обнаружен столбец "Container_Type_ID" в таблице "calculation_history". Переименование в "container_type_id"...');
                await client.query('ALTER TABLE calculation_history RENAME COLUMN "Container_Type_ID" TO container_type_id;');
                console.log('[v4.44 Migration] Столбец "Container_Type_ID" в "calculation_history" успешно переименован в "container_type_id".');
            } else {
                console.log('[v4.44 Migration] Столбец "container_type_id" уже существует в "calculation_history". Переименование "Container_Type_ID" не требуется или уже выполнено.');
            }
        } else {
            console.log('[v4.44 Migration] Столбец "Container_Type_ID" не найден в "calculation_history". Проверка на "container_type_id"...');
            const checkLowercaseColumnCalcHistory = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_name = 'calculation_history' AND column_name = 'container_type_id';`
            );
            if (checkLowercaseColumnCalcHistory.rows.length === 0) {
                console.warn('[v4.44 Migration] ВНИМАНИЕ: Ни "Container_Type_ID", ни "container_type_id" не найдены в "calculation_history". Таблица может быть не в ожидаемом состоянии.');
            } else {
                console.log('[v4.44 Migration] Столбец "container_type_id" уже существует в "calculation_history".');
            }
        }
        
        // Создание таблиц, если они не существуют (с правильными именами столбцов)
        console.log("[v4.44 Migration] Гарантируем наличие всех необходимых таблиц...");
        await client.query(`
          CREATE TABLE IF NOT EXISTS ports (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL, 
            code VARCHAR(20), 
            region VARCHAR(100),
            latitude NUMERIC,
            longitude NUMERIC,
            country VARCHAR(100)
          );
        `);
        console.log("[v4.44 Migration] Таблица 'ports' проверена/создана.");

        await client.query(`
          CREATE TABLE IF NOT EXISTS container_types (
            id SERIAL PRIMARY KEY,
            name VARCHAR(50) UNIQUE NOT NULL, 
            description TEXT
          );
        `);
        console.log("[v4.44 Migration] Таблица 'container_types' проверена/создана.");

        await client.query(`
          CREATE TABLE IF NOT EXISTS base_rates (
            id SERIAL PRIMARY KEY, 
            origin_region VARCHAR(100) NOT NULL,
            destination_region VARCHAR(100) NOT NULL,
            container_type_id INT NOT NULL, 
            rate NUMERIC NOT NULL,
            UNIQUE(origin_region, destination_region, container_type_id),
            FOREIGN KEY (container_type_id) REFERENCES container_types(id)
          );
        `);
        console.log("[v4.44 Migration] Таблица 'base_rates' проверена/создана (с container_type_id).");

        await client.query(`
          CREATE TABLE IF NOT EXISTS index_config (
            index_name VARCHAR(50) PRIMARY KEY,
            baseline_value NUMERIC NOT NULL,
            weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
            current_value NUMERIC,
            last_updated TIMESTAMP
          );
        `);
        console.log("[v4.44 Migration] Таблица 'index_config' проверена/создана.");

        await client.query(`
          CREATE TABLE IF NOT EXISTS model_settings (
            setting_key VARCHAR(50) PRIMARY KEY,
            setting_value TEXT NOT NULL,
            description TEXT
          );
        `);
        console.log("[v4.44 Migration] Таблица 'model_settings' проверена/создана.");

        await client.query(`
          CREATE TABLE IF NOT EXISTS calculation_history (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            origin_port_id INT, 
            destination_port_id INT, 
            container_type_id INT, 
            weight NUMERIC,
            calculated_rate NUMERIC, 
            user_email VARCHAR(255),
            index_values_used JSONB, 
            FOREIGN KEY (origin_port_id) REFERENCES ports(id) ON DELETE SET NULL, 
            FOREIGN KEY (destination_port_id) REFERENCES ports(id) ON DELETE SET NULL,
            FOREIGN KEY (container_type_id) REFERENCES container_types(id) ON DELETE SET NULL
          );
        `);
        console.log("[v4.44 Migration] Таблица 'calculation_history' проверена/создана (с container_type_id).");
        
        // Для таблиц сезонности, предполагается, что seasonality_analyzer.js их создаст при необходимости
        // или они уже существуют. Здесь мы просто логируем это.
        console.log("[v4.44 Migration] Таблицы сезонности ('seasonality_data', 'seasonality_factors') управляются seasonality_analyzer.js.");

        await client.query('COMMIT');
        console.log('[v4.44 Migration] Миграция базы данных успешно завершена.');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[v4.44 Migration] Ошибка во время миграции базы данных:', error);
        throw error;
    } finally {
        client.release();
        console.log('[v4.44 Migration] Соединение с базой данных закрыто.');
    }
}

migrateDatabase().catch(err => {
    console.error("[v4.44 Migration] Не удалось выполнить скрипт миграции:", err);
    process.exit(1);
});

