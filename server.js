// Интеграционный модуль v4.34: Исправлен путь к файлу данных на относительный.

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
     console.log("Initializing freight calculator system v4.34 (Filepath Fix).");
    await initializeDatabaseTables();
    await loadInitialDataFromJson('./extracted_data.json'); 
    console.log('System initialization completed for v4.34_filepath_fix');
  } catch (error) {
    console.error('Error initializing system (v4.34_filepath_fix):', error);
    throw error; 
  }
}

// --- Загрузка начальных данных из JSON ---
async function loadInitialDataFromJson(jsonFilePathParam) {
    console.log(`[v4.34_filepath_fix] Attempting to load initial data from ${jsonFilePathParam}...`);
    let client;
    let initialData;
    try {
        const jsonFilePath = path.isAbsolute(jsonFilePathParam) ? jsonFilePathParam : path.join(__dirname, jsonFilePathParam);
        const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
        initialData = JSON.parse(jsonData);
        console.log(`[v4.34_filepath_fix] Successfully loaded and parsed ${jsonFilePath}`);
    } catch (err) {
        console.error(`[v4.34_filepath_fix] Fatal Error: Could not read or parse ${jsonFilePathParam}. Ensure '${path.basename(jsonFilePathParam)}' is in the root directory. Error:`, err);
        throw new Error("Failed to load initial data from JSON file.");
    }
    if (!initialData || !initialData.ports || !initialData.container_types || !initialData.indices) {
        console.error("[v4.34_filepath_fix] Fatal Error: JSON data is missing required keys (ports, container_types, indices).");
        throw new Error("Invalid initial data structure in JSON file.");
    }
    try {
        client = await pool.connect();
        console.log("[v4.34_filepath_fix] Connected to DB for initial data load.");
        console.log("[v4.34_filepath_fix] Loading ports from JSON...");
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
                console.warn(`[v4.34_filepath_fix] Error inserting/updating port row: ${JSON.stringify(port)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.34_filepath_fix] Finished loading/updating ports. ${portCount} rows processed.`);
        console.log("[v4.34_filepath_fix] Loading container types from JSON...");
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
                console.warn(`[v4.34_filepath_fix] Error inserting/updating container type row: ${JSON.stringify(ct)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.34_filepath_fix] Finished loading/updating container types. ${ctCount} rows processed.`);
        console.log("[v4.34_filepath_fix] Loading index config from JSON...");
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
                     console.warn(`[v4.34_filepath_fix] Skipping invalid index config row: ${JSON.stringify(index)}`);
                }
            } catch (err) {
                console.warn(`[v4.34_filepath_fix] Error inserting/updating index config row: ${JSON.stringify(index)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.34_filepath_fix] Finished loading/updating index config. ${icCount} rows processed.`);
        console.log("[v4.34_filepath_fix] Initial base rates are managed via admin panel. Skipping loading from JSON.");
        console.log("[v4.34_filepath_fix] Initial data loading process completed.");
    } catch (error) {
        console.error("[v4.34_filepath_fix] Error loading initial data into database:", error);
    } finally {
        if (client) { client.release(); console.log("[v4.34_filepath_fix] Database client released after initial data load."); }
    }
}

