// api/routes/reports.js
const router = require("express").Router();
const { query } = require("../../db/pool");
const { protect } = require("../../middleware/auth");

router.get("/:patientId", protect, async (req, res) => {
  try {
    const { period = "week" } = req.query;
    const pid  = req.params.patientId;
    const from = new Date();
    if      (period === "day")   from.setHours(0, 0, 0, 0);
    else if (period === "week")  from.setDate(from.getDate() - 7);
    else if (period === "month") from.setDate(from.getDate() - 30);

    const [patRes, statsRes, timelineRes, alertRes] = await Promise.all([
      query(
        `SELECT p.id,p.name,p.age,p.diagnosis,
                p.bpm_max,p.bpm_min,p.spo2_min,p.temp_max,p.temp_min,
                p.last_bpm,p.last_spo2,p.last_temp,p.last_status
         FROM patients p WHERE p.id=$1`,
        [pid]
      ),
      query(
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
         FROM vitals WHERE patient_id=$1 AND reading_at>=$2 AND bpm>0`,
        [pid, from]
      ),
      query(
        `SELECT bpm, spo2, temp_object, status, reading_at
         FROM vitals WHERE patient_id=$1 AND reading_at>=$2 AND bpm>0
         ORDER BY reading_at ASC LIMIT 288`,
        [pid, from]
      ),
      query(
        `SELECT type, severity, COUNT(*)::int AS count
         FROM alerts WHERE patient_id=$1 AND created_at>=$2
         GROUP BY type, severity ORDER BY count DESC`,
        [pid, from]
      ),
    ]);

    if (!patRes.rows[0])
      return res.status(404).json({ error: "Paciente não encontrado" });

    res.json({
      patient:    patRes.rows[0],
      period,
      from:       from.toISOString(),
      to:         new Date().toISOString(),
      stats:      statsRes.rows[0] || {},
      timeline:   timelineRes.rows,
      alertStats: alertRes.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
