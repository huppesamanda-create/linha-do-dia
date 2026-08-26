const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000
});

async function initDatabase() {
  console.log("Conectando ao banco de dados...");

  const client = await pool.connect();

  try {
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '15s'");

    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");

    console.log("Verificando estrutura do banco...");
    await client.query(schema);
    console.log("Banco de dados pronto.");
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDatabase
};
