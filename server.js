// Интеграционный модуль v4.32: Исправлена логика Admin API для индексов и базовых ставок, добавлены недостающие маршруты.

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
     console.log("Initializing freight calculator system v4.32 (Admin API Fix).");
    await initializeDatabaseTables();
    // Используем обновленный JSON с кодами портов
    await loadInitialDataFromJson('/home/ubuntu/extracted_data_with_codes.json'); 
    console.log('System initialization completed for v4.32_admin_fix');
  } catch (error) {
    console.error('Error initializing system (v4.32_admin_fix):', error);
    throw error; // Rethrow to prevent server from starting in a bad state
  }
}

// --- Загрузка начальных данных из JSON ---
async function loadInitialDataFromJson(jsonFilePathParam) {
    console.log(`[v4.32_admin_fix] Attempting to load initial data from ${jsonFilePathParam}...`);
    let client;
    let initialData;

    try {
        // Используем переданный путь к файлу, а не жестко закодированный
        const jsonFilePath = path.isAbsolute(jsonFilePathParam) ? jsonFilePathParam : path.join(__dirname, jsonFilePathParam);
        const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
        initialData = JSON.parse(jsonData);
        console.log(`[v4.32_admin_fix] Successfully loaded and parsed ${jsonFilePath}`);
    } catch (err) {
        console.error(`[v4.32_admin_fix] Fatal Error: Could not read or parse ${jsonFilePathParam}. Cannot load initial data.`, err);
        throw new Error("Failed to load initial data from JSON file.");
    }

    if (!initialData || !initialData.ports || !initialData.container_types || !initialData.indices) {
        console.error("[v4.32_admin_fix] Fatal Error: JSON data is missing required keys (ports, container_types, indices).");
        throw new Error("Invalid initial data structure in JSON file.");
    }

    try {
        client = await pool.connect();
        console.log("[v4.32_admin_fix] Connected to DB for initial data load.");

        console.log("[v4.32_admin_fix] Loading ports from JSON...");
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
                console.warn(`[v4.32_admin_fix] Error inserting/updating port row: ${JSON.stringify(port)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.32_admin_fix] Finished loading/updating ports. ${portCount} rows processed.`);

        console.log("[v4.32_admin_fix] Loading container types from JSON...");
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
                console.warn(`[v4.32_admin_fix] Error inserting/updating container type row: ${JSON.stringify(ct)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.32_admin_fix] Finished loading/updating container types. ${ctCount} rows processed.`);

        console.log("[v4.32_admin_fix] Loading index config from JSON...");
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
                     console.warn(`[v4.32_admin_fix] Skipping invalid index config row: ${JSON.stringify(index)}`);
                }
            } catch (err) {
                console.warn(`[v4.32_admin_fix] Error inserting/updating index config row: ${JSON.stringify(index)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.32_admin_fix] Finished loading/updating index config. ${icCount} rows processed.`);
        
        console.log("[v4.32_admin_fix] Initial base rates are managed via admin panel. Skipping loading from JSON.");
        // If initialData.base_rates exists and you want to load them, uncomment and adapt:
        /*
        if (initialData.base_rates && Array.isArray(initialData.base_rates)) {
            console.log("[v4.32_admin_fix] Loading base rates from JSON...");
            let brCount = 0;
            for (const br of initialData.base_rates) {
                try {
                    const rate = parseFloat(br.rate);
                    if (br.origin_region && br.destination_region && br.container_type && !isNaN(rate)) {
                        await client.query(
                            `INSERT INTO base_rates (origin_region, destination_region, container_type, rate)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT (origin_region, destination_region, container_type) DO UPDATE SET
                               rate = EXCLUDED.rate;`,
                            [br.origin_region, br.destination_region, br.container_type, rate]
                        );
                        brCount++;
                    } else {
                        console.warn(`[v4.32_admin_fix] Skipping invalid base rate row: ${JSON.stringify(br)}`);
                    }
                } catch (err) {
                    console.warn(`[v4.32_admin_fix] Error inserting/updating base rate row: ${JSON.stringify(br)}, Error: ${err.message}`);
                }
            }
            console.log(`[v4.32_admin_fix] Finished loading/updating base rates. ${brCount} rows processed.`);
        }
        */

        console.log("[v4.32_admin_fix] Initial data loading process completed.");

    } catch (error) {
        console.error("[v4.32_admin_fix] Error loading initial data into database:", error);
    } finally {
        if (client) { client.release(); console.log("[v4.32_admin_fix] Database client released after initial data load."); }
    }
}

