const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const initSqlJs = require('sql.js');

const app     = express();
const DB_PATH = path.join(__dirname, 'convidados.db');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── Carrega/cria o banco ──────────────────────────────────────────────
let db;

async function loadDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✅ Banco existente carregado:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('🆕 Novo banco criado em:', DB_PATH);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS confirmacoes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      nome            TEXT NOT NULL,
      telefone        TEXT NOT NULL,
      vai_comparecer  TEXT NOT NULL CHECK(vai_comparecer IN ('yes','no')),
      num_pessoas     TEXT DEFAULT '1',
      mensagem        TEXT,
      data_registro   DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS configuracao (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    )
  `);

  // Insere config padrão se não existir
  db.run(`
    INSERT OR IGNORE INTO configuracao (chave, valor) VALUES
      ('evento_nome',  'Chá de Fralda do Miguel'),
      ('evento_data',  '2026-06-06'),
      ('evento_local', 'Salão de Festas - Rua Mogi Mirim, 138'),
      ('evento_hora',  '14h às 18h')
  `);

  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Helpers ──────────────────────────────────────────────────────────
function queryAll(sql, params = []) {
  const stmt   = db.prepare(sql);
  const rows   = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ── ROTAS ─────────────────────────────────────────────────────────────

// POST /confirmar  → salva confirmação
app.post('/confirmar', (req, res) => {
  const { nome, telefone, vai_comparecer, num_pessoas, mensagem } = req.body;

  if (!nome || !telefone || !vai_comparecer)
    return res.status(400).json({ erro: 'Campos obrigatórios faltando.' });

  db.run(
    `INSERT INTO confirmacoes (nome, telefone, vai_comparecer, num_pessoas, mensagem)
     VALUES (?, ?, ?, ?, ?)`,
    [nome.trim(), telefone.trim(), vai_comparecer, num_pessoas || '1', mensagem || '']
  );
  saveDB();

  const total = queryAll(`SELECT COUNT(*) as c FROM confirmacoes WHERE vai_comparecer='yes'`)[0].c;
  res.json({ ok: true, total_confirmados: total });
});

// GET /convidados  → lista todos
app.get('/convidados', (req, res) => {
  const rows = queryAll(`SELECT * FROM confirmacoes ORDER BY data_registro DESC`);
  res.json(rows);
});

// GET /total  → só o contador
app.get('/total', (req, res) => {
  const r = queryAll(`SELECT COUNT(*) as c FROM confirmacoes WHERE vai_comparecer='yes'`)[0];
  res.json({ total_confirmados: r.c });
});

// GET /stats  → resumo para admin
app.get('/stats', (req, res) => {
  const total_sim = queryAll(`SELECT COUNT(*) as c FROM confirmacoes WHERE vai_comparecer='yes'`)[0].c;
  const total_nao = queryAll(`SELECT COUNT(*) as c FROM confirmacoes WHERE vai_comparecer='no'`)[0].c;
  const pessoas   = queryAll(`
    SELECT COALESCE(SUM(CAST(num_pessoas AS INTEGER)), 0) as c
    FROM confirmacoes WHERE vai_comparecer='yes'
  `)[0].c;
  const ultimos   = queryAll(`SELECT nome, vai_comparecer, data_registro FROM confirmacoes ORDER BY id DESC LIMIT 5`);
  res.json({ total_sim, total_nao, total_pessoas: pessoas, ultimos });
});

// DELETE /convidados/:id  → remove um registro
app.delete('/convidados/:id', (req, res) => {
  db.run(`DELETE FROM confirmacoes WHERE id = ?`, [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

// ── START ─────────────────────────────────────────────────────────────
const PORT = 3000;
loadDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🦁 Servidor do Chá do Miguel rodando em http://localhost:${PORT}`);
    console.log(`📁 Banco de dados: ${DB_PATH}`);
  });
});
