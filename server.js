// server_v4.46_robust_migration.js
// Интеграционный модуль v4.46: Усиленная автоматическая миграция БД, учитывающая столбец 'container_type'.

import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer'; // Для обработки загрузки файлов
import xlsx from 'xlsx'; // Для чтения Excel
import fs from 'fs'; // Импортируем модуль fs для чтения файла

// Импорт модулей анализа и расчета
import { initializeAndUpdateSeasonalityData, initializeSeasonalityTables, fetchSeasonalityFactor } from './seasonality_analyzer.js';
import { calculateFreightRate, saveRequestToHistory } from './freight_calculator_enhanced.js';

// Загрузка переменных окружения
dotenv.config();

// Определение __dirname для ES модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Настройка Multer для загрузки файлов в память
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Подключение к базе данных
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  }
});

// Создание экземпляра Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Redirect /admin to /admin.html
app.get('/admin', (req, res) => {
  res.redirect('/admin.html');
});

// --- Вспомогательная функция для обработки асинхронных маршрутов ---
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- Функция автоматической миграции базы данных v4.46 ---
async function autoMigrateDatabase() {
    console.log('[v4.46 Robust Migration] Начало автоматической миграции базы данных...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const tablesToMigrate = ['base_rates', 'calculation_history'];

        for (const tableName of tablesToMigrate) {
            console.log(`[v4.46 Robust Migration] Processing table: ${tableName}`);
            let columnRenamedThisTable = false;

            // 1. Check for "container_type" (lowercase, no _id)
            const plainColumnExists = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'container_type';`, [tableName]
            );

            if (plainColumnExists.rows.length > 0) {
                const targetColumnExists = await client.query(
                    `SELECT column_name FROM information_schema.columns 
                     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'container_type_id';`, [tableName]
                );
                if (targetColumnExists.rows.length === 0) {
                    console.log(`[v4.46 Robust Migration] Found "container_type" in "${tableName}". Renaming to "container_type_id"...`);
                    await client.query(`ALTER TABLE ${tableName} RENAME COLUMN container_type TO container_type_id;`);
                    console.log(`[v4.46 Robust Migration] Column "container_type" in "${tableName}" successfully renamed to "container_type_id".`);
                    columnRenamedThisTable = true;
                } else {
                    console.log(`[v4.46 Robust Migration] Found "container_type" AND "container_type_id" in "${tableName}". Assuming "container_type_id" is correct, no rename needed for "container_type".`);
                }
            } else {
                console.log(`[v4.46 Robust Migration] Column "container_type" (no _id) not found in "${tableName}".`);
            }

            // 2. If not renamed yet, check for "Container_Type_ID" (mixed case)
            if (!columnRenamedThisTable) {
                const mixedCaseColumnExists = await client.query(
                    `SELECT column_name FROM information_schema.columns 
                     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'Container_Type_ID';`, [tableName]
                );
                if (mixedCaseColumnExists.rows.length > 0) {
                    const targetColumnExists = await client.query(
                        `SELECT column_name FROM information_schema.columns 
                         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'container_type_id';`, [tableName]
                    );
                    if (targetColumnExists.rows.length === 0) {
                        console.log(`[v4.46 Robust Migration] Found "Container_Type_ID" in "${tableName}". Renaming to "container_type_id"...`);
                        await client.query(`ALTER TABLE ${tableName} RENAME COLUMN "Container_Type_ID" TO container_type_id;`);
                        console.log(`[v4.46 Robust Migration] Column "Container_Type_ID" in "${tableName}" successfully renamed to "container_type_id".`);
                        columnRenamedThisTable = true;
                    } else {
                        console.log(`[v4.46 Robust Migration] Found "Container_Type_ID" AND "container_type_id" in "${tableName}". Assuming "container_type_id" is correct, no rename needed for "Container_Type_ID".`);
                    }
                } else {
                    console.log(`[v4.46 Robust Migration] Column "Container_Type_ID" (mixed case) not found in "${tableName}".`);
                }
            }

            // 3. Final check for "container_type_id"
            if (!columnRenamedThisTable) {
                const finalCheck = await client.query(
                    `SELECT column_name FROM information_schema.columns 
                     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'container_type_id';`, [tableName]
                );
                if (finalCheck.rows.length > 0) {
                    console.log(`[v4.46 Robust Migration] Column "container_type_id" already exists in "${tableName}". No migration needed for this column in this table.`);
                } else {
                    console.warn(`[v4.46 Robust Migration] WARNING: After all checks, "container_type_id" (nor its variants "container_type" or "Container_Type_ID" that could be renamed) not found in "${tableName}". This table might be created later by initializeDatabaseTables, or there's an unexpected schema.`);
                }
            }
        }

        console.log("[v4.46 Robust Migration] Проверка и переименование столбцов для всех таблиц завершены.");
        await client.query('COMMIT');        console.log("[v4.46 Robust Migration] Автоматическая миграция базы данных успешно завершена (или не требовалась).");
    } catch (error) {
        console.error('[v4.46 Robust Migration] Ошибка во время автоматической миграции базы данных, попытка отката...');
        if (client) {
            try { await client.query('ROLLBACK'); console.log("[v4.46 Robust Migration] Транзакция откатана."); } 
            catch (rollbackError) { console.error("[v4.46 Robust Migration] Ошибка отката транзакции:", rollbackError); }
        }
        console.error('[v4.46 Robust Migration] Ошибка автоматической миграции:', error);
        throw error; // Передаем ошибку дальше, чтобы предотвратить запуск сервера при неудачной миграции
    } finally {
        if (client) { client.release(); console.log('[v4.46 Robust Migration] Соединение с базой данных закрыто после миграции.'); }
    }
}


