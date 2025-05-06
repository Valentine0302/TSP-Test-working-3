/ Интеграционный модуль v4.28: Всеобъемлющее диагностическое логирование админ-панели.

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

// --- Инициализация системы --- 
async function initializeSystem() {
  try {
     console.log("Initializing freight calculator system v4.28 (Admin Panel Diagnostic).");
    await initializeDatabaseTables();
    await loadInitialDataFromJson(); 
    console.log('System initialization completed for v4.28_admin_diagnostic');
  } catch (error) {
    console.error('Error initializing system (v4.28_admin_diagnostic):', error);
    throw error;
  }
}

// --- Загрузка начальных данных из JSON ---
async function loadInitialDataFromJson() {
    console.log("[v4.28_admin_diagnostic] Attempting to load initial data from extracted_data.json...");
    let client;
    let initialData;

    try {
        const jsonFilePath = path.join(__dirname, 'extracted_data.json');
        const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
        initialData = JSON.parse(jsonData);
        console.log("[v4.28_admin_diagnostic] Successfully loaded and parsed extracted_data.json");
    } catch (err) {
        console.error("[v4.28_admin_diagnostic] Fatal Error: Could not read or parse extracted_data.json. Cannot load initial data.", err);
        throw new Error("Failed to load initial data from JSON file.");
    }

    if (!initialData || !initialData.ports || !initialData.container_types || !initialData.indices) {
        console.error("[v4.28_admin_diagnostic] Fatal Error: extracted_data.json is missing required keys (ports, container_types, indices).");
        throw new Error("Invalid initial data structure in JSON file.");
    }

    try {
        client = await pool.connect();
        console.log("[v4.28_admin_diagnostic] Connected to DB for initial data load.");

        console.log("[v4.28_admin_diagnostic] Loading ports from JSON...");
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
                console.warn(`[v4.28_admin_diagnostic] Error inserting port row: ${JSON.stringify(port)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.28_admin_diagnostic] Finished loading ports. ${portCount} rows processed.`);

        console.log("[v4.28_admin_diagnostic] Loading container types from JSON...");
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
                console.warn(`[v4.28_admin_diagnostic] Error inserting container type row: ${JSON.stringify(ct)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.28_admin_diagnostic] Finished loading container types. ${ctCount} rows processed.`);

        console.log("[v4.28_admin_diagnostic] Loading index config from JSON...");
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
                     console.warn(`[v4.28_admin_diagnostic] Skipping invalid index config row: ${JSON.stringify(index)}`);
                }
            } catch (err) {
                console.warn(`[v4.28_admin_diagnostic] Error inserting index config row: ${JSON.stringify(index)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.28_admin_diagnostic] Finished loading index config. ${icCount} rows processed.`);
        
        console.log("[v4.28_admin_diagnostic] Skipping initial base rate loading. Base rates should be managed via admin panel.");

        console.log("[v4.28_admin_diagnostic] Initial data loading process completed.");

    } catch (error) {
        console.error("[v4.28_admin_diagnostic] Error loading initial data into database:", error);
    } finally {
        if (client) { client.release(); console.log("[v4.28_admin_diagnostic] Database client released after initial data load."); }
    }
}

