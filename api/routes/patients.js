// api/routes/patients.js
const router = require("express").Router();
const { query } = require("../../db/pool");
const { protect, doctorOnly } = require("../../middleware/auth");

const SELECT_PATIENT = `
  SELECT p.*,
    json_build_object('id',u.id,'name',u.name,'email',u.email,
                      'crm',u.crm,'specialty',u.specialty) AS doctor,
    json_build_object('device_id',d.device_id,'is_online',d.is_online,
                      'last_seen',d.last_seen,'label',d.label) AS device
  FROM patients p
  LEFT JOIN users   u ON p.doctor_id  = u.id
  LEFT JOIN devices d ON d.patient_id = p.id
`;

router.get("/", protect, async (req, res) => {
  try {
    let where, params;
    if (req.user.role === "doctor") {
      where = "WHERE p.doctor_id=$1 AND p.is_active=TRUE";
      params = [req.user.id];
    } else {
      where = `WHERE p.is_active=TRUE
               AND p.id IN (SELECT patient_id FROM patient_family WHERE user_id=$1)`;
      params = [req.user.id];
    }
    const { rows } = await query(`${SELECT_PATIENT} ${where} ORDER BY p.last_status, p.name`, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/:id", protect, async (req, res) => {
  try {
    const { rows } = await query(`${SELECT_PATIENT} WHERE p.id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Paciente não encontrado" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/", protect, doctorOnly, async (req, res) => {
  try {
    const { name, age, gender, phone, address, diagnosis, stroke_date,
            medications, notes, bpm_max, bpm_min, spo2_min, temp_max, temp_min } = req.body;
    const { rows } = await query(
      `INSERT INTO patients
         (name,age,gender,phone,address,diagnosis,stroke_date,medications,
          notes,doctor_id,bpm_max,bpm_min,spo2_min,temp_max,temp_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [name, age, gender||"M", phone||null, address||null,
       diagnosis||"AVC Isquémico",
       stroke_date ? new Date(stroke_date) : null,
       medications||[],
       notes||null, req.user.id,
       bpm_max||100, bpm_min||50, spo2_min||90, temp_max||38.0, temp_min||35.0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/:id", protect, doctorOnly, async (req, res) => {
  try {
    const { name, age, gender, phone, address, diagnosis, stroke_date, medications, notes } = req.body;
    const { rows } = await query(
      `UPDATE patients SET name=$1,age=$2,gender=$3,phone=$4,address=$5,
         diagnosis=$6,stroke_date=$7,medications=$8,notes=$9
       WHERE id=$10 RETURNING *`,
      [name, age, gender, phone||null, address||null, diagnosis,
       stroke_date ? new Date(stroke_date) : null,
       medications||[], notes||null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/:id/thresholds", protect, doctorOnly, async (req, res) => {
  try {
    const { bpm_max, bpm_min, spo2_min, temp_max, temp_min } = req.body;
    const { rows } = await query(
      `UPDATE patients SET bpm_max=$1,bpm_min=$2,spo2_min=$3,temp_max=$4,temp_min=$5
       WHERE id=$6 RETURNING id,bpm_max,bpm_min,spo2_min,temp_max,temp_min`,
      [bpm_max, bpm_min, spo2_min, temp_max, temp_min, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/:id", protect, doctorOnly, async (req, res) => {
  try {
    await query("UPDATE patients SET is_active=FALSE WHERE id=$1", [req.params.id]);
    res.json({ message: "Paciente removido" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