async function initializeDatabaseTables() {
  console.log("[v4.34_filepath_fix] Initializing database tables...");
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
    console.log("[v4.34_filepath_fix] 'ports' table ensured.");
    await client.query(`
      CREATE TABLE IF NOT EXISTS container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, 
        description TEXT
      );
    `);
    console.log("[v4.34_filepath_fix] 'container_types' table ensured.");
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
    console.log("[v4.34_filepath_fix] 'base_rates' table ensured.");
    await client.query(`
      CREATE TABLE IF NOT EXISTS index_config (
        index_name VARCHAR(50) PRIMARY KEY,
        baseline_value NUMERIC NOT NULL,
        weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        current_value NUMERIC,
        last_updated TIMESTAMP
      );
    `);
    console.log("[v4.34_filepath_fix] 'index_config' table ensured.");
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
    console.log("[v4.34_filepath_fix] 'model_settings' table ensured.");
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
    console.log("[v4.34_filepath_fix] 'calculation_history' table ensured.");
    await initializeSeasonalityTables(client); 
    console.log("[v4.34_filepath_fix] Seasonality tables initialized via external module.");
    await client.query("COMMIT");
    console.log("[v4.34_filepath_fix] Database tables initialized/verified successfully.");
  } catch (error) {
    console.error("[v4.34_filepath_fix] Error during database transaction, attempting rollback...");
    if (client) { 
      try { await client.query("ROLLBACK"); console.log("[v4.34_filepath_fix] Transaction rolled back."); } catch (rollbackError) { console.error("[v4.34_filepath_fix] Rollback failed:", rollbackError); }
    }
    console.error("[v4.34_filepath_fix] Error initializing database tables:", error);
    throw error;
  } finally {
    if (client) { client.release(); console.log("[v4.34_filepath_fix] Database client released after table initialization."); }
  }
}

function validateEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

async function loadCalculationConfigFromDB() {
    console.log("[v4.34_filepath_fix loadCalculationConfigFromDB] Attempting to load calculation config from DB.");
    let client;
    try {
        client = await pool.connect();
        const baseRatesResult = await client.query('SELECT br.id, br.origin_region, br.destination_region, ct.name as container_type_name, br.rate FROM base_rates br JOIN container_types ct ON br.container_type_id = ct.id');
        const baseRatesConfig = {};
        baseRatesResult.rows.forEach(row => {
            if (!baseRatesConfig[row.origin_region]) baseRatesConfig[row.origin_region] = {};
            if (!baseRatesConfig[row.origin_region][row.destination_region]) baseRatesConfig[row.origin_region][row.destination_region] = {};
            baseRatesConfig[row.origin_region][row.destination_region][row.container_type_name] = parseFloat(row.rate);
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
        const containerTypes = containerTypesResult.rows.map(ct => ({ ...ct, id: parseInt(ct.id, 10) }));
        
        return { baseRatesConfig, indicesConfig, modelSettings, containerTypes };
    } catch (error) {
        console.error('[v4.34_filepath_fix loadCalculationConfigFromDB] Error loading calculation config from DB:', error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

// --- API Маршруты для Публичного Калькулятора ---
app.get("/api/ports", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/ports GET] Request received."); // Changed from /api/public/ports
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, code, region, country FROM ports ORDER BY name ASC");
        console.log(`[v4.34_filepath_fix /api/ports GET] Found ${result.rows.length} ports.`);
        res.json(result.rows.map(p => ({...p, id: parseInt(p.id, 10) }))); // Ensure ID is integer
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/ports GET] Client released.");
    }
}));

app.get("/api/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/container-types GET] Request received."); // Changed from /api/public/container-types
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, description FROM container_types ORDER BY name ASC");
        console.log(`[v4.34_filepath_fix /api/container-types GET] Found ${result.rows.length} container types.`);
        res.json(result.rows.map(ct => ({ ...ct, id: parseInt(ct.id, 10) }))); // Ensure ID is integer
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/container-types GET] Client released.");
    }
}));

