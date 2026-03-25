// middleware/auth.js
const jwt   = require("jsonwebtoken");
const { query } = require("../db/pool");

const JWT_SECRET = process.env.JWT_SECRET || "sipre_dev_secret";

exports.signToken = (userId) =>
  jwt.sign({ id: userId }, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

// ── Verificar JWT ─────────────────────────────────────────────
exports.protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      return res.status(401).json({ error: "Token não fornecido" });

    const token   = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const { rows } = await query(
      `SELECT id, name, email, role, crm, specialty, phone, is_active
       FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (!rows[0]?.is_active)
      return res.status(401).json({ error: "Utilizador não autorizado" });

    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
};

// ── Apenas médico ─────────────────────────────────────────────
exports.doctorOnly = (req, res, next) => {
  if (req.user?.role !== "doctor")
    return res.status(403).json({ error: "Acesso restrito a médicos" });
  next();
};

// ── Autenticar ESP32 via x-device-token ──────────────────────
exports.deviceAuth = async (req, res, next) => {
  try {
    const token = req.headers["x-device-token"] || req.body?.deviceToken;
    if (!token)
      return res.status(401).json({ error: "Token do dispositivo em falta" });

    const { rows } = await query(
      `SELECT d.*, p.id AS p_id, p.name AS p_name,
              p.bpm_max, p.bpm_min, p.spo2_min, p.temp_max, p.temp_min
       FROM devices d
       LEFT JOIN patients p ON d.patient_id = p.id
       WHERE d.device_token = $1 AND d.is_active = TRUE`,
      [token]
    );

    if (!rows[0])
      return res.status(401).json({ error: "Dispositivo não reconhecido" });

    // Actualizar last_seen
    await query(
      `UPDATE devices SET last_seen=$1, ip_address=$2, is_online=TRUE
       WHERE device_token=$3`,
      [new Date(), req.ip || "unknown", token]
    );

    const row = rows[0];
    req.device  = row;
    req.patient = row.p_id ? {
      id: row.p_id, name: row.p_name,
      bpm_max: row.bpm_max, bpm_min: row.bpm_min,
      spo2_min: row.spo2_min, temp_max: row.temp_max, temp_min: row.temp_min,
    } : null;

    next();
  } catch (err) {
    return res.status(500).json({ error: "Erro ao autenticar dispositivo" });
  }
};
