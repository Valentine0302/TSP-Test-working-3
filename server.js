// Интеграционный модуль v4.33: Исправлена синтаксическая ошибка SQL (удален JS-комментарий из CREATE TABLE).

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
     console.log("Initializing freight calculator system v4.33 (SQL Syntax Fix).");
    await initializeDatabaseTables();
    // Используем обновленный JSON с кодами портов
    await loadInitialDataFromJson('/home/ubuntu/extracted_data_with_codes.json'); 
    console.log('System initialization completed for v4.33_sql_syntax_fix');
  } catch (error) {
    console.error('Error initializing system (v4.33_sql_syntax_fix):', error);
    throw error; // Rethrow to prevent server from starting in a bad state
  }
}

// --- Загрузка начальных данных из JSON ---
async function loadInitialDataFromJson(jsonFilePathParam) {
    console.log(`[v4.33_sql_syntax_fix] Attempting to load initial data from ${jsonFilePathParam}...`);
    let client;
    let initialData;

    try {
        // Используем переданный путь к файлу, а не жестко закодированный
        const jsonFilePath = path.isAbsolute(jsonFilePathParam) ? jsonFilePathParam : path.join(__dirname, jsonFilePathParam);
        const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
        initialData = JSON.parse(jsonData);
        console.log(`[v4.33_sql_syntax_fix] Successfully loaded and parsed ${jsonFilePath}`);
    } catch (err) {
        console.error(`[v4.33_sql_syntax_fix] Fatal Error: Could not read or parse ${jsonFilePathParam}. Cannot load initial data.`, err);
        throw new Error("Failed to load initial data from JSON file.");
    }

    if (!initialData || !initialData.ports || !initialData.container_types || !initialData.indices) {
        console.error("[v4.33_sql_syntax_fix] Fatal Error: JSON data is missing required keys (ports, container_types, indices).");
        throw new Error("Invalid initial data structure in JSON file.");
    }

    try {
        client = await pool.connect();
        console.log("[v4.33_sql_syntax_fix] Connected to DB for initial data load.");

        console.log("[v4.33_sql_syntax_fix] Loading ports from JSON...");
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
                console.warn(`[v4.33_sql_syntax_fix] Error inserting/updating port row: ${JSON.stringify(port)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.33_sql_syntax_fix] Finished loading/updating ports. ${portCount} rows processed.`);

        console.log("[v4.33_sql_syntax_fix] Loading container types from JSON...");
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
                console.warn(`[v4.33_sql_syntax_fix] Error inserting/updating container type row: ${JSON.stringify(ct)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.33_sql_syntax_fix] Finished loading/updating container types. ${ctCount} rows processed.`);

        console.log("[v4.33_sql_syntax_fix] Loading index config from JSON...");
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
                     console.warn(`[v4.33_sql_syntax_fix] Skipping invalid index config row: ${JSON.stringify(index)}`);
                }
            } catch (err) {
                console.warn(`[v4.33_sql_syntax_fix] Error inserting/updating index config row: ${JSON.stringify(index)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.33_sql_syntax_fix] Finished loading/updating index config. ${icCount} rows processed.`);
        
        console.log("[v4.33_sql_syntax_fix] Initial base rates are managed via admin panel. Skipping loading from JSON.");

        console.log("[v4.33_sql_syntax_fix] Initial data loading process completed.");

    } catch (error) {
        console.error("[v4.33_sql_syntax_fix] Error loading initial data into database:", error);
    } finally {
        if (client) { client.release(); console.log("[v4.33_sql_syntax_fix] Database client released after initial data load."); }
    }
}