app.post("/api/calculate", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/calculate POST] Request received with body:", req.body);
    const { originPort, destinationPort, containerType, weight, email } = req.body;

    // Enhanced logging for incoming port and containerType IDs
    console.log(`[v4.34_filepath_fix /api/calculate POST] Received originPort: ${originPort} (type: ${typeof originPort})`);
    console.log(`[v4.34_filepath_fix /api/calculate POST] Received destinationPort: ${destinationPort} (type: ${typeof destinationPort})`);
    console.log(`[v4.34_filepath_fix /api/calculate POST] Received containerType: ${containerType} (type: ${typeof containerType})`);

    if (!originPort || !destinationPort || !containerType) {
        console.log("[v4.34_filepath_fix /api/calculate POST] Missing required fields.");
        return res.status(400).json({ error: "Origin port, destination port, and container type are required." });
    }

    // Validate that IDs are numbers if they are not undefined or null
    const originPortId = parseInt(originPort, 10);
    const destinationPortId = parseInt(destinationPort, 10);
    const containerTypeId = parseInt(containerType, 10);

    if (isNaN(originPortId) || isNaN(destinationPortId) || isNaN(containerTypeId)) {
        console.error("[v4.34_filepath_fix /api/calculate POST] Invalid port or container type ID after parsing. Check client-side data.");
        console.error(`Parsed IDs - Origin: ${originPortId}, Destination: ${destinationPortId}, Container: ${containerTypeId}`);
        return res.status(400).json({ error: "Invalid port or container type ID. Ensure numeric IDs are sent." });
    }

    if (email && !validateEmail(email)) {
        console.log("[v4.34_filepath_fix /api/calculate POST] Invalid email format.");
        return res.status(400).json({ error: "Invalid email format." });
    }

    let client;
    try {
        client = await pool.connect();
        const calculationConfig = await loadCalculationConfigFromDB();
        
        const calculationData = {
            originPortId: originPortId,
            destinationPortId: destinationPortId,
            containerTypeId: containerTypeId,
            weight: weight || 20000, // Default weight if not provided
            baseRates: calculationConfig.baseRatesConfig,
            indices: calculationConfig.indicesConfig,
            modelSettings: calculationConfig.modelSettings,
            containerTypes: calculationConfig.containerTypes, // Pass all container types
            dbClient: client // Pass the client for direct DB operations if needed by calculator
        };

        console.log("[v4.34_filepath_fix /api/calculate POST] Data prepared for calculation:", JSON.stringify(calculationData, (key, value) => key === 'dbClient' ? undefined : value));

        const result = await calculateFreightRate(calculationData);
        console.log("[v4.34_filepath_fix /api/calculate POST] Calculated final rate details:", result);

        if (result && typeof result.finalRate !== 'undefined') {
            await saveRequestToHistory(client, originPortId, destinationPortId, containerTypeId, calculationData.weight, result.finalRate, email, result.indexValuesUsed || {});
            console.log("[v4.34_filepath_fix /api/calculate POST] Request saved to history.");
            res.json({
                rate: result.finalRate,
                minRate: result.minRate,
                maxRate: result.maxRate,
                avgRate: result.avgRate, // Ensure avgRate is part of the result from calculateFreightRate
                sourceCount: result.sourceCount,
                reliability: result.reliability,
                calculationDetails: result.calculationDetails // For more detailed breakdown if needed
            });
        } else {
            console.error("[v4.34_filepath_fix /api/calculate POST] Calculation did not return a final rate or was undefined.", result);
            res.status(500).json({ error: "An error occurred during freight calculation (undefined result)." });
        }
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/calculate POST] Error during calculation:", error.message, error.stack);
        res.status(500).json({ error: "An error occurred during freight calculation.", details: error.message });
    } finally {
        if (client) {
             client.release();
             console.log("[v4.34_filepath_fix /api/calculate POST] Client released after calculation.");
        }
    }
}));

// --- API Маршруты для Админ Панели ---
app.get("/api/admin/ports", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/ports GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, code, region, country, latitude, longitude FROM ports ORDER BY name ASC");
        console.log(`[v4.34_filepath_fix /api/admin/ports GET] Found ${result.rows.length} ports.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/ports GET] Client released.");
    }
}));

app.post("/api/admin/ports", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/ports POST] Request received with body:", req.body);
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Port name is required." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO ports (name, code, region, country, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [name, code, region, country, latitude, longitude]
        );
        console.log("[v4.34_filepath_fix /api/admin/ports POST] Port added:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/ports POST] Error adding port:", error);
        res.status(500).json({ error: "Failed to add port.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/ports POST] Client released.");
    }
}));

app.put("/api/admin/ports/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.34_filepath_fix /api/admin/ports PUT] ID: ${req.params.id}, Body:`, req.body);
    const { id } = req.params;
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Port name is required." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE ports SET name = $1, code = $2, region = $3, country = $4, latitude = $5, longitude = $6 WHERE id = $7 RETURNING *",
            [name, code, region, country, latitude, longitude, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Port not found." });
        }
        console.log("[v4.34_filepath_fix /api/admin/ports PUT] Port updated:", result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/ports PUT] Error updating port:", error);
        res.status(500).json({ error: "Failed to update port.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/ports PUT] Client released.");
    }
}));

