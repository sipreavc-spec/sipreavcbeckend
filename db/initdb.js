require("dotenv").config();
// db/initdb.js
// db/initdb.js
// Cria todas as tabelas da base de dados se ainda não existirem.
// Chamado automaticamente no arranque do servidor (api/index.js).
// Também pode ser executado manualmente: npm run db:init

const { pool } = require("./pool");

// ═══════════════════════════════════════════════════════════════
//  SCHEMA COMPLETO — todas as tabelas do projecto SIPRE-AVC
// ═══════════════════════════════════════════════════════════════
const SCHEMA = `

-- Extensão para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ENUMS ──────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE user_role      AS ENUM ('doctor','patient','family');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE gender_type    AS ENUM ('M','F','outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE vital_status   AS ENUM ('normal','warning','critical','offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE alert_type     AS ENUM (
  'bpm_high','bpm_low','spo2_low','temp_high','temp_low','device_offline','multiple');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE alert_severity AS ENUM ('warning','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE signal_quality AS ENUM ('excellent','good','poor','invalid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── FUNÇÃO updated_at ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $fn$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$fn$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════
--  TABELA: users  (médicos, pacientes, familiares)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name        TEXT        NOT NULL,
  email       TEXT        NOT NULL UNIQUE,
  password    TEXT        NOT NULL,
  role        user_role   NOT NULL DEFAULT 'patient',
  phone       TEXT,
  crm         TEXT,
  specialty   TEXT,
  avatar      TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ════════════════════════════════════════════════════════════════
--  TABELA: patients  (dados clínicos + cache da última leitura)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS patients (
  id              TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name            TEXT         NOT NULL,
  age             INTEGER      NOT NULL,
  gender          gender_type  NOT NULL DEFAULT 'M',
  phone           TEXT,
  address         TEXT,

  -- Historial clínico
  diagnosis       TEXT         NOT NULL DEFAULT 'AVC Isquémico',
  stroke_date     DATE,
  medications     TEXT[]       NOT NULL DEFAULT '{}',
  notes           TEXT,

  -- Limites de alerta personalizados
  bpm_max         NUMERIC(5,1) NOT NULL DEFAULT 100,
  bpm_min         NUMERIC(5,1) NOT NULL DEFAULT 50,
  spo2_min        NUMERIC(5,1) NOT NULL DEFAULT 90,
  temp_max        NUMERIC(5,1) NOT NULL DEFAULT 38.0,
  temp_min        NUMERIC(5,1) NOT NULL DEFAULT 35.0,

  -- Cache da última leitura ESP32 (actualizada em tempo real)
  last_bpm        NUMERIC(5,1),
  last_spo2       NUMERIC(5,1),
  last_temp       NUMERIC(5,1),
  last_status     vital_status NOT NULL DEFAULT 'offline',
  last_updated_at TIMESTAMPTZ,

  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  doctor_id   TEXT         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patients_doctor ON patients(doctor_id);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(last_status);
CREATE INDEX IF NOT EXISTS idx_patients_active ON patients(is_active);

DO $$ BEGIN
  CREATE TRIGGER trg_patients_updated
    BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ════════════════════════════════════════════════════════════════
--  TABELA: patient_family  (relação paciente ↔ familiar — N:N)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS patient_family (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  patient_id  TEXT        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(patient_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pf_patient ON patient_family(patient_id);
CREATE INDEX IF NOT EXISTS idx_pf_user    ON patient_family(user_id);

-- ════════════════════════════════════════════════════════════════
--  TABELA: devices  (dispositivos ESP32 — 1 por paciente)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS devices (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  device_id        TEXT        NOT NULL UNIQUE,   -- ex: "ESP32-001"
  device_token     TEXT        NOT NULL UNIQUE,   -- token secreto autenticação
  label            TEXT,
  mac_address      TEXT,
  firmware_version TEXT        NOT NULL DEFAULT '1.0.0',
  reading_interval INTEGER     NOT NULL DEFAULT 30,

  is_online    BOOLEAN     NOT NULL DEFAULT FALSE,
  last_seen    TIMESTAMPTZ,
  ip_address   TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,

  patient_id   TEXT        UNIQUE REFERENCES patients(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devices_device_id    ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_token ON devices(device_token);
CREATE INDEX IF NOT EXISTS idx_devices_patient      ON devices(patient_id);

DO $$ BEGIN
  CREATE TRIGGER trg_devices_updated
    BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ════════════════════════════════════════════════════════════════
--  TABELA: vitals  (leituras dos sensores — série temporal)
--  MAX30102 → bpm, spo2  |  GY-906/MLX90614 → temp_object, temp_ambient
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS vitals (
  id             TEXT           PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  patient_id     TEXT           NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  device_id      TEXT           NOT NULL,

  -- MAX30102
  bpm            NUMERIC(5,1)   NOT NULL,
  spo2           NUMERIC(5,1)   NOT NULL,
  ir_value       BIGINT         NOT NULL DEFAULT 0,
  red_value      BIGINT         NOT NULL DEFAULT 0,
  beat_detected  BOOLEAN        NOT NULL DEFAULT FALSE,

  -- GY-906 / MLX90614
  temp_object    NUMERIC(5,1)   NOT NULL,
  temp_ambient   NUMERIC(5,1)   NOT NULL DEFAULT 0,

  signal_quality signal_quality NOT NULL DEFAULT 'good',
  status         vital_status   NOT NULL DEFAULT 'normal',

  reading_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vitals_patient_date ON vitals(patient_id, reading_at DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_device       ON vitals(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_status       ON vitals(status);

-- ════════════════════════════════════════════════════════════════
--  TABELA: alerts  (alertas gerados quando valores saem dos limites)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT           PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  patient_id  TEXT           NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  vitals_id   TEXT           REFERENCES vitals(id) ON DELETE SET NULL,

  type        alert_type     NOT NULL,
  severity    alert_severity NOT NULL DEFAULT 'warning',
  message     TEXT           NOT NULL,

  -- Valores que causaram o alerta
  bpm_value   NUMERIC(5,1),
  spo2_value  NUMERIC(5,1),
  temp_value  NUMERIC(5,1),

  -- Limites violados no momento (snapshot)
  threshold_bpm_max  NUMERIC(5,1),
  threshold_bpm_min  NUMERIC(5,1),
  threshold_spo2_min NUMERIC(5,1),
  threshold_temp_max NUMERIC(5,1),
  threshold_temp_min NUMERIC(5,1),

  acknowledged     BOOLEAN     NOT NULL DEFAULT FALSE,
  acknowledged_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at  TIMESTAMPTZ,
  sms_sent         BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_patient      ON alerts(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_severity     ON alerts(severity);

DO $$ BEGIN
  CREATE TRIGGER trg_alerts_updated
    BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

`;

// ═══════════════════════════════════════════════════════════════
//  initDB() — ponto de entrada
//  Verifica se as tabelas existem e cria se necessário
// ═══════════════════════════════════════════════════════════════
async function initDB() {
  const client = await pool.connect();
  try {
    console.log("🗄  A verificar schema da base de dados...");

    // Contar quantas das 6 tabelas principais existem
    const { rows } = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'users','patients','patient_family',
          'devices','vitals','alerts'
        )
    `);

    const found = rows[0].total;

    if (found >= 6) {
      console.log(`✅ Base de dados já inicializada (${found}/6 tabelas presentes)`);
      return;
    }

    // BD vazia ou incompleta — criar todas as tabelas
    console.log(`⚙  ${found}/6 tabelas encontradas — a criar schema completo...`);

    await client.query("BEGIN");
    await client.query(SCHEMA);
    await client.query("COMMIT");

    // Confirmar
    const { rows: created } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'users','patients','patient_family',
          'devices','vitals','alerts'
        )
      ORDER BY table_name
    `);

    console.log(`✅ Schema criado! Tabelas: ${created.map(r => r.table_name).join(", ")}`);

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Erro ao inicializar schema:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = initDB;