async function initializeDatabaseTables() {
  console.log("[v4.33_sql_syntax_fix] Initializing database tables...");
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
    console.log("[v4.33_sql_syntax_fix] 'ports' table ensured.");

    // Container Types Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, 
        description TEXT
      );
    `);
    console.log("[v4.33_sql_syntax_fix] 'container_types' table ensured.");

    // Base Rates Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS base_rates (
        id SERIAL PRIMARY KEY, 
        origin_region VARCHAR(100) NOT NULL,
        destination_region VARCHAR(100) NOT NULL,
        container_type VARCHAR(50) NOT NULL, 
        rate NUMERIC NOT NULL,
        UNIQUE(origin_region, destination_region, container_type)
      );
    `);
    console.log("[v4.33_sql_syntax_fix] 'base_rates' table ensured.");

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
    console.log("[v4.33_sql_syntax_fix] 'index_config' table ensured.");

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
    console.log("[v4.33_sql_syntax_fix] 'model_settings' table ensured.");

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
    console.log("[v4.33_sql_syntax_fix] 'calculation_history' table ensured.");

    await initializeSeasonalityTables(client); 
    console.log("[v4.33_sql_syntax_fix] Seasonality tables initialized via external module.");

    await client.query("COMMIT");
    console.log("[v4.33_sql_syntax_fix] Database tables initialized/verified successfully.");

  } catch (error) {
    console.error("[v4.33_sql_syntax_fix] Error during database transaction, attempting rollback...");
    if (client) { 
      try { await client.query("ROLLBACK"); console.log("[v4.33_sql_syntax_fix] Transaction rolled back."); } catch (rollbackError) { console.error("[v4.33_sql_syntax_fix] Rollback failed:", rollbackError); }
    }
    console.error("[v4.33_sql_syntax_fix] Error initializing database tables:", error);
    throw error;
  } finally {
    if (client) { client.release(); console.log("[v4.33_sql_syntax_fix] Database client released after table initialization."); }
  }
}

function validateEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

async function loadCalculationConfigFromDB() {
    console.log("[v4.33_sql_syntax_fix loadCalculationConfigFromDB] Attempting to load calculation config from DB.");
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
        console.error('[v4.33_sql_syntax_fix loadCalculationConfigFromDB] Error loading calculation config from DB:', error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

// --- API Маршруты для Публичного Калькулятора ---
app.get("/api/public/ports", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/public/ports GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, code, region, country FROM ports ORDER BY name ASC");
        console.log(`[v4.33_sql_syntax_fix /api/public/ports GET] Found ${result.rows.length} ports.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.33_sql_syntax_fix /api/public/ports GET] Client released.");
    }
}));

app.get("/api/public/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/public/container-types GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, description FROM container_types ORDER BY name ASC");
        console.log(`[v4.33_sql_syntax_fix /api/public/container-types GET] Found ${result.rows.length} container types.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.33_sql_syntax_fix /api/public/container-types GET] Client released.");
    }
}));

app.post("/api/calculate", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/calculate POST] Request received with body:", req.body);
    const { originPort, destinationPort, containerType, weight, email } = req.body;

    if (!originPort || !destinationPort || !containerType) {
        console.log("[v4.33_sql_syntax_fix /api/calculate POST] Missing required fields.");
        return res.status(400).json({ error: "Origin port, destination port, and container type are required." });
    }
    if (email && !validateEmail(email)) {
        console.log("[v4.33_sql_syntax_fix /api/calculate POST] Invalid email format.");
        return res.status(400).json({ error: "Invalid email format." });
    }

    let client;
    try {
        client = await pool.connect();
        const originPortData = await client.query("SELECT id, name, region FROM ports WHERE id = $1", [originPort]);
        const destinationPortData = await client.query("SELECT id, name, region FROM ports WHERE id = $1", [destinationPort]);

        if (originPortData.rows.length === 0 || destinationPortData.rows.length === 0) {
            console.log("[v4.33_sql_syntax_fix /api/calculate POST] Origin or destination port not found by ID.");
            return res.status(404).json({ error: "Origin or destination port not found" });
        }

        const calculationConfig = await loadCalculationConfigFromDB();
        const seasonalityFactor = await fetchSeasonalityFactor(pool, originPortData.rows[0].region, destinationPortData.rows[0].region, new Date());

        const rateDetails = calculateFreightRate(
            originPortData.rows[0].region,
            destinationPortData.rows[0].region,
            containerType,
            parseFloat(weight) || 0,
            calculationConfig.baseRatesConfig,
            calculationConfig.indicesConfig,
            calculationConfig.modelSettings,
            seasonalityFactor
        );

        if (typeof rateDetails.finalRate === 'undefined') {
            console.log("[v4.33_sql_syntax_fix /api/calculate POST] Rate could not be determined.", rateDetails.calculationTrace);
            return res.status(404).json({ error: "Rate could not be determined for the selected route and container type.", details: rateDetails.calculationTrace });
        }
        
        console.log("[v4.33_sql_syntax_fix /api/calculate POST] Rate calculated:", rateDetails.finalRate);
        await saveRequestToHistory(pool, originPortData.rows[0].id, destinationPortData.rows[0].id, containerType, parseFloat(weight) || 0, rateDetails.finalRate, email, rateDetails.indicesUsed);
        res.json({ finalRate: rateDetails.finalRate, calculationTrace: rateDetails.calculationTrace });

    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/calculate POST] Error during calculation:", error);
        res.status(500).json({ error: "Internal server error during calculation." });
    } finally {
        if (client) client.release();
        console.log("[v4.33_sql_syntax_fix /api/calculate POST] Client released.");
    }
}));

