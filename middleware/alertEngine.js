// middleware/alertEngine.js
const { query } = require("../db/pool");

exports.checkAndAlert = async (vitals, patient, io = null) => {
  if (!patient) return [];

  const { bpm, spo2, temp_object: temp, id: vitalsId } = vitals;
  const alerts = [];

  const checks = [
    {
      cond: bpm > patient.bpm_max,
      type: "bpm_high",
      severity: bpm > patient.bpm_max + 20 ? "critical" : "warning",
      message: `BPM crítico: ${bpm} bpm (limite máx: ${patient.bpm_max})`,
      col: "bpm_value", val: bpm, thCol: "threshold_bpm_max", thVal: patient.bpm_max,
    },
    {
      cond: bpm < patient.bpm_min && bpm > 0,
      type: "bpm_low", severity: "critical",
      message: `BPM baixo: ${bpm} bpm (limite mín: ${patient.bpm_min})`,
      col: "bpm_value", val: bpm, thCol: "threshold_bpm_min", thVal: patient.bpm_min,
    },
    {
      cond: spo2 < patient.spo2_min && spo2 > 0,
      type: "spo2_low",
      severity: spo2 < 85 ? "critical" : "warning",
      message: `SpO₂ baixo: ${spo2}% (mínimo: ${patient.spo2_min}%)`,
      col: "spo2_value", val: spo2, thCol: "threshold_spo2_min", thVal: patient.spo2_min,
    },
    {
      cond: temp > patient.temp_max,
      type: "temp_high",
      severity: temp > 39 ? "critical" : "warning",
      message: `Temperatura elevada: ${temp}°C (limite: ${patient.temp_max}°C)`,
      col: "temp_value", val: temp, thCol: "threshold_temp_max", thVal: patient.temp_max,
    },
    {
      cond: temp < patient.temp_min && temp > 0,
      type: "temp_low", severity: "warning",
      message: `Temperatura baixa: ${temp}°C (mínimo: ${patient.temp_min}°C)`,
      col: "temp_value", val: temp, thCol: "threshold_temp_min", thVal: patient.temp_min,
    },
  ];

  for (const c of checks) {
    if (!c.cond) continue;

    const { rows } = await query(
      `INSERT INTO alerts
         (patient_id, vitals_id, type, severity, message, ${c.col}, ${c.thCol})
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [patient.id, vitalsId, c.type, c.severity, c.message, c.val, c.thVal]
    );
    alerts.push(rows[0]);

    if (io) {
      io.to(`patient_${patient.id}`).emit("new_alert", {
        alert:       rows[0],
        patientId:   patient.id,
        patientName: patient.name,
      });
    }
  }

  if (alerts.length > 0) {
    const hasCritical = alerts.some((a) => a.severity === "critical");
    await query(
      `UPDATE patients SET last_status=$1 WHERE id=$2`,
      [hasCritical ? "critical" : "warning", patient.id]
    );
  }

  return alerts;
};