async function initializeDatabaseTables() {
  console.log("[v4.32_admin_fix] Initializing database tables...");
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Ports Table
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
    console.log("[v4.32_admin_fix] 'ports' table ensured.");

    // Container Types Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, 
        description TEXT
      );
    `);
    console.log("[v4.32_admin_fix] 'container_types' table ensured.");

    // Base Rates Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS base_rates (
        id SERIAL PRIMARY KEY, 
        origin_region VARCHAR(100) NOT NULL,
        destination_region VARCHAR(100) NOT NULL,
        container_type VARCHAR(50) NOT NULL, 
        rate NUMERIC NOT NULL,
        UNIQUE(origin_region, destination_region, container_type)
        // FOREIGN KEY (container_type) REFERENCES container_types(name) ON DELETE RESTRICT ON UPDATE CASCADE // Consider re-adding if strict FK is needed and names are stable
      );
    `);
    console.log("[v4.32_admin_fix] 'base_rates' table ensured.");

    // Index Config Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS index_config (
        index_name VARCHAR(50) PRIMARY KEY,
        baseline_value NUMERIC NOT NULL,
        weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        current_value NUMERIC,
        last_updated TIMESTAMP
      );
    `);
    console.log("[v4.32_admin_fix] 'index_config' table ensured.");

    // Model Settings Table
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
    console.log("[v4.32_admin_fix] 'model_settings' table ensured.");

    // Calculation History Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS calculation_history (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        origin_port_id INT, 
        destination_port_id INT, 
        container_type VARCHAR(50) NOT NULL, 
        weight NUMERIC,
        calculated_rate NUMERIC, 
        user_email VARCHAR(255),
        index_values_used JSONB, 
        FOREIGN KEY (origin_port_id) REFERENCES ports(id) ON DELETE SET NULL, 
        FOREIGN KEY (destination_port_id) REFERENCES ports(id) ON DELETE SET NULL
      );
    `);
    console.log("[v4.32_admin_fix] 'calculation_history' table ensured.");

    await initializeSeasonalityTables(client); 
    console.log("[v4.32_admin_fix] Seasonality tables initialized via external module.");

    await client.query("COMMIT");
    console.log("[v4.32_admin_fix] Database tables initialized/verified successfully.");

  } catch (error) {
    console.error("[v4.32_admin_fix] Error during database transaction, attempting rollback...");
    if (client) { 
      try { await client.query("ROLLBACK"); console.log("[v4.32_admin_fix] Transaction rolled back."); } catch (rollbackError) { console.error("[v4.32_admin_fix] Rollback failed:", rollbackError); }
    }
    console.error("[v4.32_admin_fix] Error initializing database tables:", error);
    throw error;
  } finally {
    if (client) { client.release(); console.log("[v4.32_admin_fix] Database client released after table initialization."); }
  }
}

function validateEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

async function loadCalculationConfigFromDB() {
    console.log("[v4.32_admin_fix loadCalculationConfigFromDB] Attempting to load calculation config from DB.");
    let client;
    try {
        client = await pool.connect();
        const baseRatesResult = await client.query('SELECT id, origin_region, destination_region, container_type, rate FROM base_rates');
        const baseRatesConfig = {};
        baseRatesResult.rows.forEach(row => {
            if (!baseRatesConfig[row.origin_region]) baseRatesConfig[row.origin_region] = {};
            if (!baseRatesConfig[row.origin_region][row.destination_region]) baseRatesConfig[row.origin_region][row.destination_region] = {};
            baseRatesConfig[row.origin_region][row.destination_region][row.container_type] = parseFloat(row.rate);
        });

        const indexConfigResult = await client.query('SELECT index_name, baseline_value, weight_percentage, current_value FROM index_config');
        const indicesConfig = {};
        indexConfigResult.rows.forEach(row => {
            indicesConfig[row.index_name] = {
                baseline: parseFloat(row.baseline_value),
                weight: parseFloat(row.weight_percentage) / 100, 
                currentValue: parseFloat(row.current_value)
            };
        });

        const settingsResult = await client.query('SELECT setting_key, setting_value FROM model_settings');
        const modelSettings = {};
        settingsResult.rows.forEach(row => {
            modelSettings[row.setting_key] = parseFloat(row.setting_value);
        });

        const containerTypesResult = await client.query('SELECT id, name, description FROM container_types');
        const containerTypes = containerTypesResult.rows;
        
        return { baseRatesConfig, indicesConfig, modelSettings, containerTypes };

    } catch (error) {
        console.error('[v4.32_admin_fix loadCalculationConfigFromDB] Error loading calculation config from DB:', error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

// --- API Маршруты для Публичного Калькулятора ---
app.get("/api/public/ports", asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/public/ports GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, code, region, country FROM ports ORDER BY name ASC");
        console.log(`[v4.32_admin_fix /api/public/ports GET] Found ${result.rows.length} ports.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.32_admin_fix /api/public/ports GET] DB client released.");
    }
}));

app.get("/api/public/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/public/container-types GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, description FROM container_types ORDER BY name ASC");
        console.log(`[v4.32_admin_fix /api/public/container-types GET] Found ${result.rows.length} container types.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.32_admin_fix /api/public/container-types GET] DB client released.");
    }
}));

