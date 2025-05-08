// server_v4.45_auto_migrate.js
// Интеграционный модуль v4.45: Автоматическая миграция БД при запуске.

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

// --- Функция автоматической миграции базы данных ---
async function autoMigrateDatabase() {
    console.log('[v4.45 Auto-Migration] Начало автоматической миграции базы данных...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Проверка и переименование столбца Container_Type_ID в container_type_id в base_rates
        const baseRatesColumns = await client.query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = 'base_rates' AND column_name = 'Container_Type_ID';`
        );
        if (baseRatesColumns.rows.length > 0) {
            const checkLowercaseColumnBaseRates = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'base_rates' AND column_name = 'container_type_id';`
            );
            if (checkLowercaseColumnBaseRates.rows.length === 0) {
                console.log('[v4.45 Auto-Migration] Обнаружен столбец "Container_Type_ID" в таблице "base_rates". Переименование в "container_type_id"...');
                await client.query('ALTER TABLE base_rates RENAME COLUMN "Container_Type_ID" TO container_type_id;');
                console.log('[v4.45 Auto-Migration] Столбец "Container_Type_ID" в "base_rates" успешно переименован в "container_type_id".');
            } else {
                 console.log('[v4.45 Auto-Migration] Столбец "container_type_id" уже существует в "base_rates". Переименование "Container_Type_ID" не требуется или уже выполнено.');
            }
        } else {
            console.log('[v4.45 Auto-Migration] Столбец "Container_Type_ID" не найден в "base_rates". Проверка на "container_type_id"...');
            // Дополнительно убедимся, что столбец container_type_id существует, если Container_Type_ID не найден
            const checkLowercaseColumnBaseRates = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'base_rates' AND column_name = 'container_type_id';`
            );
            if (checkLowercaseColumnBaseRates.rows.length === 0) {
                 console.warn('[v4.45 Auto-Migration] ВНИМАНИЕ: Ни "Container_Type_ID", ни "container_type_id" не найдены в "base_rates". Таблица может быть не в ожидаемом состоянии или будет создана позже.');
            } else {
                 console.log('[v4.45 Auto-Migration] Столбец "container_type_id" уже существует в "base_rates".');
            }
        }

        // Проверка и переименование столбца Container_Type_ID в container_type_id в calculation_history
        const calcHistoryColumns = await client.query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = 'calculation_history' AND column_name = 'Container_Type_ID';`
        );
        if (calcHistoryColumns.rows.length > 0) {
            const checkLowercaseColumnCalcHistory = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'calculation_history' AND column_name = 'container_type_id';`
            );
            if (checkLowercaseColumnCalcHistory.rows.length === 0) {
                console.log('[v4.45 Auto-Migration] Обнаружен столбец "Container_Type_ID" в таблице "calculation_history". Переименование в "container_type_id"...');
                await client.query('ALTER TABLE calculation_history RENAME COLUMN "Container_Type_ID" TO container_type_id;');
                console.log('[v4.45 Auto-Migration] Столбец "Container_Type_ID" в "calculation_history" успешно переименован в "container_type_id".');
            } else {
                console.log('[v4.45 Auto-Migration] Столбец "container_type_id" уже существует в "calculation_history". Переименование "Container_Type_ID" не требуется или уже выполнено.');
            }
        } else {
            console.log('[v4.45 Auto-Migration] Столбец "Container_Type_ID" не найден в "calculation_history". Проверка на "container_type_id"...');
            // Дополнительно убедимся, что столбец container_type_id существует
            const checkLowercaseColumnCalcHistory = await client.query(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_schema = 'public' AND table_name = 'calculation_history' AND column_name = 'container_type_id';`
            );
            if (checkLowercaseColumnCalcHistory.rows.length === 0) {
                console.warn('[v4.45 Auto-Migration] ВНИМАНИЕ: Ни "Container_Type_ID", ни "container_type_id" не найдены в "calculation_history". Таблица может быть не в ожидаемом состоянии или будет создана позже.');
            } else {
                console.log('[v4.45 Auto-Migration] Столбец "container_type_id" уже существует в "calculation_history".');
            }
        }
        
        // Этот блок не создает таблицы, он только переименовывает столбцы.
        // Создание таблиц происходит в initializeDatabaseTables().
        console.log("[v4.45 Auto-Migration] Проверка и переименование столбцов завершены.");

        await client.query('COMMIT');
        console.log('[v4.45 Auto-Migration] Автоматическая миграция базы данных успешно завершена (или не требовалась).');

    } catch (error) {
        console.error('[v4.45 Auto-Migration] Ошибка во время автоматической миграции базы данных, попытка отката...');
        if (client) {
            try { await client.query('ROLLBACK'); console.log("[v4.45 Auto-Migration] Транзакция откатана."); } 
            catch (rollbackError) { console.error("[v4.45 Auto-Migration] Ошибка отката транзакции:", rollbackError); }
        }
        console.error('[v4.45 Auto-Migration] Ошибка автоматической миграции:', error);
        throw error; // Передаем ошибку дальше, чтобы предотвратить запуск сервера при неудачной миграции
    } finally {
        if (client) { client.release(); console.log('[v4.45 Auto-Migration] Соединение с базой данных закрыто после миграции.'); }
    }
}