app.delete("/api/admin/ports/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.34_filepath_fix /api/admin/ports DELETE] ID: ${req.params.id}`);
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM ports WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Port not found." });
        }
        console.log("[v4.34_filepath_fix /api/admin/ports DELETE] Port deleted:", result.rows[0]);
        res.status(204).send();
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/ports DELETE] Error deleting port:", error);
        res.status(500).json({ error: "Failed to delete port.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/ports DELETE] Client released.");
    }
}));


app.get("/api/admin/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/container-types GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, description FROM container_types ORDER BY name ASC");
        console.log(`[v4.34_filepath_fix /api/admin/container-types GET] Found ${result.rows.length} container types.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/container-types GET] Client released.");
    }
}));

app.post("/api/admin/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/container-types POST] Request received with body:", req.body);
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Container type name is required." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO container_types (name, description) VALUES ($1, $2) RETURNING *",
            [name, description]
        );
        console.log("[v4.34_filepath_fix /api/admin/container-types POST] Container type added:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/container-types POST] Error adding container type:", error);
        res.status(500).json({ error: "Failed to add container type.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/container-types POST] Client released.");
    }
}));

app.put("/api/admin/container-types/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.34_filepath_fix /api/admin/container-types PUT] ID: ${req.params.id}, Body:`, req.body);
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ error: "Container type name is required." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE container_types SET name = $1, description = $2 WHERE id = $3 RETURNING *",
            [name, description, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Container type not found." });
        }
        console.log("[v4.34_filepath_fix /api/admin/container-types PUT] Container type updated:", result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/container-types PUT] Error updating container type:", error);
        res.status(500).json({ error: "Failed to update container type.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/container-types PUT] Client released.");
    }
}));

app.delete("/api/admin/container-types/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.34_filepath_fix /api/admin/container-types DELETE] ID: ${req.params.id}`);
    const { id } = req.params;
    const client = await pool.connect();
    try {
        // Check if this container type is used in base_rates
        const checkResult = await client.query("SELECT 1 FROM base_rates WHERE container_type_id = $1 LIMIT 1", [id]);
        if (checkResult.rows.length > 0) {
            console.log("[v4.34_filepath_fix /api/admin/container-types DELETE] Attempt to delete container type used in base_rates.");
            return res.status(400).json({ error: "Cannot delete container type: it is currently used in base rates. Please update base rates first." });
        }
        const result = await client.query("DELETE FROM container_types WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Container type not found." });
        }
        console.log("[v4.34_filepath_fix /api/admin/container-types DELETE] Container type deleted:", result.rows[0]);
        res.status(204).send();
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/container-types DELETE] Error deleting container type:", error);
        res.status(500).json({ error: "Failed to delete container type.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/container-types DELETE] Client released.");
    }
}));

