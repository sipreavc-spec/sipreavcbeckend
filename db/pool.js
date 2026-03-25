// db/pool.js — Pool de conexão PostgreSQL (Aiven)
// NOTA: dotenv já foi carregado em api/index.js antes deste módulo ser importado
const { Pool } = require("pg");

// Validar variáveis obrigatórias
const required = ["DB_HOST","DB_PORT","DB_USER","DB_PASSWORD","DB_NAME"];
const missing  = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("❌ Variáveis de ambiente em falta:", missing.join(", "));
  console.error("   Verifique o ficheiro .env");
  process.exit(1);
}

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT, 10),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:      { rejectUnauthorized: false },
  max:                10,
  idleTimeoutMillis:  30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("❌ Erro no pool PostgreSQL:", err.message);
});

// Helper query — para usar nos routes: const { query } = require("../../db/pool")
const query     = (text, params) => pool.query(text, params);
const getClient = ()             => pool.connect();

// Exportar o pool e helpers separadamente para evitar sobrescrever pool.query
module.exports = {
  pool,
  query,
  getClient,
};
