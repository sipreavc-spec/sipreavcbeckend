// api/index.js — SIPRE-AVC Backend v3
// Node.js + Express + pg (PostgreSQL Aiven) — Vercel Ready
require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const morgan     = require("morgan");
const http       = require("http");
const { Server } = require("socket.io");
const rateLimit  = require("express-rate-limit");

const { pool } = require("../db/pool");
const initDB = require("../db/initdb");

const app    = express();

// Socket.IO setup only for non-Vercel environments
let server, io;
if (!process.env.VERCEL) {
  server = http.createServer(app);
  io = new Server(server, {
    cors: { origin: process.env.FRONTEND_URL || "*", methods: ["GET","POST"] },
    transports: ["websocket","polling"],
  });
  app.set("io", io);
  io.on("connection", (socket) => {
    socket.on("join_patient",  (id) => socket.join(`patient_${id}`));
    socket.on("leave_patient", (id) => socket.leave(`patient_${id}`));
  });
}

// ── Middleware ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin:  process.env.FRONTEND_URL || "*",
  methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","x-device-token"],
  credentials: true,
}));
app.use(express.json({ limit: "512kb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "tiny" : "dev"));

// Rate limiting
app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Demasiados pedidos — aguarde" },
}));
app.use("/api/auth/", rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  message: { error: "Demasiadas tentativas de autenticação" },
}));

// ── Rotas ─────────────────────────────────────────────────────
app.use("/api/auth",     require("./routes/auth"));
app.use("/api/vitals",   require("./routes/vitals"));
app.use("/api/patients", require("./routes/patients"));
app.use("/api/alerts",   require("./routes/alerts"));
app.use("/api/devices",  require("./routes/devices"));
app.use("/api/reports",  require("./routes/reports"));

// ── Health check ──────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT NOW() AS now,
              current_database() AS db,
              COUNT(*)::int AS tables
       FROM information_schema.tables
       WHERE table_schema = 'public'`
    );
    res.json({
      status:    "ok",
      database:  "connected",
      db:        rows[0].db,
      tables:    rows[0].tables,
      uptime:    Math.round(process.uptime()),
      env:       process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: "error", database: "disconnected", error: err.message });
  }
});

app.get("/", (_req, res) =>
  res.json({ name: "SIPRE-AVC API", version: "3.0.0", status: "running" })
);

// 404
app.use((_req, res) => res.status(404).json({ error: "Rota não encontrada" }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

// ════════════════════════════════════════════════════════════════
//  BOOTSTRAP — conectar + criar tabelas + iniciar servidor
// ════════════════════════════════════════════════════════════════
async function bootstrap() {
  try {
    // 1. Testar ligação ao PostgreSQL Aiven
    const { rows: [{ now }] } = await pool.query("SELECT NOW() AS now");
    console.log(`✅ PostgreSQL conectado — ${now}`);

    // 2. Criar tabelas se a BD estiver vazia (db/initdb.js)
    await initDB();

    // 3. Iniciar servidor HTTP
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`\n🚀 SIPRE-AVC API iniciada`);
      console.log(`   URL:       http://localhost:${PORT}`);
      console.log(`   Ambiente:  ${process.env.NODE_ENV || "development"}`);
      console.log(`   DB host:   ${process.env.DB_HOST}:${process.env.DB_PORT}`);
      console.log(`   Health:    http://localhost:${PORT}/api/health\n`);
    });
  } catch (err) {
    console.error("❌ Falha ao iniciar servidor:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Em Vercel: initDB lazy (na primeira request)
let dbReady = false;
if (process.env.VERCEL) {
  app.use(async (_req, _res, next) => {
    if (!dbReady) {
      try { await initDB(); dbReady = true; }
      catch (e) { console.error("initDB error:", e.message); }
    }
    next();
  });
} else {
  bootstrap();
}

module.exports = app;