app.get("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/base-rates GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT br.id, br.origin_region, br.destination_region, br.container_type_id, ct.name as container_type_name, br.rate FROM base_rates br JOIN container_types ct ON br.container_type_id = ct.id ORDER BY br.origin_region, br.destination_region, ct.name ASC");
        console.log(`[v4.34_filepath_fix /api/admin/base-rates GET] Found ${result.rows.length} base rates.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/base-rates GET] Client released.");
    }
}));

app.post("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/base-rates POST] Request received with body:", req.body);
    const { origin_region, destination_region, container_type_id, rate } = req.body;
    if (!origin_region || !destination_region || !container_type_id || rate === undefined) {
        return res.status(400).json({ error: "Origin region, destination region, container type ID, and rate are required." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO base_rates (origin_region, destination_region, container_type_id, rate) VALUES ($1, $2, $3, $4) RETURNING *",
            [origin_region, destination_region, parseInt(container_type_id, 10), parseFloat(rate)]
        );
        // Fetch the newly created rate with container_type_name for response consistency
        const newRate = await client.query("SELECT br.id, br.origin_region, br.destination_region, br.container_type_id, ct.name as container_type_name, br.rate FROM base_rates br JOIN container_types ct ON br.container_type_id = ct.id WHERE br.id = $1", [result.rows[0].id]);
        console.log("[v4.34_filepath_fix /api/admin/base-rates POST] Base rate added:", newRate.rows[0]);
        res.status(201).json(newRate.rows[0]);
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/base-rates POST] Error adding base rate:", error);
        res.status(500).json({ error: "Failed to add base rate.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/base-rates POST] Client released.");
    }
}));

app.put("/api/admin/base-rates/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.34_filepath_fix /api/admin/base-rates PUT] ID: ${req.params.id}, Body:`, req.body);
    const { id } = req.params;
    const { origin_region, destination_region, container_type_id, rate } = req.body;
    if (!origin_region || !destination_region || !container_type_id || rate === undefined) {
        return res.status(400).json({ error: "Origin region, destination region, container type ID, and rate are required." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE base_rates SET origin_region = $1, destination_region = $2, container_type_id = $3, rate = $4 WHERE id = $5 RETURNING *",
            [origin_region, destination_region, parseInt(container_type_id, 10), parseFloat(rate), id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Base rate not found." });
        }
        const updatedRate = await client.query("SELECT br.id, br.origin_region, br.destination_region, br.container_type_id, ct.name as container_type_name, br.rate FROM base_rates br JOIN container_types ct ON br.container_type_id = ct.id WHERE br.id = $1", [id]);
        console.log("[v4.34_filepath_fix /api/admin/base-rates PUT] Base rate updated:", updatedRate.rows[0]);
        res.json(updatedRate.rows[0]);
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/base-rates PUT] Error updating base rate:", error);
        res.status(500).json({ error: "Failed to update base rate.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/base-rates PUT] Client released.");
    }
}));

app.delete("/api/admin/base-rates/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.34_filepath_fix /api/admin/base-rates DELETE] ID: ${req.params.id}`);
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM base_rates WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Base rate not found." });
        }
        console.log("[v4.34_filepath_fix /api/admin/base-rates DELETE] Base rate deleted:", result.rows[0]);
        res.status(204).send();
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/base-rates DELETE] Error deleting base rate:", error);
        res.status(500).json({ error: "Failed to delete base rate.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/base-rates DELETE] Client released.");
    }
}));

app.get("/api/admin/index-config", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/index-config GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name ASC");
        console.log(`[v4.34_filepath_fix /api/admin/index-config GET] Found ${result.rows.length} index configs.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/index-config GET] Client released.");
    }
}));

app.put("/api/admin/index-config/:index_name", asyncHandler(async (req, res) => {
    console.log(`[v4.34_filepath_fix /api/admin/index-config PUT] Index Name: ${req.params.index_name}, Body:`, req.body);
    const { index_name } = req.params;
    const { baseline_value, weight_percentage, current_value } = req.body;
    if (baseline_value === undefined || weight_percentage === undefined || current_value === undefined) {
        return res.status(400).json({ error: "Baseline value, weight percentage, and current value are required." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE index_config SET baseline_value = $1, weight_percentage = $2, current_value = $3, last_updated = NOW() WHERE index_name = $4 RETURNING *",
            [parseFloat(baseline_value), parseFloat(weight_percentage), parseFloat(current_value), index_name]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Index config not found." });
        }
        console.log("[v4.34_filepath_fix /api/admin/index-config PUT] Index config updated:", result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/index-config PUT] Error updating index config:", error);
        res.status(500).json({ error: "Failed to update index config.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/index-config PUT] Client released.");
    }
}));

app.get("/api/admin/model-settings", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/model-settings GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT setting_key, setting_value, description FROM model_settings ORDER BY setting_key ASC");
        console.log(`[v4.34_filepath_fix /api/admin/model-settings GET] Found ${result.rows.length} model settings.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/model-settings GET] Client released.");
    }
}));