// --- Инициализация таблиц базы данных (без изменений из v4.44) ---
async function initializeDatabaseTables() {
  console.log("[v4.45] Initializing database tables...");
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
    console.log("[v4.45] 'ports' table ensured.");
    await client.query(`
      CREATE TABLE IF NOT EXISTS container_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL, 
        description TEXT
      );
    `);
    console.log("[v4.45] 'container_types' table ensured.");
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
    console.log("[v4.45] 'base_rates' table ensured (with container_type_id).");
    await client.query(`
      CREATE TABLE IF NOT EXISTS index_config (
        index_name VARCHAR(50) PRIMARY KEY,
        baseline_value NUMERIC NOT NULL,
        weight_percentage NUMERIC NOT NULL CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
        current_value NUMERIC,
        last_updated TIMESTAMP
      );
    `);
    console.log("[v4.45] 'index_config' table ensured.");
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
    console.log("[v4.45] 'model_settings' table ensured.");
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
    console.log("[v4.45] 'calculation_history' table ensured (with container_type_id).");
    await initializeSeasonalityTables(client); 
    console.log("[v4.45] Seasonality tables initialized via external module.");
    await client.query("COMMIT");
    console.log("[v4.45] Database tables initialized/verified successfully.");
  } catch (error) {
    console.error("[v4.45] Error during database transaction, attempting rollback...");
    if (client) { 
      try { await client.query("ROLLBACK"); console.log("[v4.45] Transaction rolled back."); } catch (rollbackError) { console.error("[v4.45] Rollback failed:", rollbackError); }
    }
    console.error("[v4.45] Error initializing database tables:", error);
    throw error;
  } finally {
    if (client) { client.release(); console.log("[v4.45] Database client released after table initialization."); }
  }
}

