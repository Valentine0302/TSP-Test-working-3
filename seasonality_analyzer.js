// Модуль для анализа сезонности и работы с историческими данными фрахтовых ставок
// Версия с исправленными экспортами и переименованной функцией

// Импорт необходимых модулей ES Module
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Загрузка переменных окружения
dotenv.config();

// Настройка пула подключений к БД
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    // sslmode: 'require' // Раскомментируйте, если ваша БД требует SSL
  }
});

// Функция инициализации таблиц для сезонности
async function initializeSeasonalityTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Создание таблицы historical_rates
    await client.query(`
      CREATE TABLE IF NOT EXISTS historical_rates (
        id SERIAL PRIMARY KEY,
        origin_port VARCHAR(10) NOT NULL,
        destination_port VARCHAR(10) NOT NULL,
        origin_region VARCHAR(50),
        destination_region VARCHAR(50),
        container_type VARCHAR(10) NOT NULL,
        rate NUMERIC NOT NULL,
        date DATE NOT NULL,
        source VARCHAR(50),
        UNIQUE(origin_port, destination_port, container_type, date, source)
      )
    `);
    // Создание таблицы seasonality_factors
    await client.query(`
      CREATE TABLE IF NOT EXISTS seasonality_factors (
        id SERIAL PRIMARY KEY,
        origin_region VARCHAR(50) NOT NULL,
        destination_region VARCHAR(50) NOT NULL,
        month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        seasonality_factor NUMERIC NOT NULL,
        confidence NUMERIC NOT NULL,
        last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(origin_region, destination_region, month)
      )
    `);
    await client.query('COMMIT');
    console.log('Seasonality tables initialized successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error initializing seasonality tables:', error);
    console.log('Continuing initialization despite error in table creation');
  } finally {
    client.release();
  }
}

// Функция импорта исторических данных (включая импорт из calculation_history)
async function importHistoricalRates() {
  try {
    console.log('Importing historical rates data...');
    const countQuery = 'SELECT COUNT(*) FROM historical_rates';
    const countResult = await pool.query(countQuery);
    if (parseInt(countResult.rows[0].count) > 0) {
      console.log('Historical rates data already exists, skipping import.');
    }
    await importHistoricalDataFromCalculationHistory();
    const checkQuery = 'SELECT COUNT(*) FROM historical_rates';
    const checkResult = await pool.query(checkQuery);
    if (parseInt(checkResult.rows[0].count) < 100) { // Условие для генерации
      console.log('Not enough historical data, generating synthetic data...');
      // await generateSyntheticHistoricalData(); // Закомментировано для тестирования
    }
  } catch (error) {
    console.error('Error importing historical rates:', error);
    console.log('Continuing initialization despite error in historical rates import');
  }
}