// --- API Маршруты для Админ-панели ---

// --- Порты (Admin) ---
app.get("/api/admin/ports", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/ports GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, code, region, country, latitude, longitude FROM ports ORDER BY name ASC");
        res.json(result.rows);
    } finally {
        client.release();
    }
}));

app.post("/api/admin/ports", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/ports POST] Request received with body:", req.body);
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) return res.status(400).json({ error: "Port name is required" });
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO ports (name, code, region, country, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [name, code || null, region || null, country || null, latitude || null, longitude || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/ports POST] Error:", error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: "Port with this name already exists." });
        }
        res.status(500).json({ error: "Failed to add port." });
    } finally {
        client.release();
    }
}));

app.put("/api/admin/ports/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.33_sql_syntax_fix /api/admin/ports PUT] ID: ${req.params.id}, Body:`, req.body);
    const { id } = req.params;
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) return res.status(400).json({ error: "Port name is required" });
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE ports SET name = $1, code = $2, region = $3, country = $4, latitude = $5, longitude = $6 WHERE id = $7 RETURNING *",
            [name, code || null, region || null, country || null, latitude || null, longitude || null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Port not found" });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/ports PUT] Error:", error);
         if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: "Another port with this name already exists." });
        }
        res.status(500).json({ error: "Failed to update port." });
    } finally {
        client.release();
    }
}));

app.delete("/api/admin/ports/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.33_sql_syntax_fix /api/admin/ports DELETE] ID: ${req.params.id}`);
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM ports WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Port not found" });
        res.status(200).json({ message: "Port deleted successfully" }); // Or res.sendStatus(204)
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/ports DELETE] Error:", error);
        // Check for foreign key constraint violation if ports are referenced elsewhere
        if (error.code === '23503') { // foreign_key_violation
             return res.status(409).json({ error: "Cannot delete port. It is referenced in calculation history. Consider archiving or deactivating instead." });
        }
        res.status(500).json({ error: "Failed to delete port." });
    } finally {
        client.release();
    }
}));

// --- Типы контейнеров (Admin) ---
app.get("/api/admin/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/container-types GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, description FROM container_types ORDER BY name ASC");
        res.json(result.rows);
    } finally {
        client.release();
    }
}));

app.post("/api/admin/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/container-types POST] Request received with body:", req.body);
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Container type name is required" });
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO container_types (name, description) VALUES ($1, $2) RETURNING *",
            [name, description || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/container-types POST] Error:", error);
        if (error.code === '23505') { 
            return res.status(409).json({ error: "Container type with this name already exists." });
        }
        res.status(500).json({ error: "Failed to add container type." });
    } finally {
        client.release();
    }
}));