app.post("/api/calculate", asyncHandler(async (req, res, next) => {
    console.log("[v4.32_admin_fix /api/calculate POST] Received request. Body:", JSON.stringify(req.body));
    const { originPort, destinationPort, containerType, weight, userEmail } = req.body; 

    if (!originPort || !destinationPort || !containerType) {
        console.error("[v4.32_admin_fix /api/calculate POST] Validation Error: Missing required fields.");
        return res.status(400).json({ error: 'Missing required fields: originPort (ID), destinationPort (ID), containerType' });
    }
    if (userEmail && !validateEmail(userEmail)) {
        console.error("[v4.32_admin_fix /api/calculate POST] Validation Error: Invalid email format.");
        return res.status(400).json({ error: 'Invalid email format' });
    }
    console.log("[v4.32_admin_fix /api/calculate POST] Inputs validated successfully.");

    let client;
    try {
        client = await pool.connect();
        console.log("[v4.32_admin_fix /api/calculate POST] DB connected.");

        const originPortData = await client.query('SELECT id, name, region, code FROM ports WHERE id = $1', [originPort]);
        const destinationPortData = await client.query('SELECT id, name, region, code FROM ports WHERE id = $1', [destinationPort]);

        if (originPortData.rows.length === 0 || destinationPortData.rows.length === 0) {
            console.error("[v4.32_admin_fix /api/calculate POST] Error: Origin or destination port not found by ID.");
            return res.status(404).json({ error: 'Origin or destination port not found' });
        }
        const origin = originPortData.rows[0];
        const destination = destinationPortData.rows[0];
        console.log(`[v4.32_admin_fix /api/calculate POST] Origin: ${origin.name}, Dest: ${destination.name}`);

        const { baseRatesConfig, indicesConfig, modelSettings } = await loadCalculationConfigFromDB();
        console.log("[v4.32_admin_fix /api/calculate POST] Calculation config loaded.");
        
        const seasonalityFactor = await fetchSeasonalityFactor(pool, origin.region, destination.region, new Date());
        console.log(`[v4.32_admin_fix /api/calculate POST] Seasonality factor: ${seasonalityFactor}`);

        const calculatedRate = calculateFreightRate(
            origin.region, 
            destination.region, 
            containerType, 
            parseFloat(weight) || 0, 
            baseRatesConfig, 
            indicesConfig, 
            modelSettings,
            seasonalityFactor
        );
        console.log(`[v4.32_admin_fix /api/calculate POST] Calculated rate: ${calculatedRate}`);

        if (typeof calculatedRate !== 'number' || isNaN(calculatedRate)) {
             console.error("[v4.32_admin_fix /api/calculate POST] Error: Rate calculation failed or returned non-numeric value.", calculatedRate);
            return res.status(500).json({ error: 'Rate calculation failed. Base rate for the route and container type might be missing.' });
        }

        await saveRequestToHistory(pool, origin.id, destination.id, containerType, parseFloat(weight) || 0, calculatedRate, userEmail, indicesConfig);
        console.log("[v4.32_admin_fix /api/calculate POST] Request saved to history.");

        res.json({ rate: calculatedRate.toFixed(2) });
        console.log("[v4.32_admin_fix /api/calculate POST] Response sent.");

    } catch (error) {
        console.error("[v4.32_admin_fix /api/calculate POST] Overall calculation error:", error);
        next(error); 
    } finally {
        if (client) { client.release(); console.log("[v4.32_admin_fix /api/calculate POST] DB client released."); }
    }
}));

