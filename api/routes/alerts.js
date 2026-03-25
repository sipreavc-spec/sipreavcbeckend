// api/routes/alerts.js
const router = require("express").Router();
const { query } = require("../../db/pool");
const { protect } = require("../../middleware/auth");

router.get("/", protect, async (req, res) => {
  try {
    const { patientId, severity, acknowledged, limit=50, skip=0 } = req.query;
    const params = [];
    const conds  = [];
    if (patientId)    { params.push(patientId);  conds.push(`a.patient_id=$${params.length}`); }
    if (severity)     { params.push(severity);   conds.push(`a.severity=$${params.length}`); }
    if (acknowledged !== undefined) {
      params.push(acknowledged === "true");
      conds.push(`a.acknowledged=$${params.length}`);
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    params.push(Number(limit)); params.push(Number(skip));

    const { rows } = await query(
      `SELECT a.*, json_build_object('id',p.id,'name',p.name,'age',p.age) AS patient
       FROM alerts a JOIN patients p ON a.patient_id=p.id
       ${where} ORDER BY a.created_at DESC
       LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );
    const countParams = params.slice(0, params.length-2);
    const { rows:[{total}] } = await query(
      `SELECT COUNT(*)::int AS total FROM alerts a ${where}`, countParams
    );
    res.json({ alerts: rows, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/:id/acknowledge", protect, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE alerts SET acknowledged=TRUE, acknowledged_by_id=$1, acknowledged_at=NOW()
       WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/acknowledge-all/:patientId", protect, async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE alerts SET acknowledged=TRUE, acknowledged_by_id=$1, acknowledged_at=NOW()
       WHERE patient_id=$2 AND acknowledged=FALSE`,
      [req.user.id, req.params.patientId]
    );
    res.json({ message: `${rowCount} alertas reconhecidos` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