// --- Инициализация таблиц базы данных ---
async function initializeDatabaseTables() {
  console.log("[v4.46] Initializing database tables...");
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
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
    console.log("[v4.46] 'ports' table ensured.");
    await client.query(`
      CREATE TABLE IF NOT EXISTS container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, 
        description TEXT
      );
    `);
    console.log("[v4.46] 'container_types' table ensured.");
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
    console.log("[v4.46] 'base_rates' table ensured (with container_type_id).");
    await client.query(`
      CREATE TABLE IF NOT EXISTS index_config (
        index_name VARCHAR(50) PRIMARY KEY,
        baseline_value NUMERIC NOT NULL,
        weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        current_value NUMERIC,
        last_updated TIMESTAMP
      );
    `);
    console.log("[v4.46] 'index_config' table ensured.");
    await client.query(`
      CREATE TABLE IF NOT EXISTS model_settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        description TEXT
      );
    `);
    await client.query(`INSERT INTO model_settings (setting_key, setting_value, description) VALUES 
      ('sensitivityCoeff', '0.5', 'Coefficient of sensitivity to index changes (0-1)')
      ON CONFLICT (setting_key) DO NOTHING;`);
    console.log("[v4.46] 'model_settings' table ensured.");
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
    console.log("[v4.46] 'calculation_history' table ensured (with container_type_id).");
    await initializeSeasonalityTables(client); 
    console.log("[v4.46] Seasonality tables initialized via external module.");
    await client.query("COMMIT");
    console.log("[v4.46] Database tables initialized/verified successfully.");
  } catch (error) {
    console.error("[v4.46] Error during database transaction, attempting rollback...");
    if (client) { 
      try { await client.query("ROLLBACK"); console.log("[v4.46] Transaction rolled back."); } catch (rollbackError) { console.error("[v4.46] Rollback failed:", rollbackError); }
    }
    console.error("[v4.46] Error initializing database tables:", error);
    throw error;
  } finally {
    if (client) { client.release(); console.log("[v4.46] Database client released after table initialization."); }
  }
}