// --- Загрузка начальных данных из JSON (без изменений из v4.44) ---
async function loadInitialDataFromJson(jsonFilePathParam) {
    console.log(`[v4.45] Attempting to load initial data from ${jsonFilePathParam}...`);
    let client;
    let initialData;
    try {
        const jsonFilePath = path.isAbsolute(jsonFilePathParam) ? jsonFilePathParam : path.join(__dirname, jsonFilePathParam);
        const jsonData = fs.readFileSync(jsonFilePath, 'utf8');
        initialData = JSON.parse(jsonData);
        console.log(`[v4.45] Successfully loaded and parsed ${jsonFilePath}`);
    } catch (err) {
        console.error(`[v4.45] Fatal Error: Could not read or parse ${jsonFilePathParam}. Ensure '${path.basename(jsonFilePathParam)}' is in the root directory. Error:`, err);
        throw new Error("Failed to load initial data from JSON file.");
    }
    if (!initialData || !initialData.ports || !initialData.container_types || !initialData.indices) {
        console.error("[v4.45] Fatal Error: JSON data is missing required keys (ports, container_types, indices).");
        throw new Error("Invalid initial data structure in JSON file.");
    }
    try {
        client = await pool.connect();
        console.log("[v4.45] Connected to DB for initial data load.");
        console.log("[v4.45] Loading ports from JSON...");
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
                console.warn(`[v4.45] Error inserting/updating port row: ${JSON.stringify(port)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.45] Finished loading/updating ports. ${portCount} rows processed.`);
        console.log("[v4.45] Loading container types from JSON...");
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
                console.warn(`[v4.45] Error inserting/updating container type row: ${JSON.stringify(ct)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.45] Finished loading/updating container types. ${ctCount} rows processed.`);
        console.log("[v4.45] Loading index config from JSON...");
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
                     console.warn(`[v4.45] Skipping invalid index config row: ${JSON.stringify(index)}`);
                }
            } catch (err) {
                console.warn(`[v4.45] Error inserting/updating index config row: ${JSON.stringify(index)}, Error: ${err.message}`);
            }
        }
        console.log(`[v4.45] Finished loading/updating index config. ${icCount} rows processed.`);
        console.log("[v4.45] Initial base rates are managed via admin panel. Skipping loading from JSON.");
        console.log("[v4.45] Initial data loading process completed.");
    } catch (error) {
        console.error("[v4.45] Error loading initial data into database:", error);
    } finally {
        if (client) { client.release(); console.log("[v4.45] Database client released after initial data load."); }
    }
}

// --- Инициализация системы (обновленная для включения автомиграции) ---
async function initializeSystem() {
  try {
    console.log("Initializing freight calculator system v4.45 (Auto-Migration).");
    // Шаг 1: Выполнить автоматическую миграцию
    await autoMigrateDatabase(); 
    // Шаг 2: Инициализировать/проверить таблицы (это также создаст их, если они не существуют)
    await initializeDatabaseTables();
    // Шаг 3: Загрузить начальные данные
    await loadInitialDataFromJson('./extracted_data.json'); 
    console.log("System initialization completed for v4.45 (Auto-Migration).");
  } catch (error) {
    console.error("Error initializing system v4.45 (Auto-Migration):", error);
    // Важно: если инициализация не удалась, сервер не должен запускаться
    // или должен завершить работу, чтобы избежать работы в некорректном состоянии.
    process.exit(1); 
  }
}

function validateEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

async function loadCalculationConfigFromDB() {
    console.log("[v4.45 loadCalculationConfigFromDB] Attempting to load calculation config from DB.");
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
        console.error("[v4.45 loadCalculationConfigFromDB] Error loading calculation config from DB:", error);
        throw error;
    } finally {
        if (client) client.release();
    }
}

// --- API Маршруты для Публичного Калькулятора ---
app.get("/api/ports", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/ports GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, code FROM ports ORDER BY name ASC");
        console.log(`[v4.45 /api/ports GET] Found ${result.rows.length} ports.`);
        res.json(result.rows.map(p => ({ id: parseInt(p.id, 10), name: p.name, code: p.code, displayText: `${p.name} (${p.code})` })));
    } finally {
        client.release();
        console.log("[v4.45 /api/ports GET] Client released.");
    }
}));

app.get("/api/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/container-types GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, description FROM container_types ORDER BY name ASC");
        console.log(`[v4.45 /api/container-types GET] Found ${result.rows.length} container types.`);
        res.json(result.rows.map(ct => ({ ...ct, id: parseInt(ct.id, 10) })));
    } finally {
        client.release();
        console.log("[v4.45 /api/container-types GET] Client released.");
    }
}));

