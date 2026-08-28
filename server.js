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