app.put("/api/admin/container-types/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.33_sql_syntax_fix /api/admin/container-types PUT] ID: ${req.params.id}, Body:`, req.body);
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Container type name is required" });
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE container_types SET name = $1, description = $2 WHERE id = $3 RETURNING *",
            [name, description || null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Container type not found" });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/container-types PUT] Error:", error);
        if (error.code === '23505') { 
            return res.status(409).json({ error: "Another container type with this name already exists." });
        }
        res.status(500).json({ error: "Failed to update container type." });
    } finally {
        client.release();
    }
}));

app.delete("/api/admin/container-types/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.33_sql_syntax_fix /api/admin/container-types DELETE] ID: ${req.params.id}`);
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM container_types WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Container type not found" });
        res.status(200).json({ message: "Container type deleted successfully" });
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/container-types DELETE] Error:", error);
         if (error.code === '23503') { 
             return res.status(409).json({ error: "Cannot delete container type. It is referenced in base rates or calculation history." });
        }
        res.status(500).json({ error: "Failed to delete container type." });
    } finally {
        client.release();
    }
}));

// --- Базовые ставки (Admin) ---
app.get("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/base-rates GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, origin_region, destination_region, container_type, rate FROM base_rates ORDER BY origin_region, destination_region, container_type");
        res.json(result.rows);
    } finally {
        client.release();
    }
}));

app.post("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/base-rates POST] Request received with body:", req.body);
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate === undefined) {
        return res.status(400).json({ error: "Origin region, destination region, container type, and rate are required" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO base_rates (origin_region, destination_region, container_type, rate) VALUES ($1, $2, $3, $4) RETURNING *",
            [origin_region, destination_region, container_type, parseFloat(rate)]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/base-rates POST] Error:", error);
        if (error.code === '23505') { 
            return res.status(409).json({ error: "Base rate for this combination already exists." });
        }
        res.status(500).json({ error: "Failed to add base rate." });
    } finally {
        client.release();
    }
}));

app.put("/api/admin/base-rates/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.33_sql_syntax_fix /api/admin/base-rates PUT] ID: ${req.params.id}, Body:`, req.body);
    const { id } = req.params;
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate === undefined) {
        return res.status(400).json({ error: "Origin region, destination region, container type, and rate are required" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE base_rates SET origin_region = $1, destination_region = $2, container_type = $3, rate = $4 WHERE id = $5 RETURNING *",
            [origin_region, destination_region, container_type, parseFloat(rate), id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Base rate not found" });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/base-rates PUT] Error:", error);
         if (error.code === '23505') { 
            return res.status(409).json({ error: "Another base rate for this combination already exists." });
        }
        res.status(500).json({ error: "Failed to update base rate." });
    } finally {
        client.release();
    }
}));

app.delete("/api/admin/base-rates/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.33_sql_syntax_fix /api/admin/base-rates DELETE] ID: ${req.params.id}`);
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM base_rates WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Base rate not found" });
        res.status(200).json({ message: "Base rate deleted successfully" });
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/base-rates DELETE] Error:", error);
        res.status(500).json({ error: "Failed to delete base rate." });
    } finally {
        client.release();
    }
}));

// --- Индексы (Admin) ---
app.get("/api/admin/index-config", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/index-config GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name");
        res.json(result.rows);
    } finally {
        client.release();
    }
}));

app.post("/api/admin/index-config", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/index-config POST] Request received with body:", req.body);
    const { index_name, baseline_value, weight_percentage, current_value } = req.body;
    if (!index_name || baseline_value === undefined || weight_percentage === undefined) {
        return res.status(400).json({ error: "Index name, baseline value, and weight percentage are required" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated) VALUES ($1, $2, $3, $4, NOW()) RETURNING *",
            [index_name, parseFloat(baseline_value), parseFloat(weight_percentage), parseFloat(current_value) || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/index-config POST] Error:", error);
        if (error.code === '23505') { 
            return res.status(409).json({ error: "Index with this name already exists." });
        }
        if (error.code === '23514') { // check_violation (for weight_percentage)
            return res.status(400).json({ error: "Weight percentage must be between 0 and 100." });
        }
        res.status(500).json({ error: "Failed to add index config." });
    } finally {
        client.release();
    }
}));