// Вспомогательная функция импорта из calculation_history
async function importHistoricalDataFromCalculationHistory() {
  const client = await pool.connect();
  try {
    console.log('Importing historical data from calculation_history');
    const tableCheckQuery = `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'calculation_history')`;
    const tableExists = await client.query(tableCheckQuery);
    if (!tableExists.rows[0].exists) {
      console.log('Table calculation_history does not exist, skipping import');
      return;
    }

    const columnsCheckQuery = `SELECT column_name FROM information_schema.columns WHERE table_name = 'calculation_history'`;
    const columnsResult = await client.query(columnsCheckQuery);
    const columns = columnsResult.rows.map(row => row.column_name);
    const hasOriginPort = columns.includes('origin_port');
    const hasDestinationPort = columns.includes('destination_port');
    const hasOriginPortId = columns.includes('origin_port_id');
    const hasDestinationPortId = columns.includes('destination_port_id');
    const hasContainerType = columns.includes('container_type');
    const hasRate = columns.includes('rate');
    const hasCreatedAt = columns.includes('created_at');
    const hasSources = columns.includes('sources');

    if ((!hasOriginPort && !hasOriginPortId) || (!hasDestinationPort && !hasDestinationPortId) || !hasContainerType || !hasRate || !hasCreatedAt) {
      console.log('Table calculation_history does not have required columns, skipping import');
      return;
    }

    await client.query('BEGIN');
    const originField = hasOriginPortId ? 'origin_port_id' : 'origin_port';
    const destinationField = hasDestinationPortId ? 'destination_port_id' : 'destination_port';
    const sourcesField = hasSources ? 'sources' : 'NULL::jsonb';
    const historyQuery = `
      SELECT
        ${originField} as origin_port,
        ${destinationField} as destination_port,
        container_type,
        rate,
        created_at,
        ${sourcesField} as sources
      FROM calculation_history
      WHERE rate IS NOT NULL AND rate > 0 AND container_type IS NOT NULL AND created_at IS NOT NULL
      ORDER BY created_at
    `;
    const historyResult = await client.query(historyQuery);
    const portsQuery = 'SELECT id, region FROM ports';
    const portsResult = await client.query(portsQuery);
    const portRegions = {};
    for (const port of portsResult.rows) {
      portRegions[port.id] = port.region;
    }
    let importedCount = 0;
    for (const record of historyResult.rows) {
      const originRegion = portRegions[record.origin_port] || 'Unknown';
      const destinationRegion = portRegions[record.destination_port] || 'Unknown';
      const date = new Date(record.created_at).toISOString().split('T')[0];
      let source = 'unknown';
      try {
          if (record.sources) {
              const parsedSources = typeof record.sources === 'string' ? JSON.parse(record.sources) : record.sources;
              if (Array.isArray(parsedSources) && parsedSources.length > 0) {
                  source = parsedSources[0];
              } else if (typeof parsedSources === 'string') {
                  source = parsedSources;
              }
          }
      } catch (parseError) {
          console.warn(`Failed to parse sources for record: ${parseError.message}`);
      }
      try {
          const insertResult = await client.query(
            `INSERT INTO historical_rates
             (origin_port, destination_port, origin_region, destination_region, container_type, rate, date, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (origin_port, destination_port, container_type, date, source)
             DO NOTHING`,
            [
              record.origin_port, record.destination_port, originRegion, destinationRegion,
              record.container_type, record.rate, date, source
            ]
          );
          if (insertResult.rowCount > 0) importedCount++;
      } catch (insertError) {
          console.error(`Failed to insert record: ${insertError.message}`, record);
      }
    }
    await client.query('COMMIT');
    console.log(`Imported ${importedCount} new historical rates from calculation_history`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error importing historical rates from calculation_history:', error);
    console.log('Continuing initialization despite error in historical data import');
  } finally {
    client.release();
  }
}

// Функция генерации синтетических данных (ограниченная для тестов)
async function generateSyntheticHistoricalData() {
  const client = await pool.connect();
  try {
    console.log('Generating synthetic historical data...');
    await client.query('BEGIN');
    const portsQuery = 'SELECT id, name, region FROM ports';
    const portsResult = await client.query(portsQuery);
    if (portsResult.rows.length === 0) {
      console.log('No ports found, cannot generate synthetic data');
      await client.query('ROLLBACK'); return;
    }
    const containerTypesQuery = 'SELECT name FROM container_types';
    const containerTypesResult = await client.query(containerTypesQuery);
    if (containerTypesResult.rows.length === 0) {
      console.log('No container types found, cannot generate synthetic data');
      await client.query('ROLLBACK'); return;
    }
    const ports = portsResult.rows;
    const containerTypes = containerTypesResult.rows.map(row => row.name);
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setFullYear(endDate.getFullYear() - 3);
    const syntheticData = [];
    // Ограничение генерации для тестов
    for (let i = 0; i < Math.min(ports.length, 1); i++) {
      for (let j = 0; j < Math.min(ports.length, 1); j++) {
        if (i === j) continue;
        const originPort = ports[i];
        const destinationPort = ports[j];
        for (const containerType of containerTypes) {
          const baseRate = 500 + Math.random() * 1500 + (originPort.region === destinationPort.region ? 0 : 500);
          let currentDate = new Date(startDate);
          while (currentDate <= endDate) {
            const month = currentDate.getMonth() + 1;
            const seasonalFactor = getSeasonalFactorForMonth(month);
            const yearsSinceStart = (currentDate.getTime() - startDate.getTime()) / (365 * 24 * 60 * 60 * 1000);
            const trendFactor = 1 + yearsSinceStart * 0.1;
            const randomFactor = 0.9 + Math.random() * 0.2;
            const rate = Math.max(100, Math.round(baseRate * seasonalFactor * trendFactor * randomFactor));
            const date = currentDate.toISOString().split('T')[0];
            syntheticData.push({
              origin_port: originPort.id, destination_port: destinationPort.id,
              origin_region: originPort.region || 'Unknown', destination_region: destinationPort.region || 'Unknown',
              container_type: containerType, rate, date, source: 'synthetic'
            });
            currentDate.setMonth(currentDate.getMonth() + 1);
          }
        }
      }
    }
    const maxRecords = 500; // Уменьшено для скорости ТЕСТИРОВАНИЯ
    if (syntheticData.length > maxRecords) {
      syntheticData.sort(() => Math.random() - 0.5);
      syntheticData.length = maxRecords;
    }
    let insertedCount = 0;
    for (const data of syntheticData) {
      try {
          const insertResult = await client.query(
            `INSERT INTO historical_rates
             (origin_port, destination_port, origin_region, destination_region, container_type, rate, date, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (origin_port, destination_port, container_type, date, source)
             DO NOTHING`,
            [
              data.origin_port, data.destination_port, data.origin_region, data.destination_region,
              data.container_type, data.rate, data.date, data.source
            ]
          );
          if (insertResult.rowCount > 0) insertedCount++;
      } catch (insertError) {
          console.error(`Failed to insert synthetic record: ${insertError.message}`, data);
      }
    }
    await client.query('COMMIT');
    console.log(`Generated and saved ${insertedCount} new synthetic historical rates`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error generating synthetic historical data:', error);
    console.log('Continuing initialization despite error in synthetic data generation');
  } finally {
    client.release();
  }
}

// Вспомогательная функция для получения сезонного фактора (пример)
function getSeasonalFactorForMonth(month) {
  const seasonalFactors = {
    1: 1.05, 2: 1.00, 3: 0.95, 4: 0.90, 5: 0.95, 6: 1.00,
    7: 1.05, 8: 1.10, 9: 1.15, 10: 1.10, 11: 1.05, 12: 1.00
  };
  return seasonalFactors[month] || 1.0;
}

// Функция анализа сезонности
async function analyzeSeasonality() {
  const client = await pool.connect();
  try {
    console.log('Analyzing seasonality patterns...');
    const regionsQuery = `
      SELECT DISTINCT origin_region, destination_region
      FROM historical_rates
      WHERE origin_region IS NOT NULL AND origin_region <> 'Unknown'
        AND destination_region IS NOT NULL AND destination_region <> 'Unknown'
    `;
    const regionsResult = await client.query(regionsQuery);
    if (regionsResult.rows.length === 0) {
      console.log('No valid region pairs found for seasonality analysis.');
      return;
    }
    await client.query('BEGIN');
    let factorsUpdated = 0;
    for (const regionPair of regionsResult.rows) {
      const originRegion = regionPair.origin_region;
      const destinationRegion = regionPair.destination_region;
      try {
        const avgRateQuery = `SELECT AVG(rate) as overall_avg FROM historical_rates WHERE origin_region = $1 AND destination_region = $2`;
        const avgRateResult = await client.query(avgRateQuery, [originRegion, destinationRegion]);
        const overallAvgRate = parseFloat(avgRateResult.rows[0]?.overall_avg);
        if (isNaN(overallAvgRate) || overallAvgRate <= 0) {
            console.log(`Skipping ${originRegion} -> ${destinationRegion}: Invalid overall average rate (${overallAvgRate}).`);
            continue;
        }
        for (let month = 1; month <= 12; month++) {
          try {
            const monthAvgQuery = `
              SELECT AVG(rate) as monthly_avg, COUNT(*) as data_points
              FROM historical_rates
              WHERE origin_region = $1 AND destination_region = $2 AND EXTRACT(MONTH FROM date) = $3
            `;
            const monthAvgResult = await client.query(monthAvgQuery, [originRegion, destinationRegion, month]);
            const monthlyAvgRate = parseFloat(monthAvgResult.rows[0]?.monthly_avg);
            const dataPoints = parseInt(monthAvgResult.rows[0]?.data_points);
            let seasonalityFactor = 1.0;
            let confidence = 0;
            if (!isNaN(monthlyAvgRate) && monthlyAvgRate > 0 && dataPoints > 2) {
              seasonalityFactor = monthlyAvgRate / overallAvgRate;
              confidence = Math.min(1, dataPoints / 10.0);
            }
            const upsertQuery = `
              INSERT INTO seasonality_factors (origin_region, destination_region, month, seasonality_factor, confidence, last_updated)
              VALUES ($1, $2, $3, $4, $5, NOW())
              ON CONFLICT (origin_region, destination_region, month) DO UPDATE SET
                seasonality_factor = EXCLUDED.seasonality_factor,
                confidence = EXCLUDED.confidence,
                last_updated = NOW()
            `;
            const upsertResult = await client.query(upsertQuery, [originRegion, destinationRegion, month, seasonalityFactor, confidence]);
            if (upsertResult.rowCount > 0) factorsUpdated++;
          } catch (monthError) {
            console.error(`Error analyzing month ${month} for ${originRegion} -> ${destinationRegion}:`, monthError);
          }
        }
      } catch (pairError) {
        console.error(`Error analyzing region pair ${originRegion} -> ${destinationRegion}:`, pairError);
      }
    }
    await client.query('COMMIT');
    console.log(`Seasonality analysis completed. Updated/inserted ${factorsUpdated} factors.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error analyzing seasonality:', error);
  } finally {
    client.release();
  }
}

// Функция получения фактора сезонности (переименована)
async function fetchSeasonalityFactor(originRegion, destinationRegion, month) {
  try {
    const query = `SELECT seasonality_factor, confidence FROM seasonality_factors WHERE origin_region = $1 AND destination_region = $2 AND month = $3`;
    const result = await pool.query(query, [originRegion, destinationRegion, month]);
    if (result.rows.length > 0) {
      return { factor: parseFloat(result.rows[0].seasonality_factor), confidence: parseFloat(result.rows[0].confidence) };
    } else {
      // Fallback 1: Average for origin region
      const originAvgQuery = `SELECT AVG(seasonality_factor) as avg_factor, AVG(confidence) as avg_confidence FROM seasonality_factors WHERE origin_region = $1 AND month = $2`;
      const originAvgResult = await pool.query(originAvgQuery, [originRegion, month]);
      if (originAvgResult.rows.length > 0 && originAvgResult.rows[0].avg_factor !== null) {
          console.log(`Seasonality fallback: Using average for origin region ${originRegion}, month ${month}`);
          return { factor: parseFloat(originAvgResult.rows[0].avg_factor), confidence: parseFloat(originAvgResult.rows[0].avg_confidence) * 0.5 };
      }
      // Fallback 2: Global average for month
      const globalAvgQuery = `SELECT AVG(seasonality_factor) as avg_factor, AVG(confidence) as avg_confidence FROM seasonality_factors WHERE month = $1`;
      const globalAvgResult = await pool.query(globalAvgQuery, [month]);
      if (globalAvgResult.rows.length > 0 && globalAvgResult.rows[0].avg_factor !== null) {
          console.log(`Seasonality fallback: Using global average for month ${month}`);
          return { factor: parseFloat(globalAvgResult.rows[0].avg_factor), confidence: parseFloat(globalAvgResult.rows[0].avg_confidence) * 0.2 };
      }
      // Final fallback
      console.log(`Seasonality fallback: No data found for ${originRegion} -> ${destinationRegion}, month ${month}. Using default 1.0.`);
      return { factor: 1.0, confidence: 0 };
    }
  } catch (error) {
    console.error('Error getting seasonality factor:', error);
    return { factor: 1.0, confidence: 0 }; // Default on error
  }
}

// Основная функция инициализации и обновления данных сезонности
// Определена только ОДИН раз
async function initializeAndUpdateSeasonalityData(forceUpdate = false) {
  try {
    console.log('Initializing and updating seasonality data...');
    await initializeSeasonalityTables();
    await importHistoricalRates();
    let shouldAnalyze = forceUpdate;
    if (!forceUpdate) {
        const checkQuery = 'SELECT MAX(last_updated) as last_update FROM seasonality_factors';
        const checkResult = await pool.query(checkQuery);
        const lastUpdate = checkResult.rows[0]?.last_update;
        if (!lastUpdate) {
            shouldAnalyze = true;
        } else {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (new Date(lastUpdate) < oneDayAgo) {
                shouldAnalyze = true;
            }
        }
    }
    if (shouldAnalyze) {
        await analyzeSeasonality();
    } else {
        console.log('Seasonality factors are up-to-date. Skipping analysis.');
    }
    console.log('Seasonality data initialization and update completed');
  } catch (error) {
    console.error('Error during seasonality data initialization/update:', error);
  }
}

// Тестовый блок (закомментирован)
/*
async function test() {
  await initializeAndUpdateSeasonalityData(true);
  const factor = await fetchSeasonalityFactor('Asia', 'Europe', 9); // Используем переименованную функцию
  console.log('Test Result:', factor);
}
test();
*/

// Финальный, чистый экспортный блок
// Экспортируем только ОДИН раз
export {
  initializeSeasonalityTables,
  initializeAndUpdateSeasonalityData, // Экспортируется здесь
  fetchSeasonalityFactor
};

