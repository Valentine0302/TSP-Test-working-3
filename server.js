 // Интеграционный модуль v4.27: Диагностическое логирование.

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

// --- Инициализация системы --- 
async function initializeSystem() {
  try {
     console.log("Initializing freight calculator system v4.27 (Diagnostic Logging).");
    await initializeDatabaseTables();
    await loadInitialDataFromJson(); 
    console.log('System initialization completed for v4.27_diagnostic');
  } catch (error) {
    console.error('Error initializing system (v4.27_diagnostic):', error);
    throw error;
  }
}

// --- Загрузка начальных данных из JSON ---
async function loadInitialDataFromJson() {
    console.log("[v4.27_diagnostic] Attempting to load initial data from extracted_data.json...");
    let client;
    let initialData;

    try {
        const jsonFilePath = path.join(__dirname, 'extracted_data.json');
        const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
        initialData = JSON.parse(jsonData);
        console.log("[v4.27_diagnostic] Successfully loaded and parsed extracted_data.json");
    } catch (err) {
        console.error("[v4.27_diagnostic] Fatal Error: Could not read or parse extracted_data.json. Cannot load initial data.", err);
        throw new Error("Failed to load initial data from JSON file.");
    }

    if (!initialData || !initialData.ports || !initialData.container_types || !initialData.indices) {
        console.error("[v4.27_diagnostic] Fatal Error: extracted_data.json is missing required keys (ports, container_types, indices).");
        throw new Error("Invalid initial data structure in JSON file.");
    }

    try {
        client = await pool.connect();
        console.log("[v4.27_diagnostic] Connected to DB for initial data load.");

        console.log("[v4.27_diagnostic] Loading ports from JSON...");
        let portCount = 0;
        for (const port of initialData.ports) {
            try {
                await client.query(
                    `INSERT INTO ports (name, code, region, country, latitude, longitude)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (name) DO NOTHING;`,
                    [port.name, port.code || null, port.region || null, port.country || null, port.latitude || null, port.longitude || null]
                );
                portCount++;
            } catch (err) {
                console.warn(`[v4.27_diagnostic] Error inserting port row: ${JSON.stringify(port)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.27_diagnostic] Finished loading ports. ${portCount} rows processed.`);

        console.log("[v4.27_diagnostic] Loading container types from JSON...");
        let ctCount = 0;
        for (const ct of initialData.container_types) {
            try {
                await client.query(
                    `INSERT INTO container_types (name, description)
                     VALUES ($1, $2)
                     ON CONFLICT (name) DO NOTHING;`, 
                    [ct.name, ct.description || null]
                );
                ctCount++;
            } catch (err) {
                console.warn(`[v4.27_diagnostic] Error inserting container type row: ${JSON.stringify(ct)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.27_diagnostic] Finished loading container types. ${ctCount} rows processed.`);

        console.log("[v4.27_diagnostic] Loading index config from JSON...");
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
                         ON CONFLICT (index_name) DO NOTHING;`, 
                        [index.index_name, baseline, weight, current]
                    );
                    icCount++;
                } else {
                     console.warn(`[v4.27_diagnostic] Skipping invalid index config row: ${JSON.stringify(index)}`);
                }
            } catch (err) {
                console.warn(`[v4.27_diagnostic] Error inserting index config row: ${JSON.stringify(index)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.27_diagnostic] Finished loading index config. ${icCount} rows processed.`);
        
        console.log("[v4.27_diagnostic] Skipping initial base rate loading. Base rates should be managed via admin panel.");

        console.log("[v4.27_diagnostic] Initial data loading process completed.");

    } catch (error) {
        console.error("[v4.27_diagnostic] Error loading initial data into database:", error);
    } finally {
        if (client) { client.release(); console.log("[v4.27_diagnostic] Database client released after initial data load."); }
    }
}

async function initializeDatabaseTables() {
  console.log("[v4.27_diagnostic] Initializing database tables...");
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    console.log("[v4.27_diagnostic] Dropping and recreating 'ports' table...");
    await client.query(`DROP TABLE IF EXISTS ports CASCADE;`);
    await client.query(`
      CREATE TABLE ports (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL, 
        code VARCHAR(10), 
        region VARCHAR(50),
        latitude NUMERIC,
        longitude NUMERIC,
        country VARCHAR(100)
      );
    `);
    console.log("[v4.27_diagnostic] 'ports' table recreated successfully.");

    console.log("[v4.27_diagnostic] Dropping and recreating 'container_types' table...");
    await client.query(`DROP TABLE IF EXISTS container_types CASCADE;`);
    await client.query(`
      CREATE TABLE container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, 
        description TEXT
      );
    `);
    console.log("[v4.27_diagnostic] 'container_types' table recreated successfully.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS base_rates (
        id SERIAL PRIMARY KEY, 
        origin_region VARCHAR(50) NOT NULL,
        destination_region VARCHAR(50) NOT NULL,
        container_type VARCHAR(50) NOT NULL, 
        rate NUMERIC NOT NULL,
        UNIQUE(origin_region, destination_region, container_type),
        FOREIGN KEY (container_type) REFERENCES container_types(name) ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await client.query(`ALTER TABLE base_rates ALTER COLUMN container_type TYPE VARCHAR(50);`);
    console.log("[v4.27_diagnostic] 'base_rates' table ensured.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS index_config (
        index_name VARCHAR(50) PRIMARY KEY,
        baseline_value NUMERIC NOT NULL,
        weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        current_value NUMERIC,
        last_updated TIMESTAMP
      );
    `);
    console.log("[v4.27_diagnostic] 'index_config' table ensured.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS model_settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        description TEXT
      );
    `);
    await client.query(`ALTER TABLE model_settings ADD COLUMN IF NOT EXISTS description TEXT;`);
    await client.query(`INSERT INTO model_settings (setting_key, setting_value, description) VALUES 
      ('sensitivityCoeff', '0.5', 'Coefficient of sensitivity to index changes (0-1)')
      ON CONFLICT (setting_key) DO NOTHING;`);
    console.log("[v4.27_diagnostic] 'model_settings' table ensured.");

    console.log("[v4.27_diagnostic] Dropping and recreating 'calculation_history' table...");
    await client.query(`DROP TABLE IF EXISTS calculation_history CASCADE;`);
    await client.query(`
      CREATE TABLE calculation_history (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        origin_port_code VARCHAR(10), 
        destination_port_code VARCHAR(10),
        container_type VARCHAR(50) NOT NULL, 
        weight NUMERIC,
        calculated_rate NUMERIC, 
        user_email VARCHAR(255),
        origin_port_id INT, 
        destination_port_id INT, 
        index_values_used JSONB 
      );
    `);
    console.log("[v4.27_diagnostic] 'calculation_history' table recreated successfully.");
    await client.query(`ALTER TABLE calculation_history DROP COLUMN IF EXISTS origin_port;`);
    await client.query(`ALTER TABLE calculation_history DROP COLUMN IF EXISTS destination_port;`);
    await client.query(`ALTER TABLE calculation_history ALTER COLUMN container_type TYPE VARCHAR(50);`);

    await initializeSeasonalityTables(client); 
    console.log("[v4.27_diagnostic] Seasonality tables initialized via external module.");

    await client.query("COMMIT");
    console.log("[v4.27_diagnostic] Database tables initialized/verified successfully.");

  } catch (error) {
    console.error("[v4.27_diagnostic] Error during database transaction, attempting rollback...");
    if (client) { 
      try { await client.query("ROLLBACK"); console.log("[v4.27_diagnostic] Transaction rolled back."); } catch (rollbackError) { console.error("[v4.27_diagnostic] Rollback failed:", rollbackError); }
    }
    console.error("[v4.27_diagnostic] Error initializing database tables:", error);
    throw error;
  } finally {
    if (client) { client.release(); console.log("[v4.27_diagnostic] Database client released after table initialization."); }
  }
}

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validateEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

async function loadCalculationConfigFromDB() {
    console.log("[v4.27_diagnostic loadCalculationConfigFromDB] Attempting to load calculation config from DB.");
    let client;
    try {
        client = await pool.connect();
        console.log("[v4.27_diagnostic loadCalculationConfigFromDB] DB connected.");

        const baseRatesResult = await client.query('SELECT origin_region, destination_region, container_type, rate FROM base_rates');
        console.log(`[v4.27_diagnostic loadCalculationConfigFromDB] Fetched ${baseRatesResult.rowCount} base rates rows.`);
        const baseRatesConfig = {};
        baseRatesResult.rows.forEach(row => {
            if (!baseRatesConfig[row.origin_region]) baseRatesConfig[row.origin_region] = {};
            if (!baseRatesConfig[row.origin_region][row.destination_region]) baseRatesConfig[row.origin_region][row.destination_region] = {};
            baseRatesConfig[row.origin_region][row.destination_region][row.container_type] = parseFloat(row.rate);
        });
        console.log("[v4.27_diagnostic loadCalculationConfigFromDB] Processed baseRatesConfig:", JSON.stringify(baseRatesConfig).substring(0, 500) + (JSON.stringify(baseRatesConfig).length > 500 ? "... (truncated)" : ""));

        const indexConfigResult = await client.query('SELECT index_name, baseline_value, weight_percentage, current_value FROM index_config');
        console.log(`[v4.27_diagnostic loadCalculationConfigFromDB] Fetched ${indexConfigResult.rowCount} index config rows.`);
        const indicesConfig = {};
        indexConfigResult.rows.forEach(row => {
            indicesConfig[row.index_name] = {
                baseline: parseFloat(row.baseline_value),
                weight: parseFloat(row.weight_percentage) / 100, 
                currentValue: parseFloat(row.current_value)
            };
        });
        console.log("[v4.27_diagnostic loadCalculationConfigFromDB] Processed indicesConfig:", JSON.stringify(indicesConfig).substring(0, 500) + (JSON.stringify(indicesConfig).length > 500 ? "... (truncated)" : ""));

        const settingsResult = await client.query('SELECT setting_key, setting_value FROM model_settings');
        console.log(`[v4.27_diagnostic loadCalculationConfigFromDB] Fetched ${settingsResult.rowCount} model settings rows.`);
        const modelSettings = {};
        settingsResult.rows.forEach(row => {
            modelSettings[row.setting_key] = parseFloat(row.setting_value);
        });
        console.log("[v4.27_diagnostic loadCalculationConfigFromDB] Processed modelSettings:", modelSettings);

        const containerTypesResult = await client.query('SELECT name, description FROM container_types');
        const containerTypes = containerTypesResult.rows;
        console.log(`[v4.27_diagnostic loadCalculationConfigFromDB] Fetched ${containerTypes.length} container types.`);

        client.release();
        console.log("[v4.27_diagnostic loadCalculationConfigFromDB] DB client released. Config loaded.");
        return { baseRatesConfig, indicesConfig, modelSettings, containerTypes };

    } catch (error) {
        if (client) client.release();
        console.error('[v4.27_diagnostic loadCalculationConfigFromDB] Error loading calculation config from DB:', error);
        throw error;
    }
}

app.post("/api/calculate", asyncHandler(async (req, res, next) => {
    console.log("[v4.27_diagnostic /api/calculate] Received request. Body:", JSON.stringify(req.body));
    const { originPort, destinationPort, containerType, weight, userEmail } = req.body;

    if (!originPort || !destinationPort || !containerType) {
        console.error("[v4.27_diagnostic /api/calculate] Validation Error: Missing required fields.");
        return res.status(400).json({ error: 'Missing required fields: originPort, destinationPort, containerType' });
    }
    if (userEmail && !validateEmail(userEmail)) {
        console.error("[v4.27_diagnostic /api/calculate] Validation Error: Invalid email format.");
        return res.status(400).json({ error: 'Invalid email format' });
    }
    console.log("[v4.27_diagnostic /api/calculate] Inputs validated successfully.");

    let client;
    try {
        client = await pool.connect();
        console.log("[v4.27_diagnostic /api/calculate] Connected to DB for calculation.");

        console.log(`[v4.27_diagnostic /api/calculate] Fetching origin port data for: ${originPort}`);
        const originPortData = await client.query('SELECT * FROM ports WHERE COALESCE(code, name) = $1 LIMIT 1', [originPort]);
        console.log("[v4.27_diagnostic /api/calculate] Origin port data from DB:", originPortData.rows);

        console.log(`[v4.27_diagnostic /api/calculate] Fetching destination port data for: ${destinationPort}`);
        const destinationPortData = await client.query('SELECT * FROM ports WHERE COALESCE(code, name) = $1 LIMIT 1', [destinationPort]);
        console.log("[v4.27_diagnostic /api/calculate] Destination port data from DB:", destinationPortData.rows);

        if (originPortData.rows.length === 0 || destinationPortData.rows.length === 0) {
            console.error("[v4.27_diagnostic /api/calculate] Error: Origin or destination port not found in DB.");
            if (client) client.release();
            return res.status(404).json({ error: 'Origin or destination port not found' });
        }
        console.log("[v4.27_diagnostic /api/calculate] Ports found successfully.");

        const originPortDb = originPortData.rows[0];
        const destinationPortDb = destinationPortData.rows[0];

        console.log("[v4.27_diagnostic /api/calculate] Loading calculation config...");
        const config = await loadCalculationConfigFromDB(); 
        console.log("[v4.27_diagnostic /api/calculate] Calculation config loaded.");

        const calculationParams = {
            originPortId: originPortDb.id, 
            destinationPortId: destinationPortDb.id, 
            containerType,
            baseRatesConfig: config.baseRatesConfig,
            indexConfig: config.indicesConfig,
            sensitivityCoeff: config.modelSettings?.sensitivityCoeff || 0.5, 
            weight: weight ? parseFloat(weight) : undefined,
            debugMode: true 
        };
        console.log("[v4.27_diagnostic /api/calculate] Calling calculateFreightRate with params:", JSON.stringify(calculationParams).substring(0,1000) + "...");

        const rateDetails = await calculateFreightRate(
            calculationParams.originPortId,
            calculationParams.destinationPortId,
            calculationParams.containerType,
            calculationParams.baseRatesConfig,
            calculationParams.indexConfig,
            calculationParams.sensitivityCoeff,
            calculationParams.weight,
            calculationParams.debugMode
        );
        console.log("[v4.27_diagnostic /api/calculate] Result from calculateFreightRate:", JSON.stringify(rateDetails).substring(0,1000) + "...");

        if (userEmail && rateDetails.finalRate !== -1) {
            console.log("[v4.27_diagnostic /api/calculate] Saving request to history for user:", userEmail);
            try {
                await saveRequestToHistory(
                    originPortDb.code || originPortDb.name, 
                    destinationPortDb.code || destinationPortDb.name, 
                    containerType, 
                    weight, 
                    rateDetails.finalRate, 
                    userEmail, 
                    originPortDb.id, 
                    destinationPortDb.id,
                    rateDetails.calculationDetails?.indexSources || [] 
                );
                console.log("[v4.27_diagnostic /api/calculate] Request saved to history successfully.");
            } catch (historyError) {
                console.error("[v4.27_diagnostic /api/calculate] Error saving to history:", historyError);
            }
        }

        const responsePayload = {
            rate: rateDetails.finalRate,
            details: rateDetails.calculationDetails,
            currency: 'USD', // Assuming USD, can be made dynamic later
            debugLog: rateDetails.debugLog // Include full debug log from calculator
        };
        console.log("[v4.27_diagnostic /api/calculate] Sending response:", JSON.stringify(responsePayload).substring(0,500) + "...");
        res.json(responsePayload);

    } catch (error) {
        console.error('[v4.27_diagnostic /api/calculate] Critical error in /api/calculate handler:', error);
        // Ensure 'next' is called for Express error handling if not sending response directly
        // However, since we are sending a JSON response for errors, next(error) might not be needed here
        // if it's caught by asyncHandler and we want a JSON response.
        // For now, let's send a generic error response.
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error during calculation', details: error.message });
        }
    } finally {
        if (client) {
            client.release();
            console.log("[v4.27_diagnostic /api/calculate] DB client released.");
        }
    }
}));

// --- Admin API Эндпоинты (ОСТАВЛЕНЫ БЕЗ ИЗМЕНЕНИЙ ОТ v4.26) --- 

// Получить все порты
app.get('/api/admin/ports', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, code, region, country, latitude, longitude FROM ports ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching ports for admin:', err);
        res.status(500).json({ error: 'Failed to fetch ports', details: err.message });
    }
});

// Добавить порт
app.post('/api/admin/ports', async (req, res) => {
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Port name is required' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO ports (name, code, region, country, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, code || null, region || null, country || null, latitude || null, longitude || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding port for admin:', err);
        if (err.code === '23505') { // unique_violation
            return res.status(409).json({ error: 'Port with this name already exists', details: err.detail });
        }
        res.status(500).json({ error: 'Failed to add port', details: err.message });
    }
});

// Обновить порт
app.put('/api/admin/ports/:id', async (req, res) => {
    const { id } = req.params;
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Port name is required' });
    }
    try {
        const result = await pool.query(
            'UPDATE ports SET name = $1, code = $2, region = $3, country = $4, latitude = $5, longitude = $6 WHERE id = $7 RETURNING *',
            [name, code || null, region || null, country || null, latitude || null, longitude || null, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Port not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating port for admin:', err);
         if (err.code === '23505') { 
            return res.status(409).json({ error: 'Port with this name already exists', details: err.detail });
        }
        res.status(500).json({ error: 'Failed to update port', details: err.message });
    }
});

// Удалить порт
app.delete('/api/admin/ports/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM ports WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Port not found' });
        }
        res.status(200).json({ message: 'Port deleted successfully' });
    } catch (err) {
        console.error('Error deleting port for admin:', err);
        res.status(500).json({ error: 'Failed to delete port', details: err.message });
    }
});


// Получить все типы контейнеров
app.get('/api/admin/container-types', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, description FROM container_types ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching container types for admin:', err);
        res.status(500).json({ error: 'Failed to fetch container types', details: err.message });
    }
});

// Добавить тип контейнера
app.post('/api/admin/container-types', async (req, res) => {
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Container type name is required' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO container_types (name, description) VALUES ($1, $2) RETURNING *',
            [name, description || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding container type for admin:', err);
        if (err.code === '23505') { // unique_violation
            return res.status(409).json({ error: 'Container type with this name already exists', details: err.detail });
        }
        res.status(500).json({ error: 'Failed to add container type', details: err.message });
    }
});

// Обновить тип контейнера
app.put('/api/admin/container-types/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
     if (!name) {
        return res.status(400).json({ error: 'Container type name is required' });
    }
    try {
        const result = await pool.query(
            'UPDATE container_types SET name = $1, description = $2 WHERE id = $3 RETURNING *',
            [name, description || null, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Container type not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating container type for admin:', err);
        if (err.code === '23505') { 
            return res.status(409).json({ error: 'Container type with this name already exists', details: err.detail });
        }
        res.status(500).json({ error: 'Failed to update container type', details: err.message });
    }
});

// Удалить тип контейнера
app.delete('/api/admin/container-types/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM container_types WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Container type not found' });
        }
        res.status(200).json({ message: 'Container type deleted successfully' });
    } catch (err) {
        console.error('Error deleting container type for admin:', err);
        // Check for foreign key constraint violation (e.g., if used in base_rates)
        if (err.code === '23503') { // foreign_key_violation
             return res.status(409).json({ error: 'Cannot delete container type. It is currently referenced in base rates.', details: err.detail });
        }
        res.status(500).json({ error: 'Failed to delete container type', details: err.message });
    }
});

// Получить все базовые ставки
app.get('/api/admin/base-rates', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, origin_region, destination_region, container_type, rate FROM base_rates ORDER BY origin_region, destination_region, container_type');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching base rates for admin:', err);
        res.status(500).json({ error: 'Failed to fetch base rates', details: err.message });
    }
});

// Добавить/Обновить базовую ставку (UPSERT)
app.post('/api/admin/base-rates', async (req, res) => {
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate === undefined) {
        return res.status(400).json({ error: 'All fields (origin_region, destination_region, container_type, rate) are required' });
    }
    if (isNaN(parseFloat(rate)) || parseFloat(rate) < 0) {
        return res.status(400).json({ error: 'Rate must be a non-negative number.' });
    }

    try {
        // Check if container_type exists
        const ctExists = await pool.query('SELECT 1 FROM container_types WHERE name = $1', [container_type]);
        if (ctExists.rows.length === 0) {
            return res.status(400).json({ error: `Container type '${container_type}' does not exist. Please add it first.` });
        }

        const result = await pool.query(
            `INSERT INTO base_rates (origin_region, destination_region, container_type, rate)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (origin_region, destination_region, container_type) 
             DO UPDATE SET rate = EXCLUDED.rate
             RETURNING *`,
            [origin_region, destination_region, container_type, parseFloat(rate)]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error upserting base rate for admin:', err);
        res.status(500).json({ error: 'Failed to upsert base rate', details: err.message });
    }
});

// Удалить базовую ставку
app.delete('/api/admin/base-rates', async (req, res) => {
    const { origin_region, destination_region, container_type } = req.body;
     if (!origin_region || !destination_region || !container_type) {
        return res.status(400).json({ error: 'All fields (origin_region, destination_region, container_type) are required for deletion' });
    }
    try {
        const result = await pool.query(
            'DELETE FROM base_rates WHERE origin_region = $1 AND destination_region = $2 AND container_type = $3 RETURNING *',
            [origin_region, destination_region, container_type]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Base rate not found for the given criteria' });
        }
        res.status(200).json({ message: 'Base rate deleted successfully' });
    } catch (err) {
        console.error('Error deleting base rate for admin:', err);
        res.status(500).json({ error: 'Failed to delete base rate', details: err.message });
    }
});

// Получить конфигурацию индексов
app.get('/api/admin/index-config', async (req, res) => {
    try {
        const result = await pool.query('SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching index config for admin:', err);
        res.status(500).json({ error: 'Failed to fetch index config', details: err.message });
    }
});

// Обновить/Добавить конфигурацию индекса (UPSERT)
app.post('/api/admin/index-config', async (req, res) => {
    const { index_name, baseline_value, weight_percentage, current_value } = req.body;
    if (!index_name || baseline_value === undefined || weight_percentage === undefined) {
        return res.status(400).json({ error: 'Fields index_name, baseline_value, weight_percentage are required' });
    }
    const bl_val = parseFloat(baseline_value);
    const w_perc = parseFloat(weight_percentage);
    const cur_val = current_value !== undefined ? parseFloat(current_value) : null;

    if (isNaN(bl_val) || bl_val <= 0) {
        return res.status(400).json({ error: 'Baseline value must be a positive number.'});
    }
    if (isNaN(w_perc) || w_perc < 0 || w_perc > 100) {
        return res.status(400).json({ error: 'Weight percentage must be between 0 and 100.'});
    }
    if (current_value !== undefined && (cur_val === null || isNaN(cur_val) || cur_val <=0)) {
         return res.status(400).json({ error: 'Current value, if provided, must be a positive number.'});
    }

    try {
        const result = await pool.query(
            `INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (index_name) 
             DO UPDATE SET baseline_value = EXCLUDED.baseline_value, 
                           weight_percentage = EXCLUDED.weight_percentage, 
                           current_value = EXCLUDED.current_value, 
                           last_updated = NOW()
             RETURNING *`,
            [index_name, bl_val, w_perc, cur_val]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error upserting index config for admin:', err);
        res.status(500).json({ error: 'Failed to upsert index config', details: err.message });
    }
});

// Удалить конфигурацию индекса
app.delete('/api/admin/index-config/:index_name', async (req, res) => {
    const { index_name } = req.params;
    try {
        const result = await pool.query('DELETE FROM index_config WHERE index_name = $1 RETURNING *', [index_name]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Index config not found' });
        }
        res.status(200).json({ message: 'Index config deleted successfully' });
    } catch (err) {
        console.error('Error deleting index config for admin:', err);
        res.status(500).json({ error: 'Failed to delete index config', details: err.message });
    }
});

// Получить настройки модели
app.get('/api/admin/model-settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT setting_key, setting_value, description FROM model_settings');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching model settings for admin:', err);
        res.status(500).json({ error: 'Failed to fetch model settings', details: err.message });
    }
});

// Обновить/Добавить настройку модели (UPSERT)
app.post('/api/admin/model-settings', async (req, res) => {
    const { setting_key, setting_value, description } = req.body;
    if (!setting_key || !setting_value) {
        return res.status(400).json({ error: 'Fields setting_key and setting_value are required' });
    }
    // Add validation for specific keys if needed, e.g., sensitivityCoeff between 0 and 1
    if (setting_key === 'sensitivityCoeff') {
        const val = parseFloat(setting_value);
        if (isNaN(val) || val < 0 || val > 1) {
            return res.status(400).json({ error: 'sensitivityCoeff must be a number between 0 and 1.' });
        }
    }
    try {
        const result = await pool.query(
            `INSERT INTO model_settings (setting_key, setting_value, description)
             VALUES ($1, $2, $3)
             ON CONFLICT (setting_key) 
             DO UPDATE SET setting_value = EXCLUDED.setting_value, description = EXCLUDED.description
             RETURNING *`,
            [setting_key, setting_value, description || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error upserting model setting for admin:', err);
        res.status(500).json({ error: 'Failed to upsert model setting', details: err.message });
    }
});

// Загрузка данных из Excel (для базовых ставок)
app.post('/api/admin/upload-excel/base-rates', upload.single('excelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    let client;
    try {
        console.log("[v4.27_diagnostic /api/admin/upload-excel/base-rates] File upload request received.");
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
            return res.status(400).send('Excel file is empty or has an invalid format.');
        }

        // Validate headers
        const expectedHeaders = ['origin_region', 'destination_region', 'container_type', 'rate'];
        const actualHeaders = Object.keys(data[0]);
        const missingHeaders = expectedHeaders.filter(h => !actualHeaders.includes(h));
        if (missingHeaders.length > 0) {
            return res.status(400).send(`Missing required headers in Excel: ${missingHeaders.join(', ')}`);
        }

        client = await pool.connect();
        await client.query('BEGIN');
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const row of data) {
            const { origin_region, destination_region, container_type, rate } = row;
            if (!origin_region || !destination_region || !container_type || rate === undefined || rate === null) {
                errorCount++;
                errors.push(`Skipped row due to missing data: ${JSON.stringify(row)}`);
                continue;
            }
            const parsedRate = parseFloat(rate);
            if (isNaN(parsedRate) || parsedRate < 0) {
                errorCount++;
                errors.push(`Skipped row due to invalid rate '${rate}': ${JSON.stringify(row)}`);
                continue;
            }
            
            // Check if container_type exists
            const ctExists = await client.query('SELECT 1 FROM container_types WHERE name = $1', [container_type]);
            if (ctExists.rows.length === 0) {
                 errorCount++;
                 errors.push(`Skipped row: Container type '${container_type}' does not exist. Row: ${JSON.stringify(row)}`);
                 continue;
            }

            try {
                await client.query(
                    `INSERT INTO base_rates (origin_region, destination_region, container_type, rate)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (origin_region, destination_region, container_type) 
                     DO UPDATE SET rate = EXCLUDED.rate`,
                    [origin_region, destination_region, container_type, parsedRate]
                );
                successCount++;
            } catch (dbError) {
                errorCount++;
                errors.push(`DB error for row ${JSON.stringify(row)}: ${dbError.message}`);
            }
        }

        await client.query('COMMIT');
        console.log(`[v4.27_diagnostic /api/admin/upload-excel/base-rates] Excel import complete. Success: ${successCount}, Errors: ${errorCount}`);
        res.status(200).json({
            message: `Import completed. Successfully processed: ${successCount}. Failed: ${errorCount}.`,
            errors: errors
        });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('[v4.27_diagnostic /api/admin/upload-excel/base-rates] Error processing Excel file for base rates:', err);
        res.status(500).send('Error processing Excel file: ' + err.message);
    } finally {
        if (client) client.release();
    }
});

// Эндпоинт для инициализации и обновления данных сезонности (если нужно вызвать вручную)
app.post('/api/admin/update-seasonality', async (req, res) => {
    try {
        console.log("[v4.27_diagnostic /api/admin/update-seasonality] Request to update seasonality data.");
        await initializeAndUpdateSeasonalityData(pool); // Передаем пул в функцию
        res.status(200).json({ message: 'Seasonality data update process initiated successfully.' });
    } catch (error) {
        console.error('[v4.27_diagnostic /api/admin/update-seasonality] Error initiating seasonality update:', error);
        res.status(500).json({ error: 'Failed to initiate seasonality update', details: error.message });
    }
});

// --- Запуск сервера --- 
async function startServer() {
  try {
    await initializeSystem();
    app.listen(PORT, () => {
      console.log(`Server v4.27 (Diagnostic Logging) is running on port ${PORT}`);
      console.log(`Admin panel should be accessible at /admin.html (if deployed)`);
    });
  } catch (error) {
    console.error("Failed to start server (v4.27_diagnostic):", error);
    process.exit(1); // Выход, если инициализация не удалась
  }
}

startServer();