app.put("/api/admin/model-settings/:setting_key", asyncHandler(async (req, res) => {
    console.log(`[v4.34_filepath_fix /api/admin/model-settings PUT] Key: ${req.params.setting_key}, Body:`, req.body);
    const { setting_key } = req.params;
    const { setting_value } = req.body;
    if (setting_value === undefined) {
        return res.status(400).json({ error: "Setting value is required." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE model_settings SET setting_value = $1 WHERE setting_key = $2 RETURNING *",
            [setting_value, setting_key]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Model setting not found." });
        }
        console.log("[v4.34_filepath_fix /api/admin/model-settings PUT] Model setting updated:", result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.34_filepath_fix /api/admin/model-settings PUT] Error updating model setting:", error);
        res.status(500).json({ error: "Failed to update model setting.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/model-settings PUT] Client released.");
    }
}));

app.get("/api/admin/calculation-history", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/calculation-history GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                ch.id, ch.timestamp, 
                op.name as origin_port_name, dp.name as destination_port_name, 
                ct.name as container_type_name, ch.weight, ch.calculated_rate, ch.user_email, ch.index_values_used
            FROM calculation_history ch
            LEFT JOIN ports op ON ch.origin_port_id = op.id
            LEFT JOIN ports dp ON ch.destination_port_id = dp.id
            LEFT JOIN container_types ct ON ch.container_type_id = ct.id
            ORDER BY ch.timestamp DESC
        `);
        console.log(`[v4.34_filepath_fix /api/admin/calculation-history GET] Found ${result.rows.length} history records.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/calculation-history GET] Client released.");
    }
}));

// --- NEW UPLOAD ROUTES ---
app.post("/api/admin/upload/indices", upload.single('indicesFile'), asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/upload/indices POST] Request received.");
    if (!req.file) {
        console.log("[v4.34_filepath_fix /api/admin/upload/indices POST] No file uploaded.");
        return res.status(400).json({ error: "No file uploaded." });
    }

    let client;
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        console.log(`[v4.34_filepath_fix /api/admin/upload/indices POST] Parsed ${data.length} rows from Excel.`);

        client = await pool.connect();
        await client.query('BEGIN');

        let updatedCount = 0;
        let insertedCount = 0;

        for (const row of data) {
            const index_name = row.index_name || row.Index_Name;
            const baseline_value = parseFloat(row.baseline_value || row.Baseline_Value);
            const weight_percentage = parseFloat(row.weight_percentage || row.Weight_Percentage);
            const current_value = parseFloat(row.current_value || row.Current_Value);

            if (!index_name || isNaN(baseline_value) || isNaN(weight_percentage) || isNaN(current_value) || weight_percentage < 0 || weight_percentage > 100) {
                console.warn(`[v4.34_filepath_fix /api/admin/upload/indices POST] Skipping invalid row: ${JSON.stringify(row)}`);
                continue;
            }

            const result = await client.query(
                `INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (index_name) DO UPDATE SET
                   baseline_value = EXCLUDED.baseline_value,
                   weight_percentage = EXCLUDED.weight_percentage,
                   current_value = EXCLUDED.current_value,
                   last_updated = NOW()
                 RETURNING index_name, (xmax::text::int > 0) AS updated;`,
                [index_name, baseline_value, weight_percentage, current_value]
            );
            if (result.rows.length > 0) {
                if (result.rows[0].updated) {
                    updatedCount++;
                } else {
                    insertedCount++;
                }
            }
        }

        await client.query('COMMIT');
        console.log(`[v4.34_filepath_fix /api/admin/upload/indices POST] Successfully processed file. Inserted: ${insertedCount}, Updated: ${updatedCount}`);
        res.json({ message: `Successfully uploaded and processed indices. Inserted: ${insertedCount}, Updated: ${updatedCount}` });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("[v4.34_filepath_fix /api/admin/upload/indices POST] Error processing file:", error);
        res.status(500).json({ error: "Failed to process uploaded indices file.", details: error.message });
    } finally {
        if (client) client.release();
        console.log("[v4.34_filepath_fix /api/admin/upload/indices POST] Client released.");
    }
}));