app.post("/api/calculate", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/calculate POST] Request received with body:", req.body);
    const { originPort, destinationPort, containerType, weight, email } = req.body;

    console.log(`[v4.45 /api/calculate POST] Received originPort: ${originPort} (type: ${typeof originPort})`);
    console.log(`[v4.45 /api/calculate POST] Received destinationPort: ${destinationPort} (type: ${typeof destinationPort})`);
    console.log(`[v4.45 /api/calculate POST] Received containerType: ${containerType} (type: ${typeof containerType})`);

    if (!originPort || !destinationPort || !containerType) {
        console.log("[v4.45 /api/calculate POST] Missing required fields.");
        return res.status(400).json({ error: "Origin port, destination port, and container type are required." });
    }

    const originPortId = parseInt(originPort, 10);
    const destinationPortId = parseInt(destinationPort, 10);
    const containerTypeId = parseInt(containerType, 10);

    if (isNaN(originPortId) || isNaN(destinationPortId) || isNaN(containerTypeId)) {
        console.error("[v4.45 /api/calculate POST] Invalid ID format for port or container type.");
        return res.status(400).json({ error: "Invalid ID format for port or container type." });
    }

    if (email && !validateEmail(email)) {
        console.log("[v4.45 /api/calculate POST] Invalid email format.");
        return res.status(400).json({ error: "Invalid email format." });
    }

    try {
        const config = await loadCalculationConfigFromDB();
        console.log("[v4.45 /api/calculate POST] Calculation config loaded.");

        const { finalRate, detailedBreakdown, seasonalityFactor, compositeIndexEffect } = await calculateFreightRate(
            pool, 
            originPortId, 
            destinationPortId, 
            containerTypeId, 
            parseFloat(weight) || 0, 
            config
        );
        console.log(`[v4.45 /api/calculate POST] Calculation successful. Final rate: ${finalRate}`);

        if (email) {
            await saveRequestToHistory(pool, originPortId, destinationPortId, containerTypeId, parseFloat(weight) || 0, finalRate, email, detailedBreakdown.indexValuesUsed);
            console.log("[v4.45 /api/calculate POST] Request saved to history.");
        }

        res.json({ 
            rate: finalRate, 
            breakdown: detailedBreakdown, 
            seasonalityFactor: seasonalityFactor,
            compositeIndexEffect: compositeIndexEffect 
        });

    } catch (error) {
        console.error("[v4.45 /api/calculate POST] Error during freight calculation:", error);
        res.status(500).json({ error: "An error occurred during freight calculation.", details: error.message });
    }
}));

// --- API Маршруты для Админ Панели (CRUD операции) ---
// ... (остальная часть CRUD операций для портов, типов контейнеров, базовых ставок, конфигурации индексов, настроек модели, истории расчетов)
// ВАЖНО: Убедиться, что все логи версий обновлены до v4.45 и все SQL запросы используют container_type_id в нижнем регистре.

// GET Ports (Admin)
app.get("/api/admin/ports", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/ports GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, code, region, country, latitude, longitude FROM ports ORDER BY name ASC");
        console.log(`[v4.45 /api/admin/ports GET] Found ${result.rows.length} ports.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/ports GET] Client released.");
    }
}));

// POST Port (Admin)
app.post("/api/admin/ports", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/ports POST] Request received with body:", req.body);
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
        console.log("[v4.45 /api/admin/ports POST] Port added:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("[v4.45 /api/admin/ports POST] Error adding port:", error);
        res.status(500).json({ error: "Failed to add port.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/ports POST] Client released.");
    }
}));

// PUT Port (Admin)
app.put("/api/admin/ports/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.45 /api/admin/ports PUT] ID: ${req.params.id}, Body:`, req.body);
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
        console.log("[v4.45 /api/admin/ports PUT] Port updated:", result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.45 /api/admin/ports PUT] Error updating port:", error);
        res.status(500).json({ error: "Failed to update port.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/ports PUT] Client released.");
    }
}));

// DELETE Port (Admin)
app.delete("/api/admin/ports/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.45 /api/admin/ports DELETE] ID: ${req.params.id}`);
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM ports WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Port not found." });
        }
        console.log("[v4.45 /api/admin/ports DELETE] Port deleted:", result.rows[0]);
        res.status(204).send();
    } catch (error) {
        console.error("[v4.45 /api/admin/ports DELETE] Error deleting port:", error);
        // Check for foreign key constraint violation (e.g., if port is used in calculation_history)
        if (error.code === '23503') { // PostgreSQL error code for foreign_key_violation
             return res.status(400).json({ error: "Cannot delete port: it is currently used in calculation history or other records. Please remove dependent records first." });
        }
        res.status(500).json({ error: "Failed to delete port.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/ports DELETE] Client released.");
    }
}));

