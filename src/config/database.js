const { Pool } = require("pg");

// Pool de conexões com o PostgreSQL. Reutiliza conexões entre requisições
// em vez de abrir uma nova a cada query.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Erro inesperado no pool do PostgreSQL:", err);
});

/**
 * Executa uma query parametrizada.
 * Sempre usar placeholders ($1, $2...) — nunca concatenar strings, para evitar SQL injection.
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === "development") {
    console.log("query executada", { text, duration, rows: res.rowCount });
  }
  return res;
}

/**
 * Para transações (ex: aprovar notícia + gravar log administrativo juntos).
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
