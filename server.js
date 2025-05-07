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
    // ИСПРАВЛЕНО: Используем относительный путь к файлу данных, который должен быть в корне проекта
    await loadInitialDataFromJson('./extracted_data.json'); 
    console.log('System initialization completed for v4.34_filepath_fix');
  } catch (error) {
    console.error('Error initializing system (v4.34_filepath_fix):', error);
    throw error; // Rethrow to prevent server from starting in a bad state
  }
}

// --- Загрузка начальных данных из JSON ---
async function loadInitialDataFromJson(jsonFilePathParam) {
    console.log(`[v4.34_filepath_fix] Attempting to load initial data from ${jsonFilePathParam}...`);
    let client;
    let initialData;

    try {
        // Используем переданный путь к файлу. Если он относительный, он будет разрешен относительно __dirname (корня проекта)
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
    console.log("[v4.34_filepath_fix] 'ports' table ensured.");

    // Container Types Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, 
        description TEXT
      );
    `);
    console.log("[v4.34_filepath_fix] 'container_types' table ensured.");

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
    console.log("[v4.34_filepath_fix] 'base_rates' table ensured.");

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
    console.log("[v4.34_filepath_fix] 'index_config' table ensured.");

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
    console.log("[v4.34_filepath_fix] 'model_settings' table ensured.");

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
        console.error('[v4.34_filepath_fix loadCalculationConfigFromDB] Error loading calculation config from DB:', error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

// --- API Маршруты для Публичного Калькулятора ---
app.get("/api/public/ports", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/public/ports GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, code, region, country FROM ports ORDER BY name ASC");
        console.log(`[v4.34_filepath_fix /api/public/ports GET] Found ${result.rows.length} ports.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/public/ports GET] Client released.");
    }
}));

