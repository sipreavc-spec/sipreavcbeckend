// db/seed.js — Dados de demonstração
// Executar: npm run db:seed
require("dotenv").config();
const pool   = require("./pool");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

async function seed() {
  const client = await pool.connect();
  try {
    console.log("🌱 A iniciar seed...\n");
    await client.query("BEGIN");

    // Limpar (ordem respeitando FK)
    await client.query("DELETE FROM alerts");
    await client.query("DELETE FROM vitals");
    await client.query("DELETE FROM patient_family");
    await client.query("DELETE FROM devices");
    await client.query("DELETE FROM patients");
    await client.query("DELETE FROM users");
    console.log("🗑  Tabelas limpas");

    const hash = (pw) => bcrypt.hashSync(pw, 10);

    // ── Utilizadores ──────────────────────────────────────
    const { rows:[doc1] } = await client.query(
      `INSERT INTO users (name,email,password,role,crm,specialty,phone)
       VALUES ($1,$2,$3,'doctor',$4,$5,$6) RETURNING id`,
      ["Dra. Maria Santos","medico@demo.com",hash("demo123"),
       "12345-AO","Neurologia","+244 912 000 001"]
    );
    const { rows:[doc2] } = await client.query(
      `INSERT INTO users (name,email,password,role,crm,specialty,phone)
       VALUES ($1,$2,$3,'doctor',$4,$5,$6) RETURNING id`,
      ["Dr. Carlos Lima","carlos@demo.com",hash("demo123"),
       "67890-AO","Cardiologia","+244 912 000 002"]
    );
    const { rows:[fam] } = await client.query(
      `INSERT INTO users (name,email,password,role,phone)
       VALUES ($1,$2,$3,'family',$4) RETURNING id`,
      ["Ana Familiar","familiar@demo.com",hash("demo123"),"+244 923 000 001"]
    );
    await client.query(
      `INSERT INTO users (name,email,password,role,phone)
       VALUES ($1,$2,$3,'patient',$4)`,
      ["João da Silva","paciente@demo.com",hash("demo123"),"+244 934 000 001"]
    );
    console.log("👥 4 utilizadores criados");

    // ── Pacientes ─────────────────────────────────────────
    const ins = async (v) => {
      const { rows:[p] } = await client.query(
        `INSERT INTO patients
          (name,age,gender,phone,diagnosis,stroke_date,medications,notes,
           doctor_id,bpm_max,bpm_min,spo2_min,temp_max,temp_min,
           last_bpm,last_spo2,last_temp,last_status,last_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
         RETURNING id`,
        v
      );
      return p.id;
    };

    const p1 = await ins(["João da Silva",65,"M","+244 934 000 001",
      "AVC Isquémico","2023-06-15",
      ["AAS 100mg","Losartana 50mg","Atorvastatina 20mg"],
      "Hipertensão controlada. Fisioterapia 3x semana.",
      doc1.id, 100,50,92,37.8,35.5, 79,96,36.4,"normal"]);

    const p2 = await ins(["Ana Ferreira",58,"F","+244 934 000 002",
      "AVC Hemorrágico","2024-01-20",
      ["Varfarina 5mg","Amlodipina 10mg"],
      "Pressão arterial instável. Monitoramento intensivo.",
      doc2.id, 95,55,92,37.5,35.5, 122,88,38.2,"critical"]);

    const p3 = await ins(["Pedro Neto",72,"M","+244 934 000 003",
      "AVC Isquémico Recorrente","2022-11-08",
      ["Clopidogrel 75mg","Enalapril 10mg"],
      "Diabético. Controlo glicémico importante.",
      doc1.id, 100,50,90,38.0,35.0, 95,93,37.1,"warning"]);

    const p4 = await ins(["Luísa Campos",61,"F","+244 934 000 004",
      "AVC Isquémico","2023-09-03",
      ["AAS 100mg","Ramipril 5mg"], null,
      doc2.id, 100,50,92,38.0,35.0, 72,98,36.1,"normal"]);

    console.log("🏥 4 pacientes criados");

    // Familiar ligado ao p1
    await client.query(
      "INSERT INTO patient_family (patient_id,user_id) VALUES ($1,$2)",
      [p1, fam.id]
    );

    // ── Dispositivos ──────────────────────────────────────
    const tk = () => crypto.randomBytes(32).toString("hex");
    const tokens = { p1:tk(), p2:tk(), p3:tk(), p4:tk() };

    for (const [did,dtk,lbl,mac,pid,online] of [
      ["ESP32-001",tokens.p1,"Quarto 1 - João",  "AA:BB:CC:DD:EE:01",p1,true],
      ["ESP32-002",tokens.p2,"Quarto 2 - Ana",   "AA:BB:CC:DD:EE:02",p2,true],
      ["ESP32-003",tokens.p3,"Quarto 3 - Pedro","AA:BB:CC:DD:EE:03",p3,false],
      ["ESP32-004",tokens.p4,"Quarto 4 - Luísa","AA:BB:CC:DD:EE:04",p4,true],
    ]) {
      await client.query(
        `INSERT INTO devices
          (device_id,device_token,label,mac_address,patient_id,is_online,last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [did,dtk,lbl,mac,pid,online,online?new Date():null]
      );
    }
    console.log("📡 4 dispositivos criados");

    // ── Histórico de vitais (48 leituras × 4 pacientes) ──
    const now = Date.now();
    for (const pd of [
      {id:p1,did:"ESP32-001",b:{bpm:79, spo2:96,temp:36.4},t:{bpmMax:100,spo2Min:92,tempMax:37.8}},
      {id:p2,did:"ESP32-002",b:{bpm:122,spo2:88,temp:38.2},t:{bpmMax:95, spo2Min:92,tempMax:37.5}},
      {id:p3,did:"ESP32-003",b:{bpm:95, spo2:93,temp:37.1},t:{bpmMax:100,spo2Min:90,tempMax:38.0}},
      {id:p4,did:"ESP32-004",b:{bpm:72, spo2:98,temp:36.1},t:{bpmMax:100,spo2Min:92,tempMax:38.0}},
    ]) {
      for (let i = 48; i >= 0; i--) {
        const bpm  = +(Math.max(40,  Math.min(140, pd.b.bpm  + (Math.random()-.5)*12))).toFixed(1);
        const spo2 = +(Math.max(80,  Math.min(100, pd.b.spo2 + (Math.random()-.5)*4))).toFixed(1);
        const temp = +(Math.max(35,  Math.min(40,  pd.b.temp + (Math.random()-.5)*0.6))).toFixed(1);
        const st   = bpm>pd.t.bpmMax||spo2<pd.t.spo2Min||temp>pd.t.tempMax
                     ? (bpm>pd.t.bpmMax+20||spo2<85?"critical":"warning")
                     : "normal";
        const ts   = new Date(now - i*30*60*1000);
        await client.query(
          `INSERT INTO vitals
            (patient_id,device_id,bpm,spo2,temp_object,temp_ambient,
             ir_value,signal_quality,status,reading_at,created_at)
           VALUES ($1,$2,$3,$4,$5,25.5,180000,'good',$6,$7,$7)`,
          [pd.id,pd.did,bpm,spo2,temp,st,ts]
        );
      }
    }
    console.log("📊 196 leituras históricas criadas");

    // ── Alertas de exemplo ────────────────────────────────
    await client.query(
      `INSERT INTO alerts (patient_id,type,severity,message,bpm_value,threshold_bpm_max)
       VALUES ($1,'bpm_high','critical','BPM crítico: 122 bpm (limite máx: 95)',122,95)`,
      [p2]
    );
    await client.query(
      `INSERT INTO alerts (patient_id,type,severity,message,spo2_value,threshold_spo2_min)
       VALUES ($1,'spo2_low','critical','SpO₂ baixo: 88% (mínimo: 92%)',88,92)`,
      [p2]
    );
    await client.query(
      `INSERT INTO alerts (patient_id,type,severity,message,temp_value,threshold_temp_max)
       VALUES ($1,'temp_high','warning','Temperatura elevada: 38.2°C (limite: 37.5°C)',38.2,37.5)`,
      [p2]
    );
    await client.query(
      `INSERT INTO alerts (patient_id,type,severity,message,bpm_value,threshold_bpm_max)
       VALUES ($1,'bpm_high','warning','BPM elevado: 95 bpm — em observação',95,100)`,
      [p3]
    );
    console.log("🔔 4 alertas criados");

    await client.query("COMMIT");
    console.log(`
╔══════════════════════════════════════════╗
║      SEED CONCLUÍDO COM SUCESSO          ║
╠══════════════════════════════════════════╣
║  medico@demo.com    / demo123  (médico)  ║
║  carlos@demo.com    / demo123  (médico)  ║
║  familiar@demo.com  / demo123  (família) ║
║  paciente@demo.com  / demo123  (paciente)║
╠══════════════════════════════════════════╣
║  Tokens dos dispositivos:                ║`);
    Object.entries(tokens).forEach(([k,v]) =>
      console.log(`║  ${k.padEnd(2)}: ${v.substring(0,40)}...   ║`)
    );
    console.log("╚══════════════════════════════════════════╝");

  } catch (err) {
    await client.query("ROLLBACK").catch(()=>{});
    console.error("❌ Seed falhou:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(()=> process.exit(1));