app.post("/api/admin/upload/base-rates", upload.single('baseRatesFile'), asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/upload/base-rates POST] Request received.");
    if (!req.file) {
        console.log("[v4.34_filepath_fix /api/admin/upload/base-rates POST] No file uploaded.");
        return res.status(400).json({ error: "No file uploaded." });
    }

    let client;
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        console.log(`[v4.34_filepath_fix /api/admin/upload/base-rates POST] Parsed ${data.length} rows from Excel.`);

        client = await pool.connect();
        await client.query('BEGIN');

        // Get container types for ID lookup
        const ctResult = await client.query("SELECT id, name FROM container_types");
        const containerTypesMap = new Map(ctResult.rows.map(ct => [ct.name.toLowerCase(), ct.id]));
        console.log("[v4.34_filepath_fix /api/admin/upload/base-rates POST] Container types map created:", containerTypesMap);

        let updatedCount = 0;
        let insertedCount = 0;
        let skippedCount = 0;

        for (const row of data) {
            const origin_region = row.origin_region || row.Origin_Region;
            const destination_region = row.destination_region || row.Destination_Region;
            const container_type_name = row.container_type || row.Container_Type; // Expecting name, e.g., "20ft Standard"
            const rate = parseFloat(row.rate || row.Rate);

            if (!origin_region || !destination_region || !container_type_name || isNaN(rate)) {
                console.warn(`[v4.34_filepath_fix /api/admin/upload/base-rates POST] Skipping invalid row (missing data or invalid rate): ${JSON.stringify(row)}`);
                skippedCount++;
                continue;
            }

            const container_type_id = containerTypesMap.get(container_type_name.toLowerCase());
            if (!container_type_id) {
                console.warn(`[v4.34_filepath_fix /api/admin/upload/base-rates POST] Skipping row due to unknown container type name: '${container_type_name}'. Row: ${JSON.stringify(row)}`);
                skippedCount++;
                continue;
            }
            console.log(`[v4.34_filepath_fix /api/admin/upload/base-rates POST] Matched container type '${container_type_name}' to ID: ${container_type_id}`);

            const result = await client.query(
                `INSERT INTO base_rates (origin_region, destination_region, container_type_id, rate)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (origin_region, destination_region, container_type_id) DO UPDATE SET
                   rate = EXCLUDED.rate
                 RETURNING id, (xmax::text::int > 0) AS updated;`,
                [origin_region, destination_region, container_type_id, rate]
            );

            if (result.rows.length > 0) {
                if (result.rows[0].updated) {
                    updatedCount++;
                } else {
                    insertedCount++;
                }
            }
        }

        await client.query('COMMIT');
        console.log(`[v4.34_filepath_fix /api/admin/upload/base-rates POST] Successfully processed file. Inserted: ${insertedCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}`);
        res.json({ message: `Successfully uploaded and processed base rates. Inserted: ${insertedCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}` });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("[v4.34_filepath_fix /api/admin/upload/base-rates POST] Error processing file:", error);
        res.status(500).json({ error: "Failed to process uploaded base rates file.", details: error.message });
    } finally {
        if (client) client.release();
        console.log("[v4.34_filepath_fix /api/admin/upload/base-rates POST] Client released.");
    }
}));

// --- Глобальный обработчик ошибок ---
app.use((err, req, res, next) => {
  console.error("[v4.34_filepath_fix Global Error Handler] An unexpected error occurred:", err.stack);
  res.status(500).json({ error: "An unexpected server error occurred.", details: err.message });
});

// --- Запуск сервера и инициализация --- 
async function startServer() {
  try {
    await initializeSystem();
    app.listen(PORT, () => {
      console.log(`[v4.34_filepath_fix] Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("[v4.34_filepath_fix] Failed to start server due to initialization error:", error);
    process.exit(1); // Exit if initialization fails
  }
}

startServer();