app.get("/api/public/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/public/container-types GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, description FROM container_types ORDER BY name ASC");
        console.log(`[v4.34_filepath_fix /api/public/container-types GET] Found ${result.rows.length} container types.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/public/container-types GET] Client released.");
    }
}));

app.post("/api/calculate", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/calculate POST] Request received with body:", req.body);
    const { originPort, destinationPort, containerType, weight, email } = req.body;

    if (!originPort || !destinationPort || !containerType) {
        console.log("[v4.34_filepath_fix /api/calculate POST] Missing required fields.");
        return res.status(400).json({ error: "Origin port, destination port, and container type are required." });
    }
    if (email && !validateEmail(email)) {
        console.log("[v4.34_filepath_fix /api/calculate POST] Invalid email format.");
        return res.status(400).json({ error: "Invalid email format." });
    }

    let client;
    try {
        client = await pool.connect();
        console.log("[v4.34_filepath_fix /api/calculate POST] Connected to DB for calculation.");

        // Получаем ID портов
        const originPortResult = await client.query('SELECT id, name, region FROM ports WHERE name = $1', [originPort]);
        const destinationPortResult = await client.query('SELECT id, name, region FROM ports WHERE name = $1', [destinationPort]);

        if (originPortResult.rows.length === 0 || destinationPortResult.rows.length === 0) {
            console.log("[v4.34_filepath_fix /api/calculate POST] Origin or destination port not found.");
            return res.status(404).json({ error: "Origin or destination port not found." });
        }

        const originPortId = originPortResult.rows[0].id;
        const originPortRegion = originPortResult.rows[0].region;
        const destinationPortId = destinationPortResult.rows[0].id;
        const destinationPortRegion = destinationPortResult.rows[0].region;

        console.log(`[v4.34_filepath_fix /api/calculate POST] Origin: ${originPort} (ID: ${originPortId}, Region: ${originPortRegion}), Dest: ${destinationPort} (ID: ${destinationPortId}, Region: ${destinationPortRegion})`);

        // Загрузка актуальной конфигурации для расчета
        const { baseRatesConfig, indicesConfig, modelSettings } = await loadCalculationConfigFromDB();
        console.log("[v4.34_filepath_fix /api/calculate POST] Calculation config loaded from DB.");

        // Получение фактора сезонности
        const seasonalityFactor = await fetchSeasonalityFactor(client, originPortRegion, destinationPortRegion, containerType);
        console.log(`[v4.34_filepath_fix /api/calculate POST] Seasonality factor: ${seasonalityFactor}`);

        // Расчет ставки
        const { finalRate, details } = calculateFreightRate(
            originPortRegion, 
            destinationPortRegion, 
            containerType, 
            parseFloat(weight) || 0, // Если вес не указан, считаем 0
            baseRatesConfig, 
            indicesConfig, 
            modelSettings,
            seasonalityFactor
        );
        console.log(`[v4.34_filepath_fix /api/calculate POST] Calculated final rate: ${finalRate}`);

        // Сохранение истории запроса, если указан email
        if (email) {
            await saveRequestToHistory(client, originPortId, destinationPortId, containerType, parseFloat(weight) || 0, finalRate, email, details.indexValuesUsed);
            console.log("[v4.34_filepath_fix /api/calculate POST] Request saved to history.");
        }

        res.json({ rate: finalRate, details: details });

    } catch (error) {
        console.error("[v4.34_filepath_fix /api/calculate POST] Error during calculation:", error);
        res.status(500).json({ error: "An error occurred during freight calculation." });
    } finally {
        if (client) {
            client.release();
            console.log("[v4.34_filepath_fix /api/calculate POST] Client released after calculation.");
        }
    }
}));

// --- API Маршруты для Админ Панели ---

// Получить все порты
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

// Добавить новый порт
app.post("/api/admin/ports", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/ports POST] Request received with body:", req.body);
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) {
        console.log("[v4.34_filepath_fix /api/admin/ports POST] Missing port name.");
        return res.status(400).json({ error: "Port name is required" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO ports (name, code, region, country, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [name, code || null, region || null, country || null, latitude || null, longitude || null]
        );
        console.log("[v4.34_filepath_fix /api/admin/ports POST] Port added:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/ports POST] Client released.");
    }
}));

// Обновить порт
app.put("/api/admin/ports/:id", asyncHandler(async (req, res) => {
    const { id } = req.params;
    console.log(`[v4.34_filepath_fix /api/admin/ports PUT] Request received for ID: ${id} with body:`, req.body);
    const { name, code, region, country, latitude, longitude } = req.body;
    if (!name) {
        console.log("[v4.34_filepath_fix /api/admin/ports PUT] Missing port name.");
        return res.status(400).json({ error: "Port name is required" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE ports SET name = $1, code = $2, region = $3, country = $4, latitude = $5, longitude = $6 WHERE id = $7 RETURNING *",
            [name, code || null, region || null, country || null, latitude || null, longitude || null, id]
        );
        if (result.rows.length === 0) {
            console.log(`[v4.34_filepath_fix /api/admin/ports PUT] Port with ID ${id} not found.`);
            return res.status(404).json({ error: "Port not found" });
        }
        console.log("[v4.34_filepath_fix /api/admin/ports PUT] Port updated:", result.rows[0]);
        res.json(result.rows[0]);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/ports PUT] Client released.");
    }
}));

// Удалить порт
app.delete("/api/admin/ports/:id", asyncHandler(async (req, res) => {
    const { id } = req.params;
    console.log(`[v4.34_filepath_fix /api/admin/ports DELETE] Request received for ID: ${id}`);
    const client = await pool.connect();
    try {
        // Сначала проверим, связан ли порт с какими-либо записями в calculation_history
        const historyCheck = await client.query(
            "SELECT COUNT(*) FROM calculation_history WHERE origin_port_id = $1 OR destination_port_id = $1", 
            [id]
        );
        if (parseInt(historyCheck.rows[0].count) > 0) {
            console.log(`[v4.34_filepath_fix /api/admin/ports DELETE] Port ID ${id} is used in calculation_history and cannot be deleted directly.`);
            return res.status(400).json({ error: "Port is used in calculation history. Consider archiving or contact support." });
        }

        const result = await client.query("DELETE FROM ports WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            console.log(`[v4.34_filepath_fix /api/admin/ports DELETE] Port with ID ${id} not found.`);
            return res.status(404).json({ error: "Port not found" });
        }
        console.log("[v4.34_filepath_fix /api/admin/ports DELETE] Port deleted:", result.rows[0]);
        res.status(200).json({ message: "Port deleted successfully" }); // Успешное удаление
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/ports DELETE] Client released.");
    }
}));

// Получить все типы контейнеров
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

// Добавить новый тип контейнера
app.post("/api/admin/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/container-types POST] Request received with body:", req.body);
    const { name, description } = req.body;
    if (!name) {
        console.log("[v4.34_filepath_fix /api/admin/container-types POST] Missing container type name.");
        return res.status(400).json({ error: "Container type name is required" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO container_types (name, description) VALUES ($1, $2) RETURNING *",
            [name, description || null]
        );
        console.log("[v4.34_filepath_fix /api/admin/container-types POST] Container type added:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/container-types POST] Client released.");
    }
}));

// Обновить тип контейнера
app.put("/api/admin/container-types/:id", asyncHandler(async (req, res) => {
    const { id } = req.params;
    console.log(`[v4.34_filepath_fix /api/admin/container-types PUT] Request for ID: ${id} with body:`, req.body);
    const { name, description } = req.body;
    if (!name) {
        console.log("[v4.34_filepath_fix /api/admin/container-types PUT] Missing container type name.");
        return res.status(400).json({ error: "Container type name is required" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE container_types SET name = $1, description = $2 WHERE id = $3 RETURNING *",
            [name, description || null, id]
        );
        if (result.rows.length === 0) {
            console.log(`[v4.34_filepath_fix /api/admin/container-types PUT] Container type with ID ${id} not found.`);
            return res.status(404).json({ error: "Container type not found" });
        }
        console.log("[v4.34_filepath_fix /api/admin/container-types PUT] Container type updated:", result.rows[0]);
        res.json(result.rows[0]);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/container-types PUT] Client released.");
    }
}));

// Удалить тип контейнера
app.delete("/api/admin/container-types/:id", asyncHandler(async (req, res) => {
    const { id } = req.params;
    console.log(`[v4.34_filepath_fix /api/admin/container-types DELETE] Request for ID: ${id}`);
    const client = await pool.connect();
    try {
        // Проверка, используется ли тип контейнера в базовых ставках или истории расчетов
        const baseRateCheck = await client.query("SELECT COUNT(*) FROM base_rates WHERE container_type = (SELECT name FROM container_types WHERE id = $1)", [id]);
        const historyCheck = await client.query("SELECT COUNT(*) FROM calculation_history WHERE container_type = (SELECT name FROM container_types WHERE id = $1)", [id]);

        if (parseInt(baseRateCheck.rows[0].count) > 0 || parseInt(historyCheck.rows[0].count) > 0) {
            console.log(`[v4.34_filepath_fix /api/admin/container-types DELETE] Container type ID ${id} is used and cannot be deleted.`);
            return res.status(400).json({ error: "Container type is used in base rates or calculation history. Cannot delete." });
        }

        const result = await client.query("DELETE FROM container_types WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            console.log(`[v4.34_filepath_fix /api/admin/container-types DELETE] Container type with ID ${id} not found.`);
            return res.status(404).json({ error: "Container type not found" });
        }
        console.log("[v4.34_filepath_fix /api/admin/container-types DELETE] Container type deleted:", result.rows[0]);
        res.status(200).json({ message: "Container type deleted successfully" });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/container-types DELETE] Client released.");
    }
}));

// Получить все базовые ставки
app.get("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/base-rates GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, origin_region, destination_region, container_type, rate FROM base_rates ORDER BY origin_region, destination_region, container_type");
        console.log(`[v4.34_filepath_fix /api/admin/base-rates GET] Found ${result.rows.length} base rates.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/base-rates GET] Client released.");
    }
}));

