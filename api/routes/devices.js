// api/routes/devices.js
const router = require("express").Router();
const crypto = require("crypto");
const { query } = require("../../db/pool");
const { protect, doctorOnly } = require("../../middleware/auth");

router.get("/", protect, doctorOnly, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT d.*, json_build_object('id',p.id,'name',p.name,'age',p.age) AS patient
       FROM devices d LEFT JOIN patients p ON d.patient_id=p.id
       WHERE d.is_active=TRUE ORDER BY d.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/", protect, doctorOnly, async (req, res) => {
  try {
    const { device_id, label, patient_id, mac_address, firmware_version } = req.body;
    if (!device_id) return res.status(400).json({ error: "device_id obrigatório" });

    const device_token = crypto.randomBytes(32).toString("hex");
    const { rows } = await query(
      `INSERT INTO devices (device_id, device_token, label, mac_address, firmware_version, patient_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [device_id, device_token, label||null, mac_address||null,
       firmware_version||"1.0.0", patient_id||null]
    );
    res.status(201).json({
      device: rows[0], device_token,
      warning: "⚠ Guarde o device_token — não será mostrado novamente",
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/:deviceId/status", protect, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT d.is_online, d.last_seen, d.ip_address,
              json_build_object('id',p.id,'name',p.name) AS patient
       FROM devices d LEFT JOIN patients p ON d.patient_id=p.id
       WHERE d.device_id=$1`,
      [req.params.deviceId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Dispositivo não encontrado" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/:id", protect, doctorOnly, async (req, res) => {
  try {
    const { label, reading_interval, firmware_version, patient_id } = req.body;
    const { rows } = await query(
      `UPDATE devices SET label=$1, reading_interval=$2,
         firmware_version=$3, patient_id=$4
       WHERE id=$5 RETURNING *`,
      [label, reading_interval||30, firmware_version, patient_id||null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/:id", protect, doctorOnly, async (req, res) => {
  try {
    await query("UPDATE devices SET is_active=FALSE WHERE id=$1", [req.params.id]);
    res.json({ message: "Dispositivo removido" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