// GET Container Types (Admin)
app.get("/api/admin/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/container-types GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT id, name, description FROM container_types ORDER BY name ASC");
        console.log(`[v4.45 /api/admin/container-types GET] Found ${result.rows.length} container types.`);
        res.json(result.rows);
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/container-types GET] Client released.");
    }
}));

// POST Container Type (Admin)
app.post("/api/admin/container-types", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/container-types POST] Request received with body:", req.body);
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
        console.log("[v4.45 /api/admin/container-types POST] Container type added:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("[v4.45 /api/admin/container-types POST] Error adding container type:", error);
        res.status(500).json({ error: "Failed to add container type.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/container-types POST] Client released.");
    }
}));

// PUT Container Type (Admin)
app.put("/api/admin/container-types/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.45 /api/admin/container-types PUT] ID: ${req.params.id}, Body:`, req.body);
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
        console.log("[v4.45 /api/admin/container-types PUT] Container type updated:", result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.45 /api/admin/container-types PUT] Error updating container type:", error);
        res.status(500).json({ error: "Failed to update container type.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/container-types PUT] Client released.");
    }
}));

// DELETE Container Type (Admin)
app.delete("/api/admin/container-types/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.45 /api/admin/container-types DELETE] ID: ${req.params.id}`);
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const checkBaseRates = await client.query("SELECT 1 FROM base_rates WHERE container_type_id = $1 LIMIT 1", [id]);
        if (checkBaseRates.rows.length > 0) {
            console.log("[v4.45 /api/admin/container-types DELETE] Attempt to delete container type used in base_rates.");
            return res.status(400).json({ error: "Cannot delete container type: it is currently used in base rates. Please update base rates first." });
        }
        const checkCalcHistory = await client.query("SELECT 1 FROM calculation_history WHERE container_type_id = $1 LIMIT 1", [id]);
        if (checkCalcHistory.rows.length > 0) {
            console.log("[v4.45 /api/admin/container-types DELETE] Attempt to delete container type used in calculation_history.");
            return res.status(400).json({ error: "Cannot delete container type: it is currently used in calculation history. Please remove dependent records first." });
        }
        const result = await client.query("DELETE FROM container_types WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Container type not found." });
        }
        console.log("[v4.45 /api/admin/container-types DELETE] Container type deleted:", result.rows[0]);
        res.status(204).send();
    } catch (error) {
        console.error("[v4.45 /api/admin/container-types DELETE] Error deleting container type:", error);
        res.status(500).json({ error: "Failed to delete container type.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/container-types DELETE] Client released.");
    }
}));

// GET Base Rates (Admin)
app.get("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/base-rates GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT br.id, br.origin_region, br.destination_region, br.container_type_id, ct.name as container_type_name, br.rate FROM base_rates br JOIN container_types ct ON br.container_type_id = ct.id ORDER BY br.origin_region, br.destination_region, ct.name ASC");
        console.log(`[v4.45 /api/admin/base-rates GET] Found ${result.rows.length} base rates.`);
        res.json(result.rows);
    } catch (error) {
        console.error("[v4.45 /api/admin/base-rates GET] Error fetching base rates:", error);
        res.status(500).json({ error: "Failed to fetch base rates.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/base-rates GET] Client released.");
    }
}));

// POST Base Rate (Admin)
app.post("/api/admin/base-rates", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/base-rates POST] Request received with body:", req.body);
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
        const newRate = await client.query("SELECT br.id, br.origin_region, br.destination_region, br.container_type_id, ct.name as container_type_name, br.rate FROM base_rates br JOIN container_types ct ON br.container_type_id = ct.id WHERE br.id = $1", [result.rows[0].id]);
        console.log("[v4.45 /api/admin/base-rates POST] Base rate added:", newRate.rows[0]);
        res.status(201).json(newRate.rows[0]);
    } catch (error) {
        console.error("[v4.45 /api/admin/base-rates POST] Error adding base rate:", error);
        res.status(500).json({ error: "Failed to add base rate.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/base-rates POST] Client released.");
    }
}));