// Добавить новую базовую ставку
app.post("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/base-rates POST] Request with body:", req.body);
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate === undefined) {
        console.log("[v4.34_filepath_fix /api/admin/base-rates POST] Missing required fields.");
        return res.status(400).json({ error: "Origin region, destination region, container type, and rate are required" });
    }
    const parsedRate = parseFloat(rate);
    if (isNaN(parsedRate)) {
        console.log("[v4.34_filepath_fix /api/admin/base-rates POST] Invalid rate value.");
        return res.status(400).json({ error: "Rate must be a valid number" });
    }

    const client = await pool.connect();
    try {
        const result = await client.query(
            "INSERT INTO base_rates (origin_region, destination_region, container_type, rate) VALUES ($1, $2, $3, $4) RETURNING *",
            [origin_region, destination_region, container_type, parsedRate]
        );
        console.log("[v4.34_filepath_fix /api/admin/base-rates POST] Base rate added:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            console.error("[v4.34_filepath_fix /api/admin/base-rates POST] Unique constraint violation:", error.detail);
            return res.status(409).json({ error: "This base rate (combination of origin, destination, and container type) already exists." });
        }
        console.error("[v4.34_filepath_fix /api/admin/base-rates POST] Error adding base rate:", error);
        res.status(500).json({ error: "Failed to add base rate" });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/base-rates POST] Client released.");
    }
}));