// --- API Маршруты для Админ-панели ---

// --- Ports (from admin panel, if needed, though public one exists) ---
app.get("/api/admin/ports", asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/admin/ports GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, code, region, country, latitude, longitude FROM ports ORDER BY name ASC");
        res.json(result.rows);
    } finally {
        client.release();
    }
}));

// --- Container Types (from admin panel, if needed, though public one exists) ---
app.get("/api/admin/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/admin/container-types GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, description FROM container_types ORDER BY name ASC");
        res.json(result.rows);
    } finally {
        client.release();
    }
}));

// --- Index Config --- 
app.get("/api/admin/indices", asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/admin/indices GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name ASC");
        res.json(result.rows);
    } finally {
        client.release();
    }
}));

app.post("/api/admin/indices", asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/admin/indices POST] Request received. Body:", req.body);
    const { index_name, baseline_value, weight_percentage, current_value } = req.body;
    if (!index_name || baseline_value == null || weight_percentage == null || current_value == null) {
        return res.status(400).json({ error: "Missing required fields for index config." });
    }
    const baseline = parseFloat(baseline_value);
    const weight = parseFloat(weight_percentage);
    const current = parseFloat(current_value);
    if (isNaN(baseline) || isNaN(weight) || isNaN(current) || weight < 0 || weight > 100) {
        return res.status(400).json({ error: "Invalid numeric values or weight_percentage out of range (0-100)." });
    }

    const client = await pool.connect();
    try {
        // UPSERT logic: Insert or Update on conflict
        const result = await client.query(
            `INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (index_name) DO UPDATE SET
               baseline_value = EXCLUDED.baseline_value,
               weight_percentage = EXCLUDED.weight_percentage,
               current_value = EXCLUDED.current_value,
               last_updated = NOW()
             RETURNING *;`,
            [index_name, baseline, weight, current]
        );
        res.status(201).json(result.rows[0]);
    } finally {
        client.release();
    }
}));

app.delete("/api/admin/indices/:index_name", asyncHandler(async (req, res) => {
    const { index_name } = req.params;
    console.log(`[v4.32_admin_fix /api/admin/indices DELETE] Request to delete index: ${index_name}`);
    if (!index_name) {
        return res.status(400).json({ error: "Index name is required for deletion." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM index_config WHERE index_name = $1 RETURNING *;", [index_name]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Index not found." });
        }
        res.status(200).json({ message: "Index deleted successfully.", deletedIndex: result.rows[0] });
    } finally {
        client.release();
    }
}));

// --- Base Rates --- 
app.get("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/admin/base-rates GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, origin_region, destination_region, container_type, rate FROM base_rates ORDER BY id ASC");
        res.json(result.rows);
    } finally {
        client.release();
    }
}));

app.post("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/admin/base-rates POST] Request received. Body:", req.body);
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate == null) {
        return res.status(400).json({ error: "Missing required fields for base rate." });
    }
    const numericRate = parseFloat(rate);
    if (isNaN(numericRate) || numericRate < 0) {
        return res.status(400).json({ error: "Invalid rate value. Must be a non-negative number." });
    }

    const client = await pool.connect();
    try {
        // UPSERT logic for base rates
        const result = await client.query(
            `INSERT INTO base_rates (origin_region, destination_region, container_type, rate)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (origin_region, destination_region, container_type) DO UPDATE SET
               rate = EXCLUDED.rate
             RETURNING *;`,
            [origin_region, destination_region, container_type, numericRate]
        );
        res.status(201).json(result.rows[0]);
    } finally {
        client.release();
    }
}));

app.delete("/api/admin/base-rates/:id", asyncHandler(async (req, res) => {
    const { id } = req.params;
    const baseRateId = parseInt(id, 10);
    console.log(`[v4.32_admin_fix /api/admin/base-rates DELETE] Request to delete base rate with ID: ${baseRateId}`);

    if (isNaN(baseRateId)) {
        return res.status(400).json({ error: "Invalid ID format for base rate deletion." });
    }

    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM base_rates WHERE id = $1 RETURNING *;", [baseRateId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Base rate not found." });
        }
        res.status(200).json({ message: "Base rate deleted successfully.", deletedRate: result.rows[0] });
    } finally {
        client.release();
    }
}));

