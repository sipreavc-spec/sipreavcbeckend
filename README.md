# SIPRE-AVC Backend v3
## Node.js + Express + pg + PostgreSQL (Aiven) → Vercel

```
ESP32 ──Wi-Fi──► Vercel (API) ──► Aiven PostgreSQL
                      │
                Socket.IO (polling)
                      │
               React Frontend
```

---

## 📁 Estrutura

```
sipre-avc-backend/
├── vercel.json                  ← Configuração de deploy Vercel
├── package.json
├── .env.example                 ← Copiar para .env
├── .gitignore
│
├── api/
│   ├── index.js                 ← Servidor principal + bootstrap initDB
│   └── routes/
│       ├── auth.js              ← POST /login  POST /register
│       ├── vitals.js            ← POST /reading (ESP32)  GET histórico
│       ├── patients.js          ← CRUD pacientes
│       ├── alerts.js            ← GET alertas, acknowledge
│       ├── devices.js           ← Registo de ESP32
│       └── reports.js           ← Relatórios e agregações
│
├── db/
│   ├── pool.js                  ← Pool de conexão pg (Aiven)
│   ├── initdb.js                ← Cria todas as tabelas automaticamente
│   └── seed.js                  ← Dados de demonstração
│
└── middleware/
    ├── auth.js                  ← JWT + deviceToken ESP32
    └── alertEngine.js           ← Motor de alertas automáticos
```

---

## ⚙️ Setup Local (5 minutos)

### 1. Instalar dependências
```bash
npm install
```

### 2. Configurar variáveis de ambiente
```bash
cp .env.example .env
```
Editar `.env` com os dados do Aiven:
```env
DB_HOST=pg-2f6c26f4-sipreavc-3047.d.aivencloud.com
DB_PORT=23447
DB_USER=avnadmin
DB_PASSWORD=SUA_SENHA_AQUI
DB_NAME=defaultdb

JWT_SECRET=GERE_COM_COMANDO_ABAIXO
FRONTEND_URL=http://localhost:5173
```
Gerar JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Iniciar servidor (cria tabelas automaticamente)
```bash
npm run dev
```
O servidor vai:
1. Conectar ao PostgreSQL Aiven
2. Verificar se as tabelas existem
3. Criar as 6 tabelas se a BD estiver vazia
4. Iniciar em `http://localhost:3001`

### 4. Verificar
```bash
curl http://localhost:3001/api/health
# → { "status": "ok", "database": "connected" }
```

### 5. Popular com dados demo (opcional)
```bash
npm run db:seed
```

---

## 🗄️ Tabelas criadas automaticamente (initdb.js)

| Tabela           | Descrição                                    |
|------------------|----------------------------------------------|
| `users`          | Médicos, pacientes, familiares               |
| `patients`       | Dados clínicos + limites + cache last vitals |
| `patient_family` | Relação paciente ↔ familiar (N:N)            |
| `devices`        | Dispositivos ESP32                            |
| `vitals`         | Leituras dos sensores (série temporal)       |
| `alerts`         | Alertas gerados automaticamente              |

---

## 🚀 Deploy no Vercel

### Opção A — CLI (mais rápido)
```bash
npm install -g vercel
vercel login
vercel --prod
```
Durante o deploy, adicionar as variáveis de ambiente quando solicitado.

### Opção B — GitHub + Vercel Dashboard
1. `git init && git add . && git commit -m "init"`
2. Criar repositório no GitHub
3. `git push origin main`
4. [vercel.com/new](https://vercel.com/new) → importar repo
5. Adicionar variáveis de ambiente no painel

### Variáveis obrigatórias no Vercel:
| Variável      | Valor                                              |
|---------------|----------------------------------------------------|
| `DB_HOST`     | `pg-2f6c26f4-sipreavc-3047.d.aivencloud.com`       |
| `DB_PORT`     | `23447`                                            |
| `DB_USER`     | `avnadmin`                                         |
| `DB_PASSWORD` | sua senha do Aiven                                 |
| `DB_NAME`     | `defaultdb`                                        |
| `JWT_SECRET`  | chave de 64 bytes gerada                           |
| `FRONTEND_URL`| URL do frontend (ex: `https://sipre.vercel.app`)  |
| `NODE_ENV`    | `production`                                       |

---

## 📡 API Reference

### Auth
```
POST /api/auth/register  { name, email, password, role }
POST /api/auth/login     { email, password }
GET  /api/auth/me        ← Bearer Token
PUT  /api/auth/profile   ← Bearer Token
PUT  /api/auth/password  ← Bearer Token
```

### Vitais (ESP32 + Dashboard)
```
POST /api/vitals/reading          ← x-device-token  (ESP32)
GET  /api/vitals/:id              ← Bearer ?limit=&from=&to=
GET  /api/vitals/:id/latest       ← Bearer
GET  /api/vitals/:id/stats        ← Bearer ?period=day|week|month
```

### Pacientes
```
GET    /api/patients               ← Bearer
POST   /api/patients               ← Bearer (doctor)
PUT    /api/patients/:id           ← Bearer (doctor)
PUT    /api/patients/:id/thresholds← Bearer (doctor)
DELETE /api/patients/:id           ← Bearer (doctor)
```

### Alertas
```
GET /api/alerts                    ← Bearer ?patientId=&severity=&acknowledged=
PUT /api/alerts/:id/acknowledge    ← Bearer
PUT /api/alerts/acknowledge-all/:patientId ← Bearer
```

### Dispositivos
```
GET  /api/devices                  ← Bearer (doctor)
POST /api/devices                  ← Bearer (doctor) → retorna device_token
GET  /api/devices/:deviceId/status ← Bearer
PUT  /api/devices/:id              ← Bearer (doctor)
```

### Relatórios
```
GET /api/reports/:patientId        ← Bearer ?period=day|week|month
```

### Health
```
GET /api/health  → { status, database, db_time, uptime }
```

---

## 🧪 Contas Demo (após db:seed)

| Email               | Senha   | Role    |
|---------------------|---------|---------|
| medico@demo.com     | demo123 | Médico  |
| carlos@demo.com     | demo123 | Médico  |
| familiar@demo.com   | demo123 | Família |
| paciente@demo.com   | demo123 | Paciente|

---

## 🔌 Configurar ESP32

No ficheiro `.ino`:
```cpp
const char* SERVER_URL   = "https://SEU-PROJETO.vercel.app";
const char* DEVICE_TOKEN = "token_gerado_ao_registar_dispositivo";
```

Registar dispositivo (POST /api/devices) retorna o `device_token` — guardar este valor.