// Обновить базовую ставку
app.put("/api/admin/base-rates/:id", asyncHandler(async (req, res) => {
    const { id } = req.params;
    console.log(`[v4.34_filepath_fix /api/admin/base-rates PUT] Request for ID: ${id} with body:`, req.body);
    const { origin_region, destination_region, container_type, rate } = req.body;
    if (!origin_region || !destination_region || !container_type || rate === undefined) {
        console.log("[v4.34_filepath_fix /api/admin/base-rates PUT] Missing required fields.");
        return res.status(400).json({ error: "Origin region, destination region, container type, and rate are required" });
    }
    const parsedRate = parseFloat(rate);
    if (isNaN(parsedRate)) {
        console.log("[v4.34_filepath_fix /api/admin/base-rates PUT] Invalid rate value.");
        return res.status(400).json({ error: "Rate must be a valid number" });
    }

    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE base_rates SET origin_region = $1, destination_region = $2, container_type = $3, rate = $4 WHERE id = $5 RETURNING *",
            [origin_region, destination_region, container_type, parsedRate, id]
        );
        if (result.rows.length === 0) {
            console.log(`[v4.34_filepath_fix /api/admin/base-rates PUT] Base rate with ID ${id} not found.`);
            return res.status(404).json({ error: "Base rate not found" });
        }
        console.log("[v4.34_filepath_fix /api/admin/base-rates PUT] Base rate updated:", result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            console.error("[v4.34_filepath_fix /api/admin/base-rates PUT] Unique constraint violation:", error.detail);
            return res.status(409).json({ error: "This base rate (combination of origin, destination, and container type) already exists with another ID." });
        }
        console.error("[v4.34_filepath_fix /api/admin/base-rates PUT] Error updating base rate:", error);
        res.status(500).json({ error: "Failed to update base rate" });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/base-rates PUT] Client released.");
    }
}));

// Удалить базовую ставку
app.delete("/api/admin/base-rates/:id", asyncHandler(async (req, res) => {
    const { id } = req.params;
    console.log(`[v4.34_filepath_fix /api/admin/base-rates DELETE] Request for ID: ${id}`);
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM base_rates WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            console.log(`[v4.34_filepath_fix /api/admin/base-rates DELETE] Base rate with ID ${id} not found.`);
            return res.status(404).json({ error: "Base rate not found" });
        }
        console.log("[v4.34_filepath_fix /api/admin/base-rates DELETE] Base rate deleted:", result.rows[0]);
        res.status(200).json({ message: "Base rate deleted successfully" });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/base-rates DELETE] Client released.");
    }
}));

// Получить конфигурацию индексов
app.get("/api/admin/index-config", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/index-config GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name");
        console.log(`[v4.34_filepath_fix /api/admin/index-config GET] Found ${result.rows.length} index configs.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/index-config GET] Client released.");
    }
}));

// Добавить/Обновить конфигурацию индекса (через POST, так как имя индекса - первичный ключ)
app.post("/api/admin/index-config", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/index-config POST] Request with body:", req.body);
    const { index_name, baseline_value, weight_percentage, current_value } = req.body;
    if (!index_name || baseline_value === undefined || weight_percentage === undefined || current_value === undefined) {
        console.log("[v4.34_filepath_fix /api/admin/index-config POST] Missing required fields.");
        return res.status(400).json({ error: "Index name, baseline value, weight percentage, and current value are required" });
    }
    const bl = parseFloat(baseline_value);
    const wp = parseFloat(weight_percentage);
    const cv = parseFloat(current_value);

    if (isNaN(bl) || isNaN(wp) || isNaN(cv)) {
        console.log("[v4.34_filepath_fix /api/admin/index-config POST] Invalid numeric values.");
        return res.status(400).json({ error: "Baseline, weight, and current value must be valid numbers." });
    }
    if (wp < 0 || wp > 100) {
        console.log("[v4.34_filepath_fix /api/admin/index-config POST] Invalid weight percentage.");
        return res.status(400).json({ error: "Weight percentage must be between 0 and 100." });
    }

    const client = await pool.connect();
    try {
        const result = await client.query(
            `INSERT INTO index_config (index_name, baseline_value, weight_percentage, current_value, last_updated) 
             VALUES ($1, $2, $3, $4, NOW()) 
             ON CONFLICT (index_name) DO UPDATE SET 
               baseline_value = EXCLUDED.baseline_value, 
               weight_percentage = EXCLUDED.weight_percentage, 
               current_value = EXCLUDED.current_value, 
               last_updated = NOW()
             RETURNING *`,
            [index_name, bl, wp, cv]
        );
        console.log("[v4.34_filepath_fix /api/admin/index-config POST] Index config added/updated:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/index-config POST] Client released.");
    }
}));

// Удалить конфигурацию индекса
app.delete("/api/admin/index-config/:index_name", asyncHandler(async (req, res) => {
    const { index_name } = req.params;
    console.log(`[v4.34_filepath_fix /api/admin/index-config DELETE] Request for index_name: ${index_name}`);
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM index_config WHERE index_name = $1 RETURNING *", [index_name]);
        if (result.rows.length === 0) {
            console.log(`[v4.34_filepath_fix /api/admin/index-config DELETE] Index config '${index_name}' not found.`);
            return res.status(404).json({ error: "Index config not found" });
        }
        console.log("[v4.34_filepath_fix /api/admin/index-config DELETE] Index config deleted:", result.rows[0]);
        res.status(200).json({ message: "Index config deleted successfully" });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/index-config DELETE] Client released.");
    }
}));

// Получить настройки модели
app.get("/api/admin/model-settings", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/model-settings GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT setting_key, setting_value, description FROM model_settings");
        console.log(`[v4.34_filepath_fix /api/admin/model-settings GET] Found ${result.rows.length} model settings.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/model-settings GET] Client released.");
    }
}));