// --- Upload Routes for Admin Panel (Excel) ---
// Placeholder for /api/upload/ports - if needed, though JSON load is primary
app.post("/api/upload/ports", upload.single('file'), asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/upload/ports POST] Received file upload for ports.");
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    // Logic to process Excel file for ports - similar to indices/base_rates if implemented
    res.status(501).json({ message: "Port upload from Excel not yet fully implemented. Use JSON load on startup." });
}));

app.post("/api/upload/indices", upload.single('file'), asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/upload/indices POST] Received file upload for indices.");
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const row of data) {
            const index_name = row['Index Name'] || row['index_name'];
            const baseline_value = parseFloat(row['Baseline Value'] || row['baseline_value']);
            const weight_percentage = parseFloat(row['Weight Percentage'] || row['weight_percentage']);
            const current_value = parseFloat(row['Current Value'] || row['current_value']);

            if (index_name && !isNaN(baseline_value) && !isNaN(weight_percentage) && weight_percentage >= 0 && weight_percentage <= 100 && !isNaN(current_value)) {
                try {
                    await client.query(
                        `INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
                         VALUES ($1, $2, $3, $4, NOW())
                         ON CONFLICT (index_name) DO UPDATE SET
                           baseline_value = EXCLUDED.baseline_value,
                           weight_percentage = EXCLUDED.weight_percentage,
                           current_value = EXCLUDED.current_value,
                           last_updated = NOW();`,
                        [index_name, baseline_value, weight_percentage, current_value]
                    );
                    successCount++;
                } catch (dbError) {
                    errorCount++;
                    errors.push(`Error for index ${index_name}: ${dbError.message}`);
                }
            } else {
                errorCount++;
                errors.push(`Skipping invalid row for index: ${JSON.stringify(row)}`);
            }
        }
        await client.query('COMMIT');
        res.status(200).json({ 
            message: `Indices upload processed. Success: ${successCount}, Errors: ${errorCount}`,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("[v4.32_admin_fix /api/upload/indices POST] Error processing Excel:", error);
        res.status(500).json({ error: 'Failed to process Excel file for indices.', details: error.message });
    } finally {
        client.release();
    }
}));

app.post("/api/upload/base-rates", upload.single('file'), asyncHandler(async (req, res) => {
    console.log("[v4.32_admin_fix /api/upload/base-rates POST] Received file upload for base rates.");
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const row of data) {
            const origin_region = row['Origin Region'] || row['origin_region'];
            const destination_region = row['Destination Region'] || row['destination_region'];
            const container_type = row['Container Type'] || row['container_type'];
            const rate = parseFloat(row['Rate'] || row['rate']);

            if (origin_region && destination_region && container_type && !isNaN(rate) && rate >=0) {
                try {
                    await client.query(
                        `INSERT INTO base_rates (origin_region, destination_region, container_type, rate)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (origin_region, destination_region, container_type) DO UPDATE SET
                           rate = EXCLUDED.rate;`,
                        [origin_region, destination_region, container_type, rate]
                    );
                    successCount++;
                } catch (dbError) {
                    errorCount++;
                    errors.push(`Error for base rate ${origin_region}-${destination_region}-${container_type}: ${dbError.message}`);
                }
            } else {
                errorCount++;
                errors.push(`Skipping invalid row for base rate: ${JSON.stringify(row)}`);
            }
        }
        await client.query('COMMIT');
        res.status(200).json({ 
            message: `Base rates upload processed. Success: ${successCount}, Errors: ${errorCount}`,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("[v4.32_admin_fix /api/upload/base-rates POST] Error processing Excel:", error);
        res.status(500).json({ error: 'Failed to process Excel file for base rates.', details: error.message });
    } finally {
        client.release();
    }
}));

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error("[v4.32_admin_fix Global Error Handler] An error occurred:", err);
  res.status(err.status || 500).json({
    error: err.message || 'An unexpected error occurred.',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// --- Start Server and Initialize ---
(async () => {
  try {
    await initializeSystem();
    // Initialize seasonality data after system init
    console.log("[v4.32_admin_fix] Initializing and updating seasonality data...");
    await initializeAndUpdateSeasonalityData(pool);
    console.log("[v4.32_admin_fix] Seasonality data initialization/update complete.");

    app.listen(PORT, () => {
      console.log(`[v4.32_admin_fix] Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("[v4.32_admin_fix] Failed to initialize system or start server:", error);
    process.exit(1); // Exit if system can't initialize
  }
})();