app.put("/api/admin/index-config/:index_name", asyncHandler(async (req, res) => {
    console.log(`[v4.33_sql_syntax_fix /api/admin/index-config PUT] Index Name: ${req.params.index_name}, Body:`, req.body);
    const { index_name } = req.params;
    const { baseline_value, weight_percentage, current_value } = req.body;
    // index_name cannot be updated as it's PK. baseline_value and weight_percentage are required.
    if (baseline_value === undefined || weight_percentage === undefined) {
        return res.status(400).json({ error: "Baseline value and weight percentage are required for update" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE index_config SET baseline_value = $1, weight_percentage = $2, current_value = $3, last_updated = NOW() WHERE index_name = $4 RETURNING *",
            [parseFloat(baseline_value), parseFloat(weight_percentage), parseFloat(current_value) || null, index_name]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Index config not found" });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/index-config PUT] Error:", error);
        if (error.code === '23514') { // check_violation (for weight_percentage)
            return res.status(400).json({ error: "Weight percentage must be between 0 and 100." });
        }
        res.status(500).json({ error: "Failed to update index config." });
    } finally {
        client.release();
    }
}));

app.delete("/api/admin/index-config/:index_name", asyncHandler(async (req, res) => {
    console.log(`[v4.33_sql_syntax_fix /api/admin/index-config DELETE] Index Name: ${req.params.index_name}`);
    const { index_name } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM index_config WHERE index_name = $1 RETURNING *", [index_name]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Index config not found" });
        res.status(200).json({ message: "Index config deleted successfully" });
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/index-config DELETE] Error:", error);
        res.status(500).json({ error: "Failed to delete index config." });
    } finally {
        client.release();
    }
}));

// --- Настройки модели (Admin) ---
app.get("/api/admin/model-settings", asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/model-settings GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT setting_key, setting_value, description FROM model_settings");
        res.json(result.rows);
    } finally {
        client.release();
    }
}));

app.put("/api/admin/model-settings/:setting_key", asyncHandler(async (req, res) => {
    console.log(`[v4.33_sql_syntax_fix /api/admin/model-settings PUT] Key: ${req.params.setting_key}, Body:`, req.body);
    const { setting_key } = req.params;
    const { setting_value } = req.body;
    if (setting_value === undefined) {
        return res.status(400).json({ error: "Setting value is required" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE model_settings SET setting_value = $1 WHERE setting_key = $2 RETURNING *",
            [String(setting_value), setting_key]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Model setting not found" });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/model-settings PUT] Error:", error);
        res.status(500).json({ error: "Failed to update model setting." });
    } finally {
        client.release();
    }
}));

// --- Загрузка данных Excel для сезонности (Admin) ---
app.post("/api/admin/upload-seasonality", upload.single('seasonalityFile'), asyncHandler(async (req, res) => {
    console.log("[v4.33_sql_syntax_fix /api/admin/upload-seasonality POST] File upload request received.");
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded." });
    }
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);
        
        console.log(`[v4.33_sql_syntax_fix /api/admin/upload-seasonality POST] Parsed ${data.length} rows from Excel.`);
        await initializeAndUpdateSeasonalityData(pool, data);
        res.status(200).json({ message: "Seasonality data uploaded and processed successfully." });
    } catch (error) {
        console.error("[v4.33_sql_syntax_fix /api/admin/upload-seasonality POST] Error processing seasonality file:", error);
        res.status(500).json({ error: "Error processing seasonality file.", details: error.message });
    }
}));

// --- Общий обработчик ошибок ---
app.use((err, req, res, next) => {
  console.error("[v4.33_sql_syntax_fix Global Error Handler] An error occurred:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    details: err.stack // Consider removing stack in production
  });
});

// --- Запуск сервера ---
(async () => {
  try {
    await initializeSystem();
    app.listen(PORT, () => {
      console.log(`[v4.33_sql_syntax_fix] Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("[v4.33_sql_syntax_fix] Failed to initialize system or start server:", error);
    process.exit(1); // Exit if system can't initialize
  }
})();