// PUT Base Rate (Admin)
app.put("/api/admin/base-rates/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.45 /api/admin/base-rates PUT] ID: ${req.params.id}, Body:`, req.body);
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
        console.log("[v4.45 /api/admin/base-rates PUT] Base rate updated:", updatedRate.rows[0]);
        res.json(updatedRate.rows[0]);
    } catch (error) {
        console.error("[v4.45 /api/admin/base-rates PUT] Error updating base rate:", error);
        res.status(500).json({ error: "Failed to update base rate.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/base-rates PUT] Client released.");
    }
}));

// DELETE Base Rate (Admin)
app.delete("/api/admin/base-rates/:id", asyncHandler(async (req, res) => {
    console.log(`[v4.45 /api/admin/base-rates DELETE] ID: ${req.params.id}`);
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query("DELETE FROM base_rates WHERE id = $1 RETURNING *", [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Base rate not found." });
        }
        console.log("[v4.45 /api/admin/base-rates DELETE] Base rate deleted:", result.rows[0]);
        res.status(204).send();
    } catch (error) {
        console.error("[v4.45 /api/admin/base-rates DELETE] Error deleting base rate:", error);
        res.status(500).json({ error: "Failed to delete base rate.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/base-rates DELETE] Client released.");
    }
}));

// GET Index Config (Admin)
app.get("/api/admin/index-config", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/index-config GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT index_name, baseline_value, weight_percentage, current_value, last_updated FROM index_config ORDER BY index_name ASC");
        console.log(`[v4.45 /api/admin/index-config GET] Found ${result.rows.length} index configs.`);
        res.json(result.rows);
    } catch (error) {
        console.error("[v4.45 /api/admin/index-config GET] Error fetching index config:", error);
        res.status(500).json({ error: "Failed to fetch index config.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/index-config GET] Client released.");
    }
}));

// PUT Index Config (Admin)
app.put("/api/admin/index-config/:index_name", asyncHandler(async (req, res) => {
    console.log(`[v4.45 /api/admin/index-config PUT] Index Name: ${req.params.index_name}, Body:`, req.body);
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
        console.log("[v4.45 /api/admin/index-config PUT] Index config updated:", result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("[v4.45 /api/admin/index-config PUT] Error updating index config:", error);
        res.status(500).json({ error: "Failed to update index config.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/index-config PUT] Client released.");
    }
}));

// GET Model Settings (Admin)
app.get("/api/admin/model-settings", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/model-settings GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT setting_key, setting_value, description FROM model_settings ORDER BY setting_key ASC");
        console.log(`[v4.45 /api/admin/model-settings GET] Found ${result.rows.length} model settings.`);
        res.json(result.rows);
    } catch (error) {
        console.error("[v4.45 /api/admin/model-settings GET] Error fetching model settings:", error);
        res.status(500).json({ error: "Failed to fetch model settings.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/model-settings GET] Client released.");
    }
}));

// PUT Model Settings (Admin)
app.put("/api/admin/model-settings/:setting_key", asyncHandler(async (req, res) => {
    console.log(`[v4.45 /api/admin/model-settings PUT] Key: ${req.params.setting_key}, Body:`, req.body);
    const { setting_key } = req.params;
    const { setting_value, description } = req.body;
    if (setting_value === undefined) {
        return res.status(400).json({ error: "Setting value is required." });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            "UPDATE model_settings SET setting_value = $1, description = $2 WHERE setting_key = $3 RETURNING *",
            [setting_value, description, setting_key]
        );
        if (result.rows.length === 0) {
             // If the setting_key does not exist, create it (upsert behavior)
            const insertResult = await client.query(
                "INSERT INTO model_settings (setting_key, setting_value, description) VALUES ($1, $2, $3) RETURNING *",
                [setting_key, setting_value, description]
            );
            console.log("[v4.45 /api/admin/model-settings PUT] Model setting created:", insertResult.rows[0]);
            res.status(201).json(insertResult.rows[0]);
        } else {
            console.log("[v4.45 /api/admin/model-settings PUT] Model setting updated:", result.rows[0]);
            res.json(result.rows[0]);
        }
    } catch (error) {
        console.error("[v4.45 /api/admin/model-settings PUT] Error updating/creating model setting:", error);
        res.status(500).json({ error: "Failed to update or create model setting.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/model-settings PUT] Client released.");
    }
}));

