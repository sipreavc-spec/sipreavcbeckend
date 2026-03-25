// api/routes/vitals.js
const router = require("express").Router();
const { query } = require("../../db/pool");
const { protect, deviceAuth } = require("../../middleware/auth");
const { checkAndAlert }       = require("../../middleware/alertEngine");

// ── ESP32 → POST /api/vitals/reading ─────────────────────────
router.post("/reading", deviceAuth, async (req, res) => {
  try {
    const io      = req.app.get("io");
    const patient = req.patient;

    if (!patient)
      return res.status(404).json({ error: "Paciente não associado ao dispositivo" });

    const {
      bpm, spo2,
      ir_value    = 0,
      red_value   = 0,
      beat_detected = false,
      temp_object,
      temp_ambient  = 0,
    } = req.body;

    if (bpm === undefined || spo2 === undefined || temp_object === undefined)
      return res.status(400).json({ error: "bpm, spo2, temp_object obrigatórios" });

    // Calcular status
    let status = "normal";
    if (bpm > patient.bpm_max || bpm < patient.bpm_min ||
        spo2 < patient.spo2_min ||
        temp_object > patient.temp_max || temp_object < patient.temp_min) {
      status = (bpm > patient.bpm_max + 20 || spo2 < 85 || temp_object > 39)
        ? "critical" : "warning";
    }

    // Qualidade do sinal
    const ir = Number(ir_value);
    const signalQuality =
      ir < 50000  ? "invalid"   :
      ir < 100000 ? "poor"      :
      ir > 250000 ? "excellent" : "good";

    // Guardar leitura
    const { rows } = await query(
      `INSERT INTO vitals
         (patient_id, device_id, bpm, spo2, ir_value, red_value, beat_detected,
          temp_object, temp_ambient, signal_quality, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [patient.id, req.device.device_id,
       bpm, spo2, ir, Number(red_value), Boolean(beat_detected),
       temp_object, temp_ambient, signalQuality, status]
    );
    const vitals = rows[0];

    // Actualizar cache no paciente
    await query(
      `UPDATE patients
       SET last_bpm=$1, last_spo2=$2, last_temp=$3,
           last_status=$4, last_updated_at=NOW()
       WHERE id=$5`,
      [bpm, spo2, temp_object, status, patient.id]
    );

    // Emitir em tempo real (Socket.IO)
    if (io) {
      io.to(`patient_${patient.id}`).emit("vitals_update", {
        patientId: patient.id,
        vitals: { bpm, spo2, temp: temp_object, status, signalQuality,
                  readingAt: vitals.reading_at },
      });
    }

    // Motor de alertas
    const alerts = await checkAndAlert(vitals, patient, io);

    res.status(201).json({
      success: true, vitalsId: vitals.id, status, alerts: alerts.length,
    });
  } catch (err) {
    console.error("Erro ao guardar leitura:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vitals/:patientId — histórico
router.get("/:patientId", protect, async (req, res) => {
  try {
    const { limit = 50, skip = 0, from, to } = req.query;
    const params = [req.params.patientId];
    let where = "WHERE patient_id=$1";
    if (from) { params.push(new Date(from)); where += ` AND reading_at >= $${params.length}`; }
    if (to)   { params.push(new Date(to));   where += ` AND reading_at <= $${params.length}`; }

    params.push(Number(limit));
    params.push(Number(skip));

    const { rows: vitals } = await query(
      `SELECT id, bpm, spo2, temp_object, temp_ambient, status,
              signal_quality, reading_at, device_id
       FROM vitals ${where}
       ORDER BY reading_at DESC
       LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, params.length - 2);
    const { rows: [cnt] } = await query(
      `SELECT COUNT(*)::int AS total FROM vitals ${where}`,
      countParams
    );

    res.json({ vitals, total: cnt.total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/vitals/:patientId/latest
router.get("/:patientId/latest", protect, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, bpm, spo2, temp_object, status, signal_quality, reading_at
       FROM vitals WHERE patient_id=$1
       ORDER BY reading_at DESC LIMIT 1`,
      [req.params.patientId]
    );
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/vitals/:patientId/stats?period=day|week|month
router.get("/:patientId/stats", protect, async (req, res) => {
  try {
    const { period = "day" } = req.query;
    const from = new Date();
    if      (period === "week")  from.setDate(from.getDate() - 7);
    else if (period === "month") from.setDate(from.getDate() - 30);
    else from.setHours(0, 0, 0, 0);

    const { rows } = await query(
      `SELECT
         ROUND(AVG(bpm)::numeric,1)         AS avg_bpm,
         ROUND(MAX(bpm)::numeric,1)         AS max_bpm,
         ROUND(MIN(bpm)::numeric,1)         AS min_bpm,
         ROUND(AVG(spo2)::numeric,1)        AS avg_spo2,
         ROUND(MIN(spo2)::numeric,1)        AS min_spo2,
         ROUND(AVG(temp_object)::numeric,1) AS avg_temp,
         ROUND(MAX(temp_object)::numeric,1) AS max_temp,
         COUNT(*)::int                      AS total_readings,
         COUNT(*) FILTER (WHERE status='critical')::int AS critical_count,
         COUNT(*) FILTER (WHERE status='warning')::int  AS warning_count
       FROM vitals
       WHERE patient_id=$1 AND reading_at >= $2 AND bpm > 0`,
      [req.params.patientId, from]
    );
    res.json({ ...rows[0], period });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