async function initializeDatabaseTables() {
  console.log("[v4.28_admin_diagnostic] Initializing database tables...");
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    console.log("[v4.28_admin_diagnostic] Dropping and recreating 'ports' table...");
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
    console.log("[v4.28_admin_diagnostic] 'ports' table recreated successfully.");

    console.log("[v4.28_admin_diagnostic] Dropping and recreating 'container_types' table...");
    await client.query(`DROP TABLE IF EXISTS container_types CASCADE;`);
    await client.query(`
      CREATE TABLE container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, 
        description TEXT
      );
    `);
    console.log("[v4.28_admin_diagnostic] 'container_types' table recreated successfully.");

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
    console.log("[v4.28_admin_diagnostic] 'base_rates' table ensured.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS index_config (
        index_name VARCHAR(50) PRIMARY KEY,
        baseline_value NUMERIC NOT NULL,
        weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        current_value NUMERIC,
        last_updated TIMESTAMP
      );
    `);
    console.log("[v4.28_admin_diagnostic] 'index_config' table ensured.");

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
    console.log("[v4.28_admin_diagnostic] 'model_settings' table ensured.");

    console.log("[v4.28_admin_diagnostic] Dropping and recreating 'calculation_history' table...");
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
    console.log("[v4.28_admin_diagnostic] 'calculation_history' table recreated successfully.");
    await client.query(`ALTER TABLE calculation_history DROP COLUMN IF EXISTS origin_port;`);
    await client.query(`ALTER TABLE calculation_history DROP COLUMN IF EXISTS destination_port;`);
    await client.query(`ALTER TABLE calculation_history ALTER COLUMN container_type TYPE VARCHAR(50);`);

    await initializeSeasonalityTables(client); 
    console.log("[v4.28_admin_diagnostic] Seasonality tables initialized via external module.");

    await client.query("COMMIT");
    console.log("[v4.28_admin_diagnostic] Database tables initialized/verified successfully.");

  } catch (error) {
    console.error("[v4.28_admin_diagnostic] Error during database transaction, attempting rollback...");
    if (client) { 
      try { await client.query("ROLLBACK"); console.log("[v4.28_admin_diagnostic] Transaction rolled back."); } catch (rollbackError) { console.error("[v4.28_admin_diagnostic] Rollback failed:", rollbackError); }
    }
    console.error("[v4.28_admin_diagnostic] Error initializing database tables:", error);
    throw error;
  } finally {
    if (client) { client.release(); console.log("[v4.28_admin_diagnostic] Database client released after table initialization."); }
  }
}

function validateEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

async function loadCalculationConfigFromDB() {
    console.log("[v4.28_admin_diagnostic loadCalculationConfigFromDB] Attempting to load calculation config from DB.");
    let client;
    try {
        client = await pool.connect();
        console.log("[v4.28_admin_diagnostic loadCalculationConfigFromDB] DB connected.");

        const baseRatesResult = await client.query('SELECT origin_region, destination_region, container_type, rate FROM base_rates');
        console.log(`[v4.28_admin_diagnostic loadCalculationConfigFromDB] Fetched ${baseRatesResult.rowCount} base rates rows.`);
        const baseRatesConfig = {};
        baseRatesResult.rows.forEach(row => {
            if (!baseRatesConfig[row.origin_region]) baseRatesConfig[row.origin_region] = {};
            if (!baseRatesConfig[row.origin_region][row.destination_region]) baseRatesConfig[row.origin_region][row.destination_region] = {};
            baseRatesConfig[row.origin_region][row.destination_region][row.container_type] = parseFloat(row.rate);
        });
        console.log("[v4.28_admin_diagnostic loadCalculationConfigFromDB] Processed baseRatesConfig: " + (JSON.stringify(baseRatesConfig).substring(0, 200) + (JSON.stringify(baseRatesConfig).length > 200 ? "..." : "")));

        const indexConfigResult = await client.query('SELECT index_name, baseline_value, weight_percentage, current_value FROM index_config');
        console.log(`[v4.28_admin_diagnostic loadCalculationConfigFromDB] Fetched ${indexConfigResult.rowCount} index config rows.`);
        const indicesConfig = {};
        indexConfigResult.rows.forEach(row => {
            indicesConfig[row.index_name] = {
                baseline: parseFloat(row.baseline_value),
                weight: parseFloat(row.weight_percentage) / 100, 
                currentValue: parseFloat(row.current_value)
            };
        });
        console.log("[v4.28_admin_diagnostic loadCalculationConfigFromDB] Processed indicesConfig: " + (JSON.stringify(indicesConfig).substring(0, 200) + (JSON.stringify(indicesConfig).length > 200 ? "..." : "")));

        const settingsResult = await client.query('SELECT setting_key, setting_value FROM model_settings');
        console.log(`[v4.28_admin_diagnostic loadCalculationConfigFromDB] Fetched ${settingsResult.rowCount} model settings rows.`);
        const modelSettings = {};
        settingsResult.rows.forEach(row => {
            modelSettings[row.setting_key] = parseFloat(row.setting_value);
        });
        console.log("[v4.28_admin_diagnostic loadCalculationConfigFromDB] Processed modelSettings:", modelSettings);

        const containerTypesResult = await client.query('SELECT name, description FROM container_types');
        const containerTypes = containerTypesResult.rows;
        console.log(`[v4.28_admin_diagnostic loadCalculationConfigFromDB] Fetched ${containerTypes.length} container types.`);

        client.release();
        console.log("[v4.28_admin_diagnostic loadCalculationConfigFromDB] DB client released. Config loaded.");
        return { baseRatesConfig, indicesConfig, modelSettings, containerTypes };

    } catch (error) {
        if (client) client.release();
        console.error('[v4.28_admin_diagnostic loadCalculationConfigFromDB] Error loading calculation config from DB:', error);
        throw error;
    }
}

app.post("/api/calculate", asyncHandler(async (req, res, next) => {
    console.log("[v4.28_admin_diagnostic /api/calculate POST] Received request. Body:", JSON.stringify(req.body));
    const { originPort, destinationPort, containerType, weight, userEmail } = req.body;

    if (!originPort || !destinationPort || !containerType) {
        console.error("[v4.28_admin_diagnostic /api/calculate POST] Validation Error: Missing required fields.");
        return res.status(400).json({ error: 'Missing required fields: originPort, destinationPort, containerType' });
    }
    if (userEmail && !validateEmail(userEmail)) {
        console.error("[v4.28_admin_diagnostic /api/calculate POST] Validation Error: Invalid email format.");
        return res.status(400).json({ error: 'Invalid email format' });
    }
    console.log("[v4.28_admin_diagnostic /api/calculate POST] Inputs validated successfully.");

    let client;
    try {
        client = await pool.connect();
        console.log("[v4.28_admin_diagnostic /api/calculate POST] Connected to DB for calculation.");

        console.log(`[v4.28_admin_diagnostic /api/calculate POST] Fetching origin port data for: ${originPort}`);
        const originPortData = await client.query('SELECT * FROM ports WHERE COALESCE(code, name) = $1 LIMIT 1', [originPort]);
        console.log("[v4.28_admin_diagnostic /api/calculate POST] Origin port data from DB:", originPortData.rows);

        console.log(`[v4.28_admin_diagnostic /api/calculate POST] Fetching destination port data for: ${destinationPort}`);
        const destinationPortData = await client.query('SELECT * FROM ports WHERE COALESCE(code, name) = $1 LIMIT 1', [destinationPort]);
        console.log("[v4.28_admin_diagnostic /api/calculate POST] Destination port data from DB:", destinationPortData.rows);

        if (originPortData.rows.length === 0 || destinationPortData.rows.length === 0) {
            console.error("[v4.28_admin_diagnostic /api/calculate POST] Error: Origin or destination port not found in DB.");
            if (client) client.release();
            return res.status(404).json({ error: 'Origin or destination port not found' });
        }
        console.log("[v4.28_admin_diagnostic /api/calculate POST] Ports found successfully.");

        const originPortDb = originPortData.rows[0];
        const destinationPortDb = destinationPortData.rows[0];

        console.log("[v4.28_admin_diagnostic /api/calculate POST] Loading calculation config...");
        const config = await loadCalculationConfigFromDB(); 
        console.log("[v4.28_admin_diagnostic /api/calculate POST] Calculation config loaded.");

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
        console.log("[v4.28_admin_diagnostic /api/calculate POST] Calling calculateFreightRate with params: " + (JSON.stringify(calculationParams).substring(0,500) + "..."));

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
        console.log("[v4.28_admin_diagnostic /api/calculate POST] Result from calculateFreightRate: " + (JSON.stringify(rateDetails).substring(0,500) + "..."));

        if (userEmail && rateDetails.finalRate !== -1) {
            console.log("[v4.28_admin_diagnostic /api/calculate POST] Saving request to history for user:", userEmail);
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
                console.log("[v4.28_admin_diagnostic /api/calculate POST] Request saved to history successfully.");
            } catch (historyError) {
                console.error("[v4.28_admin_diagnostic /api/calculate POST] Error saving to history:", historyError);
            }
        }

        const responsePayload = {
            rate: rateDetails.finalRate,
            details: rateDetails.calculationDetails,
            currency: 'USD', 
            debugLog: rateDetails.debugLog 
        };
        console.log("[v4.28_admin_diagnostic /api/calculate POST] Sending response: " + (JSON.stringify(responsePayload).substring(0,200) + "..."));
        res.json(responsePayload);

    } catch (error) {
        console.error('[v4.28_admin_diagnostic /api/calculate POST] Critical error in /api/calculate handler:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error during calculation', details: error.message });
        }
    } finally {
        if (client) {
            client.release();
            console.log("[v4.28_admin_diagnostic /api/calculate POST] DB client released.");
        }
    }
}));

// --- Admin API Эндпоинты --- 

// Получить все порты
app.get('/api/admin/ports', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/ports GET] Received request.");
    const result = await pool.query('SELECT id, name, code, region, country, latitude, longitude FROM ports ORDER BY name');
    console.log(`[v4.28_admin_diagnostic /api/admin/ports GET] Fetched ${result.rowCount} ports.`);
    res.json(result.rows);
}));

// Добавить порт
app.post('/api/admin/ports', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/ports POST] Received request. Body:", req.body);
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) {
        console.error("[v4.28_admin_diagnostic /api/admin/ports POST] Validation Error: Port name is required.");
        return res.status(400).json({ error: 'Port name is required' });
    }
    const result = await pool.query(
        'INSERT INTO ports (name, code, region, country, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [name, code || null, region || null, country || null, latitude || null, longitude || null]
    );
    console.log("[v4.28_admin_diagnostic /api/admin/ports POST] Port added:", result.rows[0]);
    res.status(201).json(result.rows[0]);
}));

// Обновить порт
app.put('/api/admin/ports/:id', asyncHandler(async (req, res) => {
    console.log(`[v4.28_admin_diagnostic /api/admin/ports PUT] Received request for ID: ${req.params.id}. Body:`, req.body);
    const { id } = req.params;
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) {
        console.error("[v4.28_admin_diagnostic /api/admin/ports PUT] Validation Error: Port name is required.");
        return res.status(400).json({ error: 'Port name is required' });
    }
    const result = await pool.query(
        'UPDATE ports SET name = $1, code = $2, region = $3, country = $4, latitude = $5, longitude = $6 WHERE id = $7 RETURNING *',
        [name, code || null, region || null, country || null, latitude || null, longitude || null, id]
    );
    if (result.rows.length === 0) {
        console.warn(`[v4.28_admin_diagnostic /api/admin/ports PUT] Port with ID ${id} not found for update.`);
        return res.status(404).json({ error: 'Port not found' });
    }
    console.log("[v4.28_admin_diagnostic /api/admin/ports PUT] Port updated:", result.rows[0]);
    res.json(result.rows[0]);
}));

// Удалить порт
app.delete('/api/admin/ports/:id', asyncHandler(async (req, res) => {
    console.log(`[v4.28_admin_diagnostic /api/admin/ports DELETE] Received request for ID: ${req.params.id}.`);
    const { id } = req.params;
    const result = await pool.query('DELETE FROM ports WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
        console.warn(`[v4.28_admin_diagnostic /api/admin/ports DELETE] Port with ID ${id} not found for deletion.`);
        return res.status(404).json({ error: 'Port not found' });
    }
    console.log("[v4.28_admin_diagnostic /api/admin/ports DELETE] Port deleted, ID:", id);
    res.status(200).json({ message: 'Port deleted successfully' });
}));


// Получить все типы контейнеров
app.get('/api/admin/container-types', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/container-types GET] Received request.");
    const result = await pool.query('SELECT id, name, description FROM container_types ORDER BY name');
    console.log(`[v4.28_admin_diagnostic /api/admin/container-types GET] Fetched ${result.rowCount} container types.`);
    res.json(result.rows);
}));

// Добавить тип контейнера
app.post('/api/admin/container-types', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/container-types POST] Received request. Body:", req.body);
    const { name, description } = req.body;
    if (!name) {
        console.error("[v4.28_admin_diagnostic /api/admin/container-types POST] Validation Error: Container type name is required.");
        return res.status(400).json({ error: 'Container type name is required' });
    }
    const result = await pool.query(
        'INSERT INTO container_types (name, description) VALUES ($1, $2) RETURNING *',
        [name, description || null]
    );
    console.log("[v4.28_admin_diagnostic /api/admin/container-types POST] Container type added:", result.rows[0]);
    res.status(201).json(result.rows[0]);
}));

// Обновить тип контейнера
app.put('/api/admin/container-types/:id', asyncHandler(async (req, res) => {
    console.log(`[v4.28_admin_diagnostic /api/admin/container-types PUT] Received request for ID: ${req.params.id}. Body:`, req.body);
    const { id } = req.params;
    const { name, description } = req.body;
     if (!name) {
        console.error("[v4.28_admin_diagnostic /api/admin/container-types PUT] Validation Error: Container type name is required.");
        return res.status(400).json({ error: 'Container type name is required' });
    }
    const result = await pool.query(
        'UPDATE container_types SET name = $1, description = $2 WHERE id = $3 RETURNING *',
        [name, description || null, id]
    );
    if (result.rows.length === 0) {
        console.warn(`[v4.28_admin_diagnostic /api/admin/container-types PUT] Container type with ID ${id} not found for update.`);
        return res.status(404).json({ error: 'Container type not found' });
    }
    console.log("[v4.28_admin_diagnostic /api/admin/container-types PUT] Container type updated:", result.rows[0]);
    res.json(result.rows[0]);
}));

// Удалить тип контейнера
app.delete('/api/admin/container-types/:id', asyncHandler(async (req, res) => {
    console.log(`[v4.28_admin_diagnostic /api/admin/container-types DELETE] Received request for ID: ${req.params.id}.`);
    const { id } = req.params;
    const result = await pool.query('DELETE FROM container_types WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
        console.warn(`[v4.28_admin_diagnostic /api/admin/container-types DELETE] Container type with ID ${id} not found for deletion.`);
        return res.status(404).json({ error: 'Container type not found' });
    }
    console.log("[v4.28_admin_diagnostic /api/admin/container-types DELETE] Container type deleted, ID:", id);
    res.status(200).json({ message: 'Container type deleted successfully' });
}));

// Получить все базовые ставки
app.get('/api/admin/base-rates', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/base-rates GET] Received request.");
    const result = await pool.query('SELECT id, origin_region, destination_region, container_type, rate FROM base_rates ORDER BY origin_region, destination_region, container_type');
    console.log(`[v4.28_admin_diagnostic /api/admin/base-rates GET] Fetched ${result.rowCount} base rates.`);
    res.json(result.rows);
}));

// Добавить/Обновить базовую ставку (UPSERT)
app.post('/api/admin/base-rates', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/base-rates POST] Received request. Body:", req.body);
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate === undefined) {
        console.error("[v4.28_admin_diagnostic /api/admin/base-rates POST] Validation Error: All fields are required.");
        return res.status(400).json({ error: 'All fields (origin_region, destination_region, container_type, rate) are required' });
    }
    if (isNaN(parseFloat(rate)) || parseFloat(rate) < 0) {
        console.error("[v4.28_admin_diagnostic /api/admin/base-rates POST] Validation Error: Rate must be a non-negative number.");
        return res.status(400).json({ error: 'Rate must be a non-negative number.' });
    }

    const ctExists = await pool.query('SELECT 1 FROM container_types WHERE name = $1', [container_type]);
    if (ctExists.rows.length === 0) {
        console.error(`[v4.28_admin_diagnostic /api/admin/base-rates POST] Validation Error: Container type '${container_type}' does not exist.`);
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
    console.log("[v4.28_admin_diagnostic /api/admin/base-rates POST] Base rate upserted:", result.rows[0]);
    res.status(201).json(result.rows[0]);
}));

// Удалить базовую ставку
app.delete('/api/admin/base-rates', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/base-rates DELETE] Received request. Body:", req.body);
    const { origin_region, destination_region, container_type } = req.body;
     if (!origin_region || !destination_region || !container_type) {
        console.error("[v4.28_admin_diagnostic /api/admin/base-rates DELETE] Validation Error: All fields are required.");
        return res.status(400).json({ error: 'All fields (origin_region, destination_region, container_type) are required for deletion' });
    }
    const result = await pool.query(
        'DELETE FROM base_rates WHERE origin_region = $1 AND destination_region = $2 AND container_type = $3 RETURNING *',
        [origin_region, destination_region, container_type]
    );
    if (result.rows.length === 0) {
        console.warn(`[v4.28_admin_diagnostic /api/admin/base-rates DELETE] Base rate not found for deletion criteria:`, req.body);
        return res.status(404).json({ error: 'Base rate not found for the given criteria' });
    }
    console.log("[v4.28_admin_diagnostic /api/admin/base-rates DELETE] Base rate deleted.");
    res.status(200).json({ message: 'Base rate deleted successfully' });
}));

// Получить конфигурацию индексов
app.get('/api/admin/index-config', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/index-config GET] Received request.");
    const result = await pool.query('SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name');
    console.log(`[v4.28_admin_diagnostic /api/admin/index-config GET] Fetched ${result.rowCount} index configs.`);
    res.json(result.rows);
}));

// Обновить/Добавить конфигурацию индекса (UPSERT)
app.post('/api/admin/index-config', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/index-config POST] Received request. Body:", req.body);
    const { index_name, baseline_value, weight_percentage, current_value } = req.body;
    if (!index_name || baseline_value === undefined || weight_percentage === undefined) {
        console.error("[v4.28_admin_diagnostic /api/admin/index-config POST] Validation Error: Required fields missing.");
        return res.status(400).json({ error: 'Fields index_name, baseline_value, weight_percentage are required' });
    }
    const bl_val = parseFloat(baseline_value);
    const w_perc = parseFloat(weight_percentage);
    const cur_val = current_value !== undefined ? parseFloat(current_value) : null;

    if (isNaN(bl_val) || bl_val <= 0) {
        console.error("[v4.28_admin_diagnostic /api/admin/index-config POST] Validation Error: Baseline value invalid.");
        return res.status(400).json({ error: 'Baseline value must be a positive number.'});
    }
    if (isNaN(w_perc) || w_perc < 0 || w_perc > 100) {
        console.error("[v4.28_admin_diagnostic /api/admin/index-config POST] Validation Error: Weight percentage invalid.");
        return res.status(400).json({ error: 'Weight percentage must be between 0 and 100.'});
    }
    if (current_value !== undefined && (cur_val === null || isNaN(cur_val) || cur_val <=0)) {
        console.error("[v4.28_admin_diagnostic /api/admin/index-config POST] Validation Error: Current value invalid.");
         return res.status(400).json({ error: 'Current value, if provided, must be a positive number.'});
    }

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
    console.log("[v4.28_admin_diagnostic /api/admin/index-config POST] Index config upserted:", result.rows[0]);
    res.status(201).json(result.rows[0]);
}));

// Удалить конфигурацию индекса
app.delete('/api/admin/index-config/:index_name', asyncHandler(async (req, res) => {
    const { index_name } = req.params;
    console.log(`[v4.28_admin_diagnostic /api/admin/index-config DELETE] Received request for index_name: ${index_name}.`);
    const result = await pool.query('DELETE FROM index_config WHERE index_name = $1 RETURNING *', [index_name]);
    if (result.rows.length === 0) {
        console.warn(`[v4.28_admin_diagnostic /api/admin/index-config DELETE] Index config '${index_name}' not found for deletion.`);
        return res.status(404).json({ error: 'Index config not found' });
    }
    console.log(`[v4.28_admin_diagnostic /api/admin/index-config DELETE] Index config '${index_name}' deleted.`);
    res.status(200).json({ message: 'Index config deleted successfully' });
}));

// Получить настройки модели
app.get('/api/admin/model-settings', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/model-settings GET] Received request.");
    const result = await pool.query('SELECT setting_key, setting_value, description FROM model_settings');
    console.log(`[v4.28_admin_diagnostic /api/admin/model-settings GET] Fetched ${result.rowCount} model settings.`);
    res.json(result.rows);
}));

// Обновить/Добавить настройку модели (UPSERT)
app.post('/api/admin/model-settings', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/model-settings POST] Received request. Body:", req.body);
    const { setting_key, setting_value, description } = req.body;
    if (!setting_key || !setting_value) {
        console.error("[v4.28_admin_diagnostic /api/admin/model-settings POST] Validation Error: Required fields missing.");
        return res.status(400).json({ error: 'Fields setting_key and setting_value are required' });
    }
    if (setting_key === 'sensitivityCoeff') {
        const val = parseFloat(setting_value);
        if (isNaN(val) || val < 0 || val > 1) {
            console.error("[v4.28_admin_diagnostic /api/admin/model-settings POST] Validation Error: sensitivityCoeff invalid.");
            return res.status(400).json({ error: 'sensitivityCoeff must be a number between 0 and 1.' });
        }
    }
    const result = await pool.query(
        `INSERT INTO model_settings (setting_key, setting_value, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (setting_key) 
         DO UPDATE SET setting_value = EXCLUDED.setting_value, description = EXCLUDED.description
         RETURNING *`,
        [setting_key, setting_value, description || null]
    );
    console.log("[v4.28_admin_diagnostic /api/admin/model-settings POST] Model setting upserted:", result.rows[0]);
    res.status(201).json(result.rows[0]);
}));

// Загрузка данных из Excel (для базовых ставок)
app.post('/api/admin/upload-excel/base-rates', upload.single('excelFile'), asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/upload-excel/base-rates POST] Received file upload request.");
    if (!req.file) {
        console.error("[v4.28_admin_diagnostic /api/admin/upload-excel/base-rates POST] Error: No file uploaded.");
        return res.status(400).send('No file uploaded.');
    }

    let client;
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);
        console.log(`[v4.28_admin_diagnostic /api/admin/upload-excel/base-rates POST] Parsed ${data.length} rows from Excel.`);

        if (data.length === 0) {
            console.warn("[v4.28_admin_diagnostic /api/admin/upload-excel/base-rates POST] Excel file is empty or invalid format.");
            return res.status(400).send('Excel file is empty or has an invalid format.');
        }

        const expectedHeaders = ['origin_region', 'destination_region', 'container_type', 'rate'];
        const actualHeaders = Object.keys(data[0]);
        const missingHeaders = expectedHeaders.filter(h => !actualHeaders.includes(h));
        if (missingHeaders.length > 0) {
            console.error(`[v4.28_admin_diagnostic /api/admin/upload-excel/base-rates POST] Missing headers: ${missingHeaders.join(', ')}`);
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
        console.log(`[v4.28_admin_diagnostic /api/admin/upload-excel/base-rates POST] Excel import complete. Success: ${successCount}, Errors: ${errorCount}`);
        res.status(200).json({
            message: `Import completed. Successfully processed: ${successCount}. Failed: ${errorCount}.`,
            errors: errors
        });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('[v4.28_admin_diagnostic /api/admin/upload-excel/base-rates POST] Error processing Excel file:', err);
        res.status(500).send('Error processing Excel file: ' + err.message);
    } finally {
        if (client) client.release();
    }
}));

// Эндпоинт для инициализации и обновления данных сезонности
app.post('/api/admin/update-seasonality', asyncHandler(async (req, res) => {
    console.log("[v4.28_admin_diagnostic /api/admin/update-seasonality POST] Request to update seasonality data.");
    await initializeAndUpdateSeasonalityData(pool); 
    console.log("[v4.28_admin_diagnostic /api/admin/update-seasonality POST] Seasonality data update process initiated successfully.");
    res.status(200).json({ message: 'Seasonality data update process initiated successfully.' });
}));

// --- Глобальный обработчик ошибок Express ---
app.use((err, req, res, next) => {
  console.error('[v4.28_admin_diagnostic Global Error Handler] An error occurred:', err);
  if (res.headersSent) {
    return next(err); // Если заголовки уже отправлены, передаем ошибку стандартному обработчику Express
  }
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: err.message,
    // stack: process.env.NODE_ENV === 'development' ? err.stack : undefined // Опционально: стек только в разработке
  });
});


// --- Запуск сервера --- 
async function startServer() {
  try {
    await initializeSystem();
    app.listen(PORT, () => {
      console.log(`Server v4.28 (Admin Panel Diagnostic) is running on port ${PORT}`);
      console.log(`Admin panel should be accessible at /admin.html (if deployed)`);
    });
  } catch (error) {
    console.error("Failed to start server (v4.28_admin_diagnostic):", error);
    process.exit(1); 
  }
}

startServer();