// --- Загрузка начальных данных из JSON ---
async function loadInitialDataFromJson(jsonFilePathParam) {
    console.log(`[v4.46] Attempting to load initial data from ${jsonFilePathParam}...`);
    let client;
    let initialData;
    try {
        const jsonFilePath = path.isAbsolute(jsonFilePathParam) ? jsonFilePathParam : path.join(__dirname, jsonFilePathParam);
        const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
        initialData = JSON.parse(jsonData);
        console.log(`[v4.46] Successfully loaded and parsed ${jsonFilePath}`);
    } catch (err) {
        console.error(`[v4.46] Fatal Error: Could not read or parse ${jsonFilePathParam}. Ensure '${path.basename(jsonFilePathParam)}' is in the root directory. Error:`, err);
        throw new Error("Failed to load initial data from JSON file.");
    }
    if (!initialData || !initialData.ports || !initialData.container_types || !initialData.indices) {
        console.error("[v4.46] Fatal Error: JSON data is missing required keys (ports, container_types, indices).");
        throw new Error("Invalid initial data structure in JSON file.");
    }
    try {
        client = await pool.connect();
        console.log("[v4.46] Connected to DB for initial data load.");
        console.log("[v4.46] Loading ports from JSON...");
        let portCount = 0;
        for (const port of initialData.ports) {
            try {
                await client.query(
                    `INSERT INTO ports (name, code, region, country, latitude, longitude)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (name) DO UPDATE SET
                       code = EXCLUDED.code,
                       region = EXCLUDED.region,
                       country = EXCLUDED.country,
                       latitude = EXCLUDED.latitude,
                       longitude = EXCLUDED.longitude;`,
                    [port.name, port.code || null, port.region || null, port.country || null, port.latitude || null, port.longitude || null]
                );
                portCount++;
            } catch (err) {
                console.warn(`[v4.46] Error inserting/updating port row: ${JSON.stringify(port)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.46] Finished loading/updating ports. ${portCount} rows processed.`);
        console.log("[v4.46] Loading container types from JSON...");
        let ctCount = 0;
        for (const ct of initialData.container_types) {
            try {
                await client.query(
                    `INSERT INTO container_types (name, description)
                     VALUES ($1, $2)
                     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;`, 
                    [ct.name, ct.description || null]
                );
                ctCount++;
            } catch (err) {
                console.warn(`[v4.46] Error inserting/updating container type row: ${JSON.stringify(ct)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.46] Finished loading/updating container types. ${ctCount} rows processed.`);
        console.log("[v4.46] Loading index config from JSON...");
        let icCount = 0;
        for (const index of initialData.indices) {
            try {
                const baseline = parseFloat(index.baseline_value);
                const weight = parseFloat(index.weight_percentage);
                const current = parseFloat(index.current_value);
                if (index.index_name && !isNaN(baseline) && !isNaN(weight) && !isNaN(current) && weight >= 0 && weight <= 100) {
                    await client.query(
                        `INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
                         VALUES ($1, $2, $3, $4, NOW())
                         ON CONFLICT (index_name) DO UPDATE SET
                           baseline_value = EXCLUDED.baseline_value,
                           weight_percentage = EXCLUDED.weight_percentage,
                           current_value = EXCLUDED.current_value,
                           last_updated = NOW();`, 
                        [index.index_name, baseline, weight, current]
                    );
                    icCount++;
                } else {
                    console.warn(`[v4.46] Invalid data for index config row, skipping: ${JSON.stringify(index)}`);
                }
            } catch (err) {
                console.warn(`[v4.46] Error inserting/updating index_config row: ${JSON.stringify(index)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.46] Finished loading/updating index config. ${icCount} rows processed.`);
        console.log("[v4.46] Initial base rates are managed via admin panel. Skipping loading from JSON.");
        await client.query("COMMIT");
        console.log("[v4.46] Initial data loading process completed.");
    } catch (error) {
        console.error("[v4.46] Error during initial data load transaction, attempting rollback...");
        if (client) { 
            try { await client.query("ROLLBACK"); console.log("[v4.46] Transaction rolled back during initial data load."); } 
            catch (rollbackError) { console.error("[v4.46] Rollback failed during initial data load:", rollbackError); }
        }
        console.error("[v4.46] Error loading initial data:", error);
        // Do not throw here, allow server to start if possible, but log the error.
    } finally {
        if (client) { client.release(); console.log("[v4.46] Database client released after initial data load."); }
    }
}

// --- Функция для загрузки конфигурации расчета (base_rate, indices, etc.) ---
async function loadCalculationConfigFromDB(originPortId, destinationPortId, containerTypeId) {
    console.log("[v4.46 loadCalculationConfigFromDB] Attempting to load calculation config from DB.");
    let client;
    try {
        client = await pool.connect();
        const query = `
            SELECT 
                br.rate as base_rate,
                (SELECT name FROM ports WHERE id = $1) as origin_port_name,
                (SELECT name FROM ports WHERE id = $2) as destination_port_name,
                ct.name as container_type_name,
                (SELECT region FROM ports WHERE id = $1) as origin_region,
                (SELECT region FROM ports WHERE id = $2) as destination_region,
                (SELECT json_agg(json_build_object('name', index_name, 'value', current_value, 'weight', weight_percentage, 'baseline', baseline_value)) FROM index_config) as indices,
                (SELECT setting_value FROM model_settings WHERE setting_key = 'sensitivityCoeff') as sensitivity_coeff
            FROM 
                base_rates br
            JOIN 
                container_types ct ON br.container_type_id = ct.id
            WHERE 
                br.origin_region = (SELECT region FROM ports WHERE id = $1) AND
                br.destination_region = (SELECT region FROM ports WHERE id = $2) AND
                br.container_type_id = $3;
        `;
        // console.log("[v4.46 loadCalculationConfigFromDB] Executing query:", query, [originPortId, destinationPortId, containerTypeId]);
        const { rows } = await client.query(query, [originPortId, destinationPortId, containerTypeId]);
        // console.log("[v4.46 loadCalculationConfigFromDB] Query result rows:", rows);
        if (rows.length > 0) {
            console.log("[v4.46 loadCalculationConfigFromDB] Successfully loaded config from DB.");
            return rows[0];
        } else {
            console.warn("[v4.46 loadCalculationConfigFromDB] No base rate found for the given criteria.");
            return null;
        }
    } catch (error) {
        console.error("[v4.46 loadCalculationConfigFromDB] Error loading calculation config from DB:", error);
        throw error;
    } finally {
        if (client) { client.release(); console.log("[v4.46 loadCalculationConfigFromDB] Client released."); }
    }
}

// --- API Маршруты ---

// Получить все порты
app.get('/api/ports', asyncHandler(async (req, res) => {
    console.log("[v4.46 /api/ports GET] Request received.");
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT id, name, code, region, country, latitude, longitude FROM ports ORDER BY name ASC');
        const ports = result.rows.map(port => ({
            ...port,
            displayText: `${port.name} (${port.code || 'N/A'})`
        }));
        console.log(`[v4.46 /api/ports GET] Found ${ports.length} ports.`);
        res.json(ports);
    } catch (err) {
        console.error('[v4.46 /api/ports GET] Error fetching ports:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/ports GET] Client released."); }
    }
}));

// Получить все типы контейнеров
app.get('/api/container-types', asyncHandler(async (req, res) => {
    console.log("[v4.46 /api/container-types GET] Request received.");
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT id, name, description FROM container_types ORDER BY name ASC');
        console.log(`[v4.46 /api/container-types GET] Found ${result.rows.length} container types.`);
        res.json(result.rows);
    } catch (err) {
        console.error('[v4.46 /api/container-types GET] Error fetching container types:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/container-types GET] Client released."); }
    }
}));

// Рассчитать ставку
app.post('/api/calculate', asyncHandler(async (req, res) => {
    const { originPort, destinationPort, containerType, weight, email } = req.body;
    console.log("[v4.46 /api/calculate POST] Request received with body:", req.body);

    if (!originPort || !destinationPort || !containerType) {
        return res.status(400).json({ error: 'Missing required fields: originPort, destinationPort, containerType' });
    }
    console.log(`[v4.46 /api/calculate POST] Received originPort: ${originPort} (type: ${typeof originPort})`);
    console.log(`[v4.46 /api/calculate POST] Received destinationPort: ${destinationPort} (type: ${typeof destinationPort})`);
    console.log(`[v4.46 /api/calculate POST] Received containerType: ${containerType} (type: ${typeof containerType})`);

    try {
        const config = await loadCalculationConfigFromDB(originPort, destinationPort, containerType);
        if (!config) {
            return res.status(404).json({ error: 'Base rate not found for the specified criteria.' });
        }

        const seasonalityFactor = await fetchSeasonalityFactor(pool, config.origin_region, config.destination_region, new Date());
        const calculatedRate = calculateFreightRate(config, seasonalityFactor);

        const historyEntry = {
            origin_port_id: parseInt(originPort),
            destination_port_id: parseInt(destinationPort),
            container_type_id: parseInt(containerType),
            weight: weight ? parseFloat(weight) : null,
            calculated_rate: calculatedRate,
            user_email: email || null,
            index_values_used: config.indices
        };
        await saveRequestToHistory(pool, historyEntry);
        console.log("[v4.46 /api/calculate POST] Rate calculated and history saved successfully.");
        res.json({ calculatedRate });

    } catch (error) {
        console.error('[v4.46 /api/calculate POST] Error during freight calculation:', error);
        res.status(500).json({ error: 'Internal Server Error during calculation', details: error.message });
    }
}));

// --- Admin API Routes ---

// Get all base rates for admin panel
app.get('/api/admin/base-rates', asyncHandler(async (req, res) => {
    console.log("[v4.46 /api/admin/base-rates GET] Request received.");
    let client;
    try {
        client = await pool.connect();
        const query = `
            SELECT 
                br.id, 
                br.origin_region, 
                br.destination_region, 
                ct.name as container_type_name, 
                br.container_type_id, 
                br.rate
            FROM base_rates br
            JOIN container_types ct ON br.container_type_id = ct.id
            ORDER BY br.id ASC;
        `;
        const result = await client.query(query);
        console.log(`[v4.46 /api/admin/base-rates GET] Found ${result.rows.length} base rates.`);
        res.json(result.rows);
    } catch (err) {
        console.error('[v4.46 /api/admin/base-rates GET] Error fetching base rates:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/base-rates GET] Client released."); }
    }
}));

// Add a new base rate
app.post('/api/admin/base-rates', asyncHandler(async (req, res) => {
    const { origin_region, destination_region, container_type_id, rate } = req.body;
    console.log("[v4.46 /api/admin/base-rates POST] Request received with body:", req.body);
    if (!origin_region || !destination_region || !container_type_id || rate === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    let client;
    try {
        client = await pool.connect();
        const query = `
            INSERT INTO base_rates (origin_region, destination_region, container_type_id, rate)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const result = await client.query(query, [origin_region, destination_region, parseInt(container_type_id), parseFloat(rate)]);
        console.log("[v4.46 /api/admin/base-rates POST] Base rate added successfully:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[v4.46 /api/admin/base-rates POST] Error adding base rate:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/base-rates POST] Client released."); }
    }
}));

// Update an existing base rate
app.put('/api/admin/base-rates/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { origin_region, destination_region, container_type_id, rate } = req.body;
    console.log(`[v4.46 /api/admin/base-rates PUT] Request for ID ${id} with body:`, req.body);
    if (!origin_region || !destination_region || !container_type_id || rate === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    let client;
    try {
        client = await pool.connect();
        const query = `
            UPDATE base_rates
            SET origin_region = $1, destination_region = $2, container_type_id = $3, rate = $4
            WHERE id = $5
            RETURNING *;
        `;
        const result = await client.query(query, [origin_region, destination_region, parseInt(container_type_id), parseFloat(rate), parseInt(id)]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Base rate not found' });
        }
        console.log("[v4.46 /api/admin/base-rates PUT] Base rate updated successfully:", result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[v4.46 /api/admin/base-rates PUT] Error updating base rate:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/base-rates PUT] Client released."); }
    }
}));

// Delete a base rate
app.delete('/api/admin/base-rates/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    console.log(`[v4.46 /api/admin/base-rates DELETE] Request for ID ${id}`);
    let client;
    try {
        client = await pool.connect();
        const query = `DELETE FROM base_rates WHERE id = $1 RETURNING *;`;
        const result = await client.query(query, [parseInt(id)]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Base rate not found' });
        }
        console.log("[v4.46 /api/admin/base-rates DELETE] Base rate deleted successfully.");
        res.status(204).send(); // No content
    } catch (err) {
        console.error('[v4.46 /api/admin/base-rates DELETE] Error deleting base rate:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/base-rates DELETE] Client released."); }
    }
}));

// Get calculation history
app.get('/api/admin/history', asyncHandler(async (req, res) => {
    console.log("[v4.46 /api/admin/history GET] Request received.");
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    let client;
    try {
        client = await pool.connect();
        const historyQuery = `
            SELECT 
                ch.id, ch.timestamp, 
                po.name as origin_port_name, 
                pd.name as destination_port_name, 
                ct.name as container_type_name, 
                ch.weight, ch.calculated_rate, ch.user_email, ch.index_values_used
            FROM calculation_history ch
            LEFT JOIN ports po ON ch.origin_port_id = po.id
            LEFT JOIN ports pd ON ch.destination_port_id = pd.id
            LEFT JOIN container_types ct ON ch.container_type_id = ct.id
            ORDER BY ch.timestamp DESC
            LIMIT $1 OFFSET $2;
        `;
        const totalCountQuery = 'SELECT COUNT(*) FROM calculation_history;';
        
        const historyResult = await client.query(historyQuery, [limit, offset]);
        const totalCountResult = await client.query(totalCountQuery);
        const totalItems = parseInt(totalCountResult.rows[0].count);
        const totalPages = Math.ceil(totalItems / limit);

        console.log(`[v4.46 /api/admin/history GET] Found ${historyResult.rows.length} history entries for page ${page}. Total items: ${totalItems}`);
        res.json({
            data: historyResult.rows,
            currentPage: page,
            totalPages: totalPages,
            totalItems: totalItems
        });
    } catch (err) {
        console.error('[v4.46 /api/admin/history GET] Error fetching calculation history:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/history GET] Client released."); }
    }
})); 

// Get index configurations
app.get('/api/admin/indices', asyncHandler(async (req, res) => {
    console.log("[v4.46 /api/admin/indices GET] Request received.");
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name ASC');
        console.log(`[v4.46 /api/admin/indices GET] Found ${result.rows.length} indices.`);
        res.json(result.rows);
    } catch (err) {
        console.error('[v4.46 /api/admin/indices GET] Error fetching indices:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/indices GET] Client released."); }
    }
}));

// Update index configurations
app.post('/api/admin/indices', asyncHandler(async (req, res) => {
    const indices = req.body; // Expects an array of index objects
    console.log("[v4.46 /api/admin/indices POST] Request received with body:", req.body);
    if (!Array.isArray(indices)) {
        return res.status(400).json({ error: 'Request body must be an array of index configurations.' });
    }
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        for (const index of indices) {
            if (!index.index_name || index.baseline_value === undefined || index.weight_percentage === undefined || index.current_value === undefined) {
                throw new Error(`Invalid data for index: ${JSON.stringify(index)}. All fields are required.`);
            }
            const query = `
                INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (index_name) DO UPDATE SET
                    baseline_value = EXCLUDED.baseline_value,
                    weight_percentage = EXCLUDED.weight_percentage,
                    current_value = EXCLUDED.current_value,
                    last_updated = NOW();
            `;
            await client.query(query, [index.index_name, parseFloat(index.baseline_value), parseFloat(index.weight_percentage), parseFloat(index.current_value)]);
        }
        await client.query('COMMIT');
        console.log("[v4.46 /api/admin/indices POST] Indices updated successfully.");
        res.status(200).json({ message: 'Indices updated successfully' });
    } catch (err) {
        if (client) { try { await client.query('ROLLBACK'); } catch (rbErr) { console.error("[v4.46 /api/admin/indices POST] Rollback error:", rbErr); } }
        console.error('[v4.46 /api/admin/indices POST] Error updating indices:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/indices POST] Client released."); }
    }
}));

// Get model settings
app.get('/api/admin/settings', asyncHandler(async (req, res) => {
    console.log("[v4.46 /api/admin/settings GET] Request received.");
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT setting_key, setting_value, description FROM model_settings');
        const settingsMap = result.rows.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});
        console.log(`[v4.46 /api/admin/settings GET] Found ${result.rows.length} settings.`);
        res.json(settingsMap); // Return as a map for easier access on client-side
    } catch (err) {
        console.error('[v4.46 /api/admin/settings GET] Error fetching settings:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/settings GET] Client released."); }
    }
}));

// Update model settings
app.post('/api/admin/settings', asyncHandler(async (req, res) => {
    const settings = req.body; // Expects an object dificuldades { setting_key: value, ... }
    console.log("[v4.46 /api/admin/settings POST] Request received with body:", req.body);
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        for (const key in settings) {
            if (settings.hasOwnProperty(key)) {
                const query = `
                    INSERT INTO model_settings (setting_key, setting_value)
                    VALUES ($1, $2)
                    ON CONFLICT (setting_key) DO UPDATE SET
                        setting_value = EXCLUDED.setting_value;
                `;
                await client.query(query, [key, settings[key]]);
            }
        }
        await client.query('COMMIT');
        console.log("[v4.46 /api/admin/settings POST] Settings updated successfully.");
        res.status(200).json({ message: 'Settings updated successfully' });
    } catch (err) {
        if (client) { try { await client.query('ROLLBACK'); } catch (rbErr) { console.error("[v4.46 /api/admin/settings POST] Rollback error:", rbErr); } }
        console.error('[v4.46 /api/admin/settings POST] Error updating settings:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/settings POST] Client released."); }
    }
}));

// Endpoint for uploading and processing Excel file for base rates
app.post('/api/admin/upload-base-rates', upload.single('baseRatesFile'), asyncHandler(async (req, res) => {
    console.log("[v4.46 /api/admin/upload-base-rates POST] File upload request received.");
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    let client;
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        console.log(`[v4.46 /api/admin/upload-base-rates POST] Parsed ${data.length} rows from Excel.`);

        client = await pool.connect();
        await client.query('BEGIN');

        // Optional: Clear existing base rates before inserting new ones
        // await client.query('DELETE FROM base_rates;'); 
        // console.log("[v4.46 /api/admin/upload-base-rates POST] Cleared existing base rates.");

        let successfulInserts = 0;
        let failedInserts = 0;

        for (const row of data) {
            const { origin_region, destination_region, container_type_name, rate } = row;
            if (!origin_region || !destination_region || !container_type_name || rate === undefined) {
                console.warn(`[v4.46 /api/admin/upload-base-rates POST] Skipping row due to missing data: ${JSON.stringify(row)}`);
                failedInserts++;
                continue;
            }

            try {
                // Get container_type_id from container_type_name
                const ctRes = await client.query('SELECT id FROM container_types WHERE name = $1', [container_type_name]);
                if (ctRes.rows.length === 0) {
                    console.warn(`[v4.46 /api/admin/upload-base-rates POST] Container type name "${container_type_name}" not found. Skipping row: ${JSON.stringify(row)}`);
                    failedInserts++;
                    continue;
                }
                const container_type_id = ctRes.rows[0].id;

                const insertQuery = `
                    INSERT INTO base_rates (origin_region, destination_region, container_type_id, rate)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (origin_region, destination_region, container_type_id) 
                    DO UPDATE SET rate = EXCLUDED.rate;
                `;
                await client.query(insertQuery, [origin_region, destination_region, container_type_id, parseFloat(rate)]);
                successfulInserts++;
            } catch (rowError) {
                console.error(`[v4.46 /api/admin/upload-base-rates POST] Error inserting row ${JSON.stringify(row)}:`, rowError);
                failedInserts++;
            }
        }

        await client.query('COMMIT');
        console.log(`[v4.46 /api/admin/upload-base-rates POST] Base rates upload completed. Successful: ${successfulInserts}, Failed: ${failedInserts}`);
        res.status(200).json({ message: `Base rates uploaded. Successful: ${successfulInserts}, Failed: ${failedInserts}` });

    } catch (err) {
        if (client) { try { await client.query('ROLLBACK'); } catch (rbErr) { console.error("[v4.46 /api/admin/upload-base-rates POST] Rollback error:", rbErr); } }
        console.error('[v4.46 /api/admin/upload-base-rates POST] Error processing Excel file:', err);
        res.status(500).json({ error: 'Error processing Excel file.', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/upload-base-rates POST] Client released."); }
    }
}));

// Initialize seasonality data endpoint (for admin use, if needed)
app.post('/api/admin/init-seasonality', asyncHandler(async (req, res) => {
    console.log("[v4.46 /api/admin/init-seasonality POST] Request received.");
    let client;
    try {
        client = await pool.connect();
        // This function now expects a client to be passed
        await initializeAndUpdateSeasonalityData(client, true); // Pass client and true to force update
        console.log("[v4.46 /api/admin/init-seasonality POST] Seasonality data initialized/updated.");
        res.status(200).json({ message: 'Seasonality data initialized/updated successfully.' });
    } catch (err) {
        console.error('[v4.46 /api/admin/init-seasonality POST] Error initializing seasonality data:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (client) { client.release(); console.log("[v4.46 /api/admin/init-seasonality POST] Client released."); }
    }
}));

// --- Server Initialization ---
async function startServer() {
    try {
        // 1. Run robust auto-migration first
        await autoMigrateDatabase();
        
        // 2. Initialize database tables (ensures they exist with correct schema if not already)
        await initializeDatabaseTables();
        
        // 3. Load initial data from JSON (ports, container types, indices)
        // Ensure 'extracted_data.json' is in the root directory of the project.
        await loadInitialDataFromJson('./extracted_data.json'); 

        // 4. Initialize or update seasonality data
        // This function now expects a client, so we need to manage it here or adapt the function.
        // For simplicity, let's connect and release here for this one-time call.
        const tempClient = await pool.connect();
        try {
            await initializeAndUpdateSeasonalityData(tempClient); // Pass client
        } finally {
            tempClient.release();
        }

        app.listen(PORT, () => {
            console.log(`Initializing freight calculator system v4.46 (Robust Auto-Migration).`); // Updated version here
            console.log(`[v4.46 Robust Migration] Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error("[v4.46] Failed to start server due to critical error during initialization:", error);
        process.exit(1); // Exit if critical initialization fails (e.g., migration or table creation)
    }
}

startServer();