// Обновить настройку модели
app.put("/api/admin/model-settings/:setting_key", asyncHandler(async (req, res) => {
    const { setting_key } = req.params;
    console.log(`[v4.34_filepath_fix /api/admin/model-settings PUT] Request for key: ${setting_key} with body:`, req.body);
    const { setting_value, description } = req.body;
    if (setting_value === undefined) {
        console.log("[v4.34_filepath_fix /api/admin/model-settings PUT] Missing setting_value.");
        return res.status(400).json({ error: "Setting value is required" });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE model_settings SET setting_value = $1, description = $2 WHERE setting_key = $3 RETURNING *",
            [String(setting_value), description || null, setting_key]
        );
        if (result.rows.length === 0) {
            console.log(`[v4.34_filepath_fix /api/admin/model-settings PUT] Setting key '${setting_key}' not found.`);
            return res.status(404).json({ error: "Setting key not found" });
        }
        console.log("[v4.34_filepath_fix /api/admin/model-settings PUT] Model setting updated:", result.rows[0]);
        res.json(result.rows[0]);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/model-settings PUT] Client released.");
    }
}));

// Загрузка данных сезонности из Excel
app.post("/api/admin/upload-seasonality", upload.single('seasonalityFile'), asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/upload-seasonality POST] Request received.");
    if (!req.file) {
        console.log("[v4.34_filepath_fix /api/admin/upload-seasonality POST] No file uploaded.");
        return res.status(400).send('No file uploaded.');
    }
    console.log("[v4.34_filepath_fix /api/admin/upload-seasonality POST] File received:", req.file.originalname);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("[v4.34_filepath_fix /api/admin/upload-seasonality POST] Transaction started.");
        
        // Вызов функции из seasonality_analyzer.js для обработки файла и обновления БД
        const result = await initializeAndUpdateSeasonalityData(client, req.file.buffer);
        
        await client.query('COMMIT');
        console.log("[v4.34_filepath_fix /api/admin/upload-seasonality POST] Transaction committed.");
        res.status(200).json({ 
            message: "Seasonality data uploaded and processed successfully.", 
            details: result 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("[v4.34_filepath_fix /api/admin/upload-seasonality POST] Error processing seasonality file, rolled back transaction:", error);
        res.status(500).json({ error: "Error processing seasonality file: " + error.message, details: error.details || {} });
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/upload-seasonality POST] Client released.");
    }
}));

// Получить историю расчетов
app.get("/api/admin/calculation-history", asyncHandler(async (req, res) => {
    console.log("[v4.34_filepath_fix /api/admin/calculation-history GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                ch.id, ch.timestamp, 
                op.name as origin_port_name, 
                dp.name as destination_port_name, 
                ch.container_type, ch.weight, ch.calculated_rate, ch.user_email, ch.index_values_used
            FROM calculation_history ch
            LEFT JOIN ports op ON ch.origin_port_id = op.id
            LEFT JOIN ports dp ON ch.destination_port_id = dp.id
            ORDER BY ch.timestamp DESC
        `);
        console.log(`[v4.34_filepath_fix /api/admin/calculation-history GET] Found ${result.rows.length} history records.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.34_filepath_fix /api/admin/calculation-history GET] Client released.");
    }
}));

// Глобальный обработчик ошибок Express
app.use((err, req, res, next) => {
  console.error("[v4.34_filepath_fix Global Error Handler] An error occurred:", err);
  // Если заголовки уже отправлены, передаем ошибку дальше стандартному обработчику Express
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    // Можно добавить stack trace в режиме разработки
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Запуск сервера после инициализации
(async () => {
  try {
    await initializeSystem();
    app.listen(PORT, () => {
      console.log(`[v4.34_filepath_fix] Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("[v4.34_filepath_fix] Failed to initialize system or start server:", error);
    process.exit(1); // Выход, если инициализация не удалась
  }
})();