// GET Calculation History (Admin)
app.get("/api/admin/calculation-history", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/calculation-history GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                ch.id, 
                ch.timestamp, 
                op.name as origin_port_name, 
                dp.name as destination_port_name, 
                ct.name as container_type_name, 
                ch.weight, 
                ch.calculated_rate, 
                ch.user_email,
                ch.index_values_used
            FROM calculation_history ch
            LEFT JOIN ports op ON ch.origin_port_id = op.id
            LEFT JOIN ports dp ON ch.destination_port_id = dp.id
            LEFT JOIN container_types ct ON ch.container_type_id = ct.id
            ORDER BY ch.timestamp DESC
        `);
        console.log(`[v4.45 /api/admin/calculation-history GET] Found ${result.rows.length} history records.`);
        res.json(result.rows);
    } catch (error) {
        console.error("[v4.45 /api/admin/calculation-history GET] Error fetching calculation history:", error);
        res.status(500).json({ error: "Failed to fetch calculation history.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/calculation-history GET] Client released.");
    }
}));

// POST Endpoint for Seasonality Data Update
app.post('/api/admin/update-seasonality', upload.single('seasonalityFile'), asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/update-seasonality POST] Request received.");
    if (!req.file) {
        console.log("[v4.45 /api/admin/update-seasonality POST] No file uploaded.");
        return res.status(400).send('No file uploaded.');
    }
    console.log(`[v4.45 /api/admin/update-seasonality POST] File uploaded: ${req.file.originalname}`);
    
    const client = await pool.connect();
    try {
        await initializeAndUpdateSeasonalityData(client, req.file.buffer);
        console.log("[v4.45 /api/admin/update-seasonality POST] Seasonality data updated successfully.");
        res.send('Seasonality data updated successfully.');
    } catch (error) {
        console.error("[v4.45 /api/admin/update-seasonality POST] Error updating seasonality data:", error);
        res.status(500).send(`Error updating seasonality data: ${error.message}`);
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/update-seasonality POST] Client released.");
    }
}));

// GET Seasonality Factors (Admin) - for viewing current factors
app.get("/api/admin/seasonality-factors", asyncHandler(async (req, res) => {
    console.log("[v4.45 /api/admin/seasonality-factors GET] Request received.");
    const client = await pool.connect();
    try {
        const result = await client.query("SELECT month, factor FROM seasonality_factors ORDER BY month ASC");
        console.log(`[v4.45 /api/admin/seasonality-factors GET] Found ${result.rows.length} seasonality factors.`);
        res.json(result.rows);
    } catch (error) {
        console.error("[v4.45 /api/admin/seasonality-factors GET] Error fetching seasonality factors:", error);
        res.status(500).json({ error: "Failed to fetch seasonality factors.", details: error.message });
    } finally {
        client.release();
        console.log("[v4.45 /api/admin/seasonality-factors GET] Client released.");
    }
}));

// --- Глобальный обработчик ошибок ---
app.use((err, req, res, next) => {
  console.error("[v4.45 Global Error Handler] An unexpected error occurred:", err);
  res.status(500).json({ error: 'An unexpected server error occurred.', details: err.message });
});

// --- Запуск сервера после инициализации ---
async function startServer() {
    try {
        await initializeSystem(); // Выполняем всю инициализацию, включая автомиграцию
        app.listen(PORT, () => {
            console.log(`[v4.45 Auto-Migration] Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error("[v4.45 Auto-Migration] Failed to initialize system or start server:", error);
        process.exit(1); // Завершаем процесс, если инициализация не удалась
    }
}

startServer();

