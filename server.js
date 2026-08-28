const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { pool, initDatabase } = require("./db");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const TIME_ZONE = "America/Sao_Paulo";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, status, data) {
  if (res.headersSent) return;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Requisição muito grande."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON inválido."));
      }
    });

    req.on("error", reject);
  });
}

function validDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function validIsoDate(value) {
  const parsed = new Date(value);
  return Boolean(value) && Number.isFinite(parsed.getTime());
}

function cleanTitle(value) {
  return String(value || "").trim().slice(0, 500);
}

function cleanNotes(value) {
  return String(value || "").slice(0, 12000);
}

function validFinanceYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100;
}

function validFinanceMonth(value) {
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

function validFinanceDate(year, month, day) {
  year = Number(year);
  month = Number(month);
  day = Number(day);

  if (!validFinanceYear(year) || !validFinanceMonth(month) || !Number.isInteger(day) || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function financeDateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cleanFinanceDescription(value) {
  return String(value || "").trim().slice(0, 500);
}

function cleanSubtasks(value) {
  if (!Array.isArray(value)) {
    throw new Error("Checklist inválido.");
  }

  if (value.length > 100) {
    throw new Error("Limite de 100 subatividades.");
  }

  return value.map(item => {
    const text = String(item?.text || "").trim().slice(0, 180);

    if (!text) {
      throw new Error("Subatividade vazia.");
    }

    return {
      id: String(item?.id || randomUUID()).slice(0, 100),
      text,
      done: Boolean(item?.done)
    };
  });
}

function mapActivity(row) {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    notes: row.notes || "",
    status: row.status,
    startedAt: row.started_at,
    lastStartedAt: row.last_started_at,
    endedAt: row.ended_at,
    accumulatedMs: Number(row.accumulated_ms || 0),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    subtasks: Array.isArray(row.subtasks) ? row.subtasks : []
  };
}

function mapPlan(row) {
  if (!row) return null;

  return {
    id: row.id,
    day: String(row.planned_date),
    title: row.title,
    notes: row.notes || ""
  };
}

async function getActive() {
  const result = await pool.query(
    `SELECT *
       FROM ld4_activities
      WHERE status IN ('active', 'paused')
      ORDER BY started_at DESC
      LIMIT 1`
  );

  return result.rows[0] || null;
}

async function getActivity(id) {
  const result = await pool.query(
    `SELECT *
       FROM ld4_activities
      WHERE id = $1
      LIMIT 1`,
    [id]
  );

  return result.rows[0] || null;
}

function safePublicPath(pathname) {
  const clean = decodeURIComponent(pathname || "/");

  let requested = clean === "/"
    ? "index.html"
    : clean.replace(/^\/+/, "");

  if (requested.endsWith("/")) {
    requested += "index.html";
  }

  const resolved = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!resolved.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return resolved;
}

function formatClock(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(1, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}min`;
  }

  if (minutes > 0) {
    return `${minutes} min`;
  }

  return `${totalSeconds} s`;
}

function formatTotal(milliseconds) {
  const totalMinutes = Math.floor(Number(milliseconds || 0) / 60000);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
}

async function generatePdf(res, day) {
  const PDFDocument = require("pdfkit");

  const result = await pool.query(
    `SELECT *
       FROM ld4_activities
      WHERE status = 'completed'
        AND (started_at AT TIME ZONE $1)::date = $2::date
      ORDER BY started_at ASC`,
    [TIME_ZONE, day]
  );

  const rows = result.rows;
  const total = rows.reduce((sum, row) => sum + Number(row.duration_ms || 0), 0);

  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="linha-do-dia-${day}.pdf"`,
    "Cache-Control": "no-store"
  });

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 54, right: 54, bottom: 54, left: 54 }
  });

  doc.pipe(res);

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#222222").text("Linha do Dia");
  doc.moveDown(0.25).font("Helvetica").fontSize(10).fillColor("#666666").text(day);
  doc.moveDown(0.25).text(`Tempo total registrado: ${formatTotal(total)}`);
  doc.moveDown(1.2);

  if (!rows.length) {
    doc.fillColor("#555555").fontSize(11).text("Nenhuma atividade registrada.");
    doc.end();
    return;
  }

  rows.forEach((row, index) => {
    if (index) doc.moveDown(0.8);

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#444444")
      .text(`${formatClock(row.started_at)} - ${formatClock(row.ended_at)}   ${formatDuration(row.duration_ms)}`);

    doc
      .moveDown(0.25)
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#222222")
      .text(row.title);

    const subtasks = Array.isArray(row.subtasks) ? row.subtasks : [];

    if (subtasks.length) {
      doc.moveDown(0.35);

      subtasks.forEach(subtask => {
        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor(subtask.done ? "#777777" : "#333333")
          .text(`${subtask.done ? "[x]" : "[ ]"} ${subtask.text}`, { indent: 10 });
      });
    }

    const notes = String(row.notes || "").trim();

    if (notes) {
      doc.moveDown(0.45).font("Helvetica-Bold").fontSize(9.5).fillColor("#555555").text("Anotações:");
      doc.moveDown(0.15).font("Helvetica").fontSize(9.5).fillColor("#444444").text(notes, {
        indent: 10,
        lineGap: 2
      });
    }

    if (index < rows.length - 1) {
      doc.moveDown(0.8);
      const y = doc.y;
      doc
        .moveTo(doc.page.margins.left, y)
        .lineTo(doc.page.width - doc.page.margins.right, y)
        .strokeColor("#dddddd")
        .lineWidth(0.7)
        .stroke();
    }
  });

  doc.end();
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/enam/meta") {
    sendJson(res, 200, {
      authenticated: true,
      persistence: "database",
      authRequired: false
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/enam/state") {
    const result = await pool.query(
      `SELECT state
         FROM ld4_enam_state
        WHERE id = 'main'
        LIMIT 1`
    );

    sendJson(
      res,
      200,
      result.rows[0]?.state && typeof result.rows[0].state === "object"
        ? result.rows[0].state
        : {}
    );
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/enam/state") {
    const state = await readJson(req);

    if (!state || typeof state !== "object" || Array.isArray(state)) {
      sendJson(res, 400, { error: "Estado do ENAM inválido." });
      return true;
    }

    await pool.query(
      `INSERT INTO ld4_enam_state (id, state, updated_at)
       VALUES ('main', $1::jsonb, NOW())
       ON CONFLICT (id)
       DO UPDATE
          SET state = EXCLUDED.state,
              updated_at = NOW()`,
      [JSON.stringify(state)]
    );

    sendJson(res, 200, state);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/enam/login") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/finance/state") {
    const year = Number(url.searchParams.get("year"));

    if (!validFinanceYear(year)) {
      sendJson(res, 400, { error: "Ano inválido." });
      return true;
    }

    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;

    const [transactionsResult, categoriesResult, budgetsResult, yearResult] = await Promise.all([
      pool.query(
        `SELECT id, TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date, type, nature, amount, category_id, status, description
           FROM ld4_finance_transactions
          WHERE transaction_date >= $1::date
            AND transaction_date < $2::date
          ORDER BY transaction_date ASC, created_at ASC`,
        [start, end]
      ),
      pool.query(
        `SELECT id, name, sort_order
           FROM ld4_finance_categories
          WHERE active = TRUE
          ORDER BY sort_order ASC, name ASC`
      ),
      pool.query(
        `SELECT year, month, category_id, amount
           FROM ld4_finance_budgets
          WHERE year = $1
          ORDER BY month ASC, category_id ASC`,
        [year]
      ),
      pool.query(
        `SELECT year, opening_balance, warning_threshold
           FROM ld4_finance_years
          WHERE year = $1
          LIMIT 1`,
        [year]
      )
    ]);

    const transactions = transactionsResult.rows.map(row => {
      const date = String(row.transaction_date).slice(0, 10);
      const [y, m, d] = date.split("-").map(Number);

      return {
        id: row.id,
        year: y,
        month: m - 1,
        day: d,
        type: row.type,
        nature: row.nature,
        value: Number(row.amount),
        category: row.category_id,
        status: row.status,
        description: row.description || ""
      };
    });

    sendJson(res, 200, {
      year,
      openingBalance: Number(yearResult.rows[0]?.opening_balance || 0),
      warningThreshold: Number(yearResult.rows[0]?.warning_threshold || 1000),
      categories: categoriesResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        sortOrder: Number(row.sort_order || 0)
      })),
      budgets: budgetsResult.rows.map(row => ({
        year: Number(row.year),
        month: Number(row.month) - 1,
        category: row.category_id,
        amount: Number(row.amount || 0)
      })),
      transactions
    });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/finance/year") {
    const body = await readJson(req);
    const year = Number(body.year);
    const openingBalance = Number(body.openingBalance);
    const warningThreshold = Number(body.warningThreshold);

    if (!validFinanceYear(year) || !Number.isFinite(openingBalance) || !Number.isFinite(warningThreshold) || warningThreshold < 0) {
      sendJson(res, 400, { error: "Configuração financeira inválida." });
      return true;
    }

    const result = await pool.query(
      `INSERT INTO ld4_finance_years (year, opening_balance, warning_threshold, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (year)
       DO UPDATE SET
         opening_balance = EXCLUDED.opening_balance,
         warning_threshold = EXCLUDED.warning_threshold,
         updated_at = NOW()
       RETURNING year, opening_balance, warning_threshold`,
      [year, openingBalance, warningThreshold]
    );

    sendJson(res, 200, {
      year: Number(result.rows[0].year),
      openingBalance: Number(result.rows[0].opening_balance),
      warningThreshold: Number(result.rows[0].warning_threshold)
    });
    return true;
  }


  if (req.method === "POST" && url.pathname === "/api/finance/categories") {
    const body = await readJson(req);
    const name = String(body.name || "").trim().slice(0, 120);

    if (!name) {
      sendJson(res, 400, { error: "Informe o nome da categoria." });
      return true;
    }

    const existing = await pool.query(
      `SELECT id
         FROM ld4_finance_categories
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1`,
      [name]
    );

    if (existing.rows.length) {
      sendJson(res, 409, { error: "Já existe uma categoria com esse nome." });
      return true;
    }

    const orderResult = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
         FROM ld4_finance_categories`
    );

    const id = randomUUID();
    const sortOrder = Number(orderResult.rows[0]?.next_order || 10);

    const result = await pool.query(
      `INSERT INTO ld4_finance_categories
        (id, name, sort_order, active, created_at, updated_at)
       VALUES ($1, $2, $3, TRUE, NOW(), NOW())
       RETURNING id, name, sort_order`,
      [id, name, sortOrder]
    );

    sendJson(res, 201, {
      category: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        sortOrder: Number(result.rows[0].sort_order || 0)
      }
    });
    return true;
  }

  const financeCategoryMatch = url.pathname.match(/^\/api\/finance\/categories\/([^/]+)$/);

  if (req.method === "PUT" && financeCategoryMatch) {
    const id = decodeURIComponent(financeCategoryMatch[1]);
    const body = await readJson(req);
    const name = String(body.name || "").trim().slice(0, 120);

    if (!name) {
      sendJson(res, 400, { error: "Informe o nome da categoria." });
      return true;
    }

    const duplicate = await pool.query(
      `SELECT id
         FROM ld4_finance_categories
        WHERE LOWER(name) = LOWER($1)
          AND id <> $2
        LIMIT 1`,
      [name, id]
    );

    if (duplicate.rows.length) {
      sendJson(res, 409, { error: "Já existe uma categoria com esse nome." });
      return true;
    }

    const result = await pool.query(
      `UPDATE ld4_finance_categories
          SET name = $2,
              updated_at = NOW()
        WHERE id = $1
          AND active = TRUE
        RETURNING id, name, sort_order`,
      [id, name]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Categoria não encontrada." });
      return true;
    }

    sendJson(res, 200, {
      category: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        sortOrder: Number(result.rows[0].sort_order || 0)
      }
    });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/finance/budget") {
    const body = await readJson(req);
    const year = Number(body.year);
    const month = Number(body.month) + 1;
    const category = String(body.category || "");
    const amount = Number(body.amount);

    if (!validFinanceYear(year) || !validFinanceMonth(month) || !category || !Number.isFinite(amount) || amount < 0) {
      sendJson(res, 400, { error: "Orçamento inválido." });
      return true;
    }

    const result = await pool.query(
      `INSERT INTO ld4_finance_budgets (year, month, category_id, amount, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (year, month, category_id)
       DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
       RETURNING year, month, category_id, amount`,
      [year, month, category, amount]
    );

    sendJson(res, 200, {
      year: Number(result.rows[0].year),
      month: Number(result.rows[0].month) - 1,
      category: result.rows[0].category_id,
      amount: Number(result.rows[0].amount)
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/finance/transactions") {
    const body = await readJson(req);
    const year = Number(body.year);
    const month = Number(body.month) + 1;
    const day = Number(body.day);
    const type = String(body.type || "");
    const nature = type === "expense" ? String(body.nature || "") : null;
    const amount = Number(body.value);
    const category = type === "expense" ? String(body.category || "") : null;
    const status = String(body.status || "");
    const description = cleanFinanceDescription(body.description);

    if (!validFinanceDate(year, month, day) || !["income", "expense"].includes(type) || !Number.isFinite(amount) || amount <= 0 || !["provisioned", "realized"].includes(status)) {
      sendJson(res, 400, { error: "Lançamento inválido." });
      return true;
    }

    if (type === "expense" && (!["fixed", "daily"].includes(nature) || !category)) {
      sendJson(res, 400, { error: "Informe o tipo de saída e a categoria." });
      return true;
    }

    const result = await pool.query(
      `INSERT INTO ld4_finance_transactions
        (id, transaction_date, type, nature, amount, category_id, status, description)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [randomUUID(), financeDateKey(year, month, day), type, nature, amount, category, status, description]
    );

    sendJson(res, 201, { id: result.rows[0].id });
    return true;
  }

  const financeTransactionMatch = url.pathname.match(/^\/api\/finance\/transactions\/([^/]+)$/);

  if (req.method === "PUT" && financeTransactionMatch) {
    const id = decodeURIComponent(financeTransactionMatch[1]);
    const body = await readJson(req);
    const year = Number(body.year);
    const month = Number(body.month) + 1;
    const day = Number(body.day);
    const type = String(body.type || "");
    const nature = type === "expense" ? String(body.nature || "") : null;
    const amount = Number(body.value);
    const category = type === "expense" ? String(body.category || "") : null;
    const status = String(body.status || "");
    const description = cleanFinanceDescription(body.description);

    if (!validFinanceDate(year, month, day) || !["income", "expense"].includes(type) || !Number.isFinite(amount) || amount <= 0 || !["provisioned", "realized"].includes(status)) {
      sendJson(res, 400, { error: "Lançamento inválido." });
      return true;
    }

    if (type === "expense" && (!["fixed", "daily"].includes(nature) || !category)) {
      sendJson(res, 400, { error: "Informe o tipo de saída e a categoria." });
      return true;
    }

    const result = await pool.query(
      `UPDATE ld4_finance_transactions
          SET transaction_date = $2::date,
              type = $3,
              nature = $4,
              amount = $5,
              category_id = $6,
              status = $7,
              description = $8,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id`,
      [id, financeDateKey(year, month, day), type, nature, amount, category, status, description]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Lançamento não encontrado." });
      return true;
    }

    sendJson(res, 200, { id: result.rows[0].id });
    return true;
  }

  if (req.method === "DELETE" && financeTransactionMatch) {
    const id = decodeURIComponent(financeTransactionMatch[1]);
    const result = await pool.query(
      `DELETE FROM ld4_finance_transactions WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Lançamento não encontrado." });
      return true;
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    await pool.query("SELECT 1");
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const day = url.searchParams.get("day");

    if (!validDay(day)) {
      sendJson(res, 400, { error: "Data inválida." });
      return true;
    }

    const [activeResult, entriesResult, plansResult] = await Promise.all([
      pool.query(
        `SELECT *
           FROM ld4_activities
          WHERE status IN ('active', 'paused')
          ORDER BY started_at DESC
          LIMIT 1`
      ),
      pool.query(
        `SELECT *
           FROM ld4_activities
          WHERE status = 'completed'
            AND (started_at AT TIME ZONE $1)::date = $2::date
          ORDER BY started_at ASC`,
        [TIME_ZONE, day]
      ),
      pool.query(
        `SELECT *
           FROM ld4_plans
          WHERE planned_date = $1::date
          ORDER BY created_at ASC`,
        [day]
      )
    ]);

    sendJson(res, 200, {
      active: mapActivity(activeResult.rows[0]),
      entries: entriesResult.rows.map(mapActivity),
      plans: plansResult.rows.map(mapPlan)
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/export/day.pdf") {
    const day = url.searchParams.get("day");

    if (!validDay(day)) {
      sendJson(res, 400, { error: "Data inválida." });
      return true;
    }

    await generatePdf(res, day);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/start") {
    const body = await readJson(req);
    const title = cleanTitle(body.title);
    const notes = cleanNotes(body.notes);

    if (!title) {
      sendJson(res, 400, { error: "Informe a descrição." });
      return true;
    }

    if (await getActive()) {
      sendJson(res, 409, { error: "Já existe uma atividade em andamento." });
      return true;
    }

    const id = randomUUID();

    const result = await pool.query(
      `INSERT INTO ld4_activities
        (id, title, notes, status, started_at, last_started_at, accumulated_ms, subtasks)
       VALUES ($1, $2, $3, 'active', NOW(), NOW(), 0, '[]'::jsonb)
       RETURNING *`,
      [id, title, notes]
    );

    sendJson(res, 201, { active: mapActivity(result.rows[0]) });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/active/notes") {
    const active = await getActive();

    if (!active) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    const body = await readJson(req);
    const notes = cleanNotes(body.notes);

    const result = await pool.query(
      `UPDATE ld4_activities
          SET notes = $2,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [active.id, notes]
    );

    sendJson(res, 200, { active: mapActivity(result.rows[0]) });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/active/subtasks") {
    const active = await getActive();

    if (!active) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    const body = await readJson(req);
    let subtasks;

    try {
      subtasks = cleanSubtasks(body.subtasks);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return true;
    }

    const result = await pool.query(
      `UPDATE ld4_activities
          SET subtasks = $2::jsonb,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [active.id, JSON.stringify(subtasks)]
    );

    sendJson(res, 200, { active: mapActivity(result.rows[0]) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/active/pause") {
    const active = await getActive();

    if (!active) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    if (active.status === "paused") {
      sendJson(res, 200, { active: mapActivity(active) });
      return true;
    }

    const extra = active.last_started_at
      ? Math.max(0, Date.now() - new Date(active.last_started_at).getTime())
      : 0;

    const accumulated = Number(active.accumulated_ms || 0) + extra;

    const result = await pool.query(
      `UPDATE ld4_activities
          SET status = 'paused',
              accumulated_ms = $2,
              last_started_at = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [active.id, accumulated]
    );

    sendJson(res, 200, { active: mapActivity(result.rows[0]) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/active/resume") {
    const active = await getActive();

    if (!active) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    if (active.status === "active") {
      sendJson(res, 200, { active: mapActivity(active) });
      return true;
    }

    const result = await pool.query(
      `UPDATE ld4_activities
          SET status = 'active',
              last_started_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [active.id]
    );

    sendJson(res, 200, { active: mapActivity(result.rows[0]) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/active/finish") {
    const active = await getActive();

    if (!active) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    let duration = Number(active.accumulated_ms || 0);

    if (active.status === "active" && active.last_started_at) {
      duration += Math.max(0, Date.now() - new Date(active.last_started_at).getTime());
    }

    duration = Math.max(1000, duration);

    const result = await pool.query(
      `UPDATE ld4_activities
          SET status = 'completed',
              ended_at = NOW(),
              last_started_at = NULL,
              accumulated_ms = $2,
              duration_ms = $2,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [active.id, duration]
    );

    sendJson(res, 200, { entry: mapActivity(result.rows[0]) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/manual") {
    const body = await readJson(req);
    const title = cleanTitle(body.title);
    const notes = cleanNotes(body.notes);
    const startIso = body.startIso;
    const endIso = body.endIso;

    if (!title || !validIsoDate(startIso) || !validIsoDate(endIso)) {
      sendJson(res, 400, { error: "Preencha descrição, início e fim corretamente." });
      return true;
    }

    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

    if (endMs <= startMs) {
      sendJson(res, 400, { error: "O fim precisa ser posterior ao início." });
      return true;
    }

    const id = randomUUID();
    const duration = endMs - startMs;

    const result = await pool.query(
      `INSERT INTO ld4_activities
        (
          id, title, notes, status, started_at, last_started_at,
          ended_at, accumulated_ms, duration_ms, subtasks
        )
       VALUES ($1, $2, $3, 'completed', $4::timestamptz, NULL, $5::timestamptz, $6, $6, '[]'::jsonb)
       RETURNING *`,
      [id, title, notes, startIso, endIso, duration]
    );

    sendJson(res, 201, { entry: mapActivity(result.rows[0]) });
    return true;
  }

  const entryMatch = url.pathname.match(/^\/api\/entries\/([^/]+)$/);

  if (req.method === "PUT" && entryMatch) {
    const id = decodeURIComponent(entryMatch[1]);
    const body = await readJson(req);
    const title = cleanTitle(body.title);
    const notes = cleanNotes(body.notes);
    const startIso = body.startIso;
    const endIso = body.endIso;

    if (!title || !validIsoDate(startIso) || !validIsoDate(endIso)) {
      sendJson(res, 400, { error: "Preencha descrição, início e fim corretamente." });
      return true;
    }

    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

    if (endMs <= startMs) {
      sendJson(res, 400, { error: "O fim precisa ser posterior ao início." });
      return true;
    }

    const duration = endMs - startMs;

    const result = await pool.query(
      `UPDATE ld4_activities
          SET title = $2,
              notes = $3,
              started_at = $4::timestamptz,
              ended_at = $5::timestamptz,
              accumulated_ms = $6,
              duration_ms = $6,
              updated_at = NOW()
        WHERE id = $1
          AND status = 'completed'
        RETURNING *`,
      [id, title, notes, startIso, endIso, duration]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Registro não encontrado." });
      return true;
    }

    sendJson(res, 200, { entry: mapActivity(result.rows[0]) });
    return true;
  }

  const reopenMatch = url.pathname.match(/^\/api\/entries\/([^/]+)\/reopen$/);

  if (req.method === "POST" && reopenMatch) {
    const id = decodeURIComponent(reopenMatch[1]);

    if (await getActive()) {
      sendJson(res, 409, { error: "Conclua a atividade atual antes de reabrir outra." });
      return true;
    }

    const result = await pool.query(
      `UPDATE ld4_activities
          SET status = 'active',
              ended_at = NULL,
              last_started_at = NOW(),
              accumulated_ms = COALESCE(duration_ms, accumulated_ms, 0),
              duration_ms = NULL,
              updated_at = NOW()
        WHERE id = $1
          AND status = 'completed'
        RETURNING *`,
      [id]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Registro não encontrado." });
      return true;
    }

    sendJson(res, 200, { active: mapActivity(result.rows[0]) });
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/day") {
    const day = url.searchParams.get("day");

    if (!validDay(day)) {
      sendJson(res, 400, { error: "Data inválida." });
      return true;
    }

    await pool.query(
      `DELETE FROM ld4_activities
        WHERE status = 'completed'
          AND (started_at AT TIME ZONE $1)::date = $2::date`,
      [TIME_ZONE, day]
    );

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/plans") {
    const body = await readJson(req);
    const day = String(body.day || "");
    const title = cleanTitle(body.title);
    const notes = cleanNotes(body.notes);

    if (!validDay(day) || !title) {
      sendJson(res, 400, { error: "Informe a atividade planejada." });
      return true;
    }

    const result = await pool.query(
      `INSERT INTO ld4_plans
        (id, planned_date, title, notes)
       VALUES ($1, $2::date, $3, $4)
       RETURNING *`,
      [randomUUID(), day, title, notes]
    );

    sendJson(res, 201, { plan: mapPlan(result.rows[0]) });
    return true;
  }

  const planMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);

  if (req.method === "PUT" && planMatch) {
    const id = decodeURIComponent(planMatch[1]);
    const body = await readJson(req);
    const title = cleanTitle(body.title);
    const notes = cleanNotes(body.notes);

    if (!title) {
      sendJson(res, 400, { error: "Informe a atividade planejada." });
      return true;
    }

    const result = await pool.query(
      `UPDATE ld4_plans
          SET title = $2,
              notes = $3,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, title, notes]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Planejamento não encontrado." });
      return true;
    }

    sendJson(res, 200, { plan: mapPlan(result.rows[0]) });
    return true;
  }

  if (req.method === "DELETE" && planMatch) {
    const id = decodeURIComponent(planMatch[1]);

    const result = await pool.query(
      `DELETE FROM ld4_plans
        WHERE id = $1
        RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Planejamento não encontrado." });
      return true;
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  const planStartMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/start$/);

  if (req.method === "POST" && planStartMatch) {
    const id = decodeURIComponent(planStartMatch[1]);

    if (await getActive()) {
      sendJson(res, 409, { error: "Já existe uma atividade em andamento." });
      return true;
    }

    const planResult = await pool.query(
      `SELECT *
         FROM ld4_plans
        WHERE id = $1
        LIMIT 1`,
      [id]
    );

    const plan = planResult.rows[0];

    if (!plan) {
      sendJson(res, 404, { error: "Planejamento não encontrado." });
      return true;
    }

    const activityId = randomUUID();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const activityResult = await client.query(
        `INSERT INTO ld4_activities
          (id, title, notes, status, started_at, last_started_at, accumulated_ms, subtasks)
         VALUES ($1, $2, $3, 'active', NOW(), NOW(), 0, '[]'::jsonb)
         RETURNING *`,
        [activityId, plan.title, plan.notes || ""]
      );

      await client.query(
        `DELETE FROM ld4_plans WHERE id = $1`,
        [id]
      );

      await client.query("COMMIT");

      sendJson(res, 201, {
        active: mapActivity(activityResult.rows[0])
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/enam") {
      res.writeHead(308, {
        "Location": "/enam/",
        "Cache-Control": "no-store"
      });
      res.end();
      return;
    }

    if (url.pathname === "/financeiro") {
      res.writeHead(308, {
        "Location": "/financeiro/",
        "Cache-Control": "no-store"
      });
      res.end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);

      if (!handled) {
        sendJson(res, 404, { error: "Rota não encontrada." });
      }

      return;
    }

    const filePath = safePublicPath(url.pathname);

    if (!filePath) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Acesso negado.");
      return;
    }

    fs.stat(filePath, (error, stat) => {
      if (error || !stat.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Arquivo não encontrado.");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();

      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
      });

      fs.createReadStream(filePath).pipe(res);
    });
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      sendJson(res, 500, { error: error.message || "Erro interno do servidor." });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Linha do Dia ouvindo na porta ${PORT}`);
});

initDatabase()
  .then(() => {
    console.log("Linha do Dia pronta.");
  })
  .catch(error => {
    console.error("Falha ao preparar banco:", error);
  });
