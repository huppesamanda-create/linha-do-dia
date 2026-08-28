const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

async function initDatabase() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  const client = await pool.connect();

  try {
    await client.query(schema);
    await client.query("SELECT 1");
    console.log("Banco de dados pronto.");
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDatabase
};
