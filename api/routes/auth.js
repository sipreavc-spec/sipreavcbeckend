// api/routes/auth.js
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { query } = require("../../db/pool");
const { signToken, protect } = require("../../middleware/auth");

const SAFE = "id, name, email, role, crm, specialty, phone, created_at";

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, crm, specialty, phone } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "Nome, email e senha obrigatórios" });

    const dup = await query("SELECT id FROM users WHERE email=$1", [email]);
    if (dup.rows.length) return res.status(409).json({ error: "Email já registado" });

    const hashed = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (name,email,password,role,crm,specialty,phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${SAFE}`,
      [name, email, hashed, role||"patient", crm||null, specialty||null, phone||null]
    );
    res.status(201).json({ token: signToken(rows[0].id), user: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email e senha obrigatórios" });

    const { rows } = await query(
      "SELECT * FROM users WHERE email=$1 AND is_active=TRUE", [email]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: "Credenciais inválidas" });

    const { password: _, ...safe } = user;
    res.json({ token: signToken(user.id), user: safe });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/me", protect, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.role, u.crm, u.specialty, u.phone, u.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id',p.id,'name',p.name,'age',p.age,
                    'last_status',p.last_status,'last_bpm',p.last_bpm,
                    'last_spo2',p.last_spo2,'last_temp',p.last_temp
                  )
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'
              ) AS patients
       FROM users u
       LEFT JOIN patients p ON p.doctor_id=u.id AND p.is_active=TRUE
       WHERE u.id=$1 GROUP BY u.id`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/profile", protect, async (req, res) => {
  try {
    const { name, phone, crm, specialty } = req.body;
    const { rows } = await query(
      `UPDATE users SET name=$1,phone=$2,crm=$3,specialty=$4
       WHERE id=$5 RETURNING ${SAFE}`,
      [name, phone||null, crm||null, specialty||null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { rows } = await query("SELECT password FROM users WHERE id=$1", [req.user.id]);
    if (!(await bcrypt.compare(currentPassword, rows[0].password)))
      return res.status(400).json({ error: "Senha actual incorrecta" });
    await query("UPDATE users SET password=$1 WHERE id=$2",
      [await bcrypt.hash(newPassword, 12), req.user.id]);
    res.json({ message: "Senha actualizada" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
