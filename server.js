const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { pool, initDatabase } = require("./db");

const PORT = process.env.PORT || 3000;
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
        reject(new Error("Corpo da requisição muito grande."));
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

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

function sanitizeNotes(value) {
  return String(value || "").slice(0, 12000);
}

function sanitizeSubtasks(value) {
  if (!Array.isArray(value)) {
    throw new Error("Checklist inválido.");
  }

  if (value.length > 100) {
    throw new Error("Limite de 100 subatividades por bloco.");
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

async function getActivityById(id) {
  const result = await pool.query(
    `SELECT a.*, COALESCE(n.notes, '') AS notes
       FROM activities a
       LEFT JOIN activity_notes n ON n.activity_id = a.id
      WHERE a.id = $1
      LIMIT 1`,
    [id]
  );

  return result.rows[0] || null;
}

async function getActive() {
  const result = await pool.query(
    `SELECT a.*, COALESCE(n.notes, '') AS notes
       FROM activities a
       LEFT JOIN activity_notes n ON n.activity_id = a.id
      WHERE a.status IN ('active', 'paused')
      ORDER BY a.started_at DESC
      LIMIT 1`
  );

  return result.rows[0] || null;
}

function safeFilePath(urlPath) {
  const cleanPath = decodeURIComponent((urlPath || "/").split("?")[0]);
  let requested = cleanPath === "/" ? "/index.html" : cleanPath;

  if (cleanPath === "/enam" || cleanPath === "/enam/") {
    requested = "/enam/index.html";
  }

  const resolved = path.normalize(path.join(PUBLIC_DIR, requested));

  return resolved.startsWith(PUBLIC_DIR) ? resolved : null;
}

function formatDayLabel(day) {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

function formatPdfClock(value) {
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

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}min`;
  if (minutes > 0) return `${minutes} min`;
  return `${totalSeconds} s`;
}

function formatTotal(milliseconds) {
  const totalMinutes = Math.floor(Number(milliseconds || 0) / 60000);

  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

async function exportDayPdf(res, day) {
  // Carregamento tardio: o PDFKit não participa da inicialização da aplicação.
  const PDFDocument = require("pdfkit");

  const result = await pool.query(
    `SELECT a.*, COALESCE(n.notes, '') AS notes
       FROM activities a
       LEFT JOIN activity_notes n ON n.activity_id = a.id
      WHERE a.status = 'completed'
        AND (a.started_at AT TIME ZONE $1)::date = $2::date
      ORDER BY a.started_at ASC`,
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
    margins: { top: 54, right: 54, bottom: 54, left: 54 },
    info: {
      Title: `Linha do Dia - ${formatDayLabel(day)}`,
      Author: "Linha do Dia"
    }
  });

  doc.pipe(res);

  doc.fillColor("#222222").font("Helvetica-Bold").fontSize(20).text("Linha do Dia");
  doc.moveDown(0.25).font("Helvetica").fontSize(10).fillColor("#666666").text(formatDayLabel(day));
  doc.moveDown(0.25).text(`Tempo total registrado: ${formatTotal(total)}`);
  doc.moveDown(1.2);

  if (!rows.length) {
    doc.font("Helvetica").fontSize(11).fillColor("#555555")
      .text("Nenhuma atividade registrada neste dia.");
    doc.end();
    return;
  }

  rows.forEach((row, index) => {
    if (index > 0) doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#444444")
      .text(`${formatPdfClock(row.started_at)} - ${formatPdfClock(row.ended_at)}   ${formatDuration(row.duration_ms)}`);

    doc.moveDown(0.25).font("Helvetica-Bold").fontSize(12).fillColor("#222222")
      .text(row.title, { lineGap: 2 });

    const subtasks = Array.isArray(row.subtasks) ? row.subtasks : [];

    if (subtasks.length) {
      doc.moveDown(0.35);

      subtasks.forEach(subtask => {
        doc.font("Helvetica").fontSize(9.5)
          .fillColor(subtask.done ? "#777777" : "#333333")
          .text(`${subtask.done ? "[x]" : "[ ]"} ${subtask.text}`, {
            indent: 10,
            lineGap: 1.5
          });
      });
    }

    const notes = String(row.notes || "").trim();

    if (notes) {
      doc.moveDown(0.45).font("Helvetica-Bold").fontSize(9.5).fillColor("#555555")
        .text("Anotações:");

      doc.moveDown(0.15).font("Helvetica").fontSize(9.5).fillColor("#444444")
        .text(notes, { indent: 10, lineGap: 2 });
    }

    if (index < rows.length - 1) {
      doc.moveDown(0.8);
      const y = doc.y;
      doc.moveTo(doc.page.margins.left, y)
        .lineTo(doc.page.width - doc.page.margins.right, y)
        .strokeColor("#dddddd")
        .lineWidth(0.7)
        .stroke();
    }
  });

  doc.end();
}

async function handleApi(req, res, url) {

  // Portal ENAM 2026.2
  if (req.method === "GET" && url.pathname === "/api/enam/meta") {
    sendJson(res, 200, {
      authRequired: false,
      authenticated: true,
      persistence: "database"
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/enam/state") {
    const result = await pool.query(
      `SELECT data
         FROM enam_portal_state
        WHERE id = 'main'
        LIMIT 1`
    );

    sendJson(res, 200, result.rows[0]?.data || {});
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/enam/state") {
    const body = await readJson(req);

    await pool.query(
      `INSERT INTO enam_portal_state (id, data, updated_at)
       VALUES ('main', $1::jsonb, NOW())
       ON CONFLICT (id)
       DO UPDATE SET data = EXCLUDED.data,
                     updated_at = NOW()`,
      [JSON.stringify(body || {})]
    );

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

    if (!validDateKey(day)) {
      sendJson(res, 400, { error: "Data inválida." });
      return true;
    }

    const [activeResult, completedResult] = await Promise.all([
      pool.query(
        `SELECT a.*, COALESCE(n.notes, '') AS notes
           FROM activities a
           LEFT JOIN activity_notes n ON n.activity_id = a.id
          WHERE a.status IN ('active', 'paused')
          ORDER BY a.started_at DESC
          LIMIT 1`
      ),
      pool.query(
        `SELECT a.*, COALESCE(n.notes, '') AS notes
           FROM activities a
           LEFT JOIN activity_notes n ON n.activity_id = a.id
          WHERE a.status = 'completed'
            AND (a.started_at AT TIME ZONE $1)::date = $2::date
          ORDER BY a.started_at ASC`,
        [TIME_ZONE, day]
      )
    ]);

    sendJson(res, 200, {
      active: mapActivity(activeResult.rows[0]),
      entries: completedResult.rows.map(mapActivity)
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/export/day.pdf") {
    const day = url.searchParams.get("day");

    if (!validDateKey(day)) {
      sendJson(res, 400, { error: "Data inválida." });
      return true;
    }

    await exportDayPdf(res, day);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/start") {
    const body = await readJson(req);
    const title = String(body.title || "").trim().slice(0, 500);
    const notes = sanitizeNotes(body.notes);

    if (!title) {
      sendJson(res, 400, { error: "Informe a descrição da atividade." });
      return true;
    }

    const existing = await getActive();

    if (existing) {
      sendJson(res, 409, { error: "Já existe uma atividade em andamento." });
      return true;
    }

    const id = randomUUID();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO activities
          (id, title, status, started_at, last_started_at, accumulated_ms, subtasks)
         VALUES ($1, $2, 'active', NOW(), NOW(), 0, '[]'::jsonb)`,
        [id, title]
      );

      if (notes) {
        await client.query(
          `INSERT INTO activity_notes (activity_id, notes, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (activity_id)
           DO UPDATE SET notes = EXCLUDED.notes, updated_at = NOW()`,
          [id, notes]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    sendJson(res, 201, { active: mapActivity(await getActivityById(id)) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/pause") {
    const row = await getActive();

    if (!row) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    if (row.status !== "paused") {
      const extra = row.last_started_at
        ? Math.max(0, Date.now() - new Date(row.last_started_at).getTime())
        : 0;

      const accumulated = Number(row.accumulated_ms || 0) + extra;

      await pool.query(
        `UPDATE activities
            SET status = 'paused',
                accumulated_ms = $2,
                last_started_at = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [row.id, accumulated]
      );
    }

    sendJson(res, 200, { active: mapActivity(await getActivityById(row.id)) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/resume") {
    const row = await getActive();

    if (!row) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    if (row.status !== "active") {
      await pool.query(
        `UPDATE activities
            SET status = 'active',
                last_started_at = NOW(),
                updated_at = NOW()
          WHERE id = $1`,
        [row.id]
      );
    }

    sendJson(res, 200, { active: mapActivity(await getActivityById(row.id)) });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/subtasks") {
    const row = await getActive();

    if (!row) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    const body = await readJson(req);
    let subtasks;

    try {
      subtasks = sanitizeSubtasks(body.subtasks);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return true;
    }

    await pool.query(
      `UPDATE activities
          SET subtasks = $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [row.id, JSON.stringify(subtasks)]
    );

    sendJson(res, 200, { active: mapActivity(await getActivityById(row.id)) });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/notes") {
    const row = await getActive();

    if (!row) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    const body = await readJson(req);
    const notes = sanitizeNotes(body.notes);

    await pool.query(
      `INSERT INTO activity_notes (activity_id, notes, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (activity_id)
       DO UPDATE SET notes = EXCLUDED.notes, updated_at = NOW()`,
      [row.id, notes]
    );

    sendJson(res, 200, { active: mapActivity(await getActivityById(row.id)) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/finish") {
    const row = await getActive();

    if (!row) {
      sendJson(res, 404, { error: "Nenhuma atividade em andamento." });
      return true;
    }

    let duration = Number(row.accumulated_ms || 0);

    if (row.status === "active" && row.last_started_at) {
      duration += Math.max(0, Date.now() - new Date(row.last_started_at).getTime());
    }

    duration = Math.max(1000, duration);

    await pool.query(
      `UPDATE activities
          SET status = 'completed',
              ended_at = NOW(),
              last_started_at = NULL,
              accumulated_ms = $2,
              duration_ms = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [row.id, duration]
    );

    sendJson(res, 200, { entry: mapActivity(await getActivityById(row.id)) });
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/day") {
    const day = url.searchParams.get("day");

    if (!validDateKey(day)) {
      sendJson(res, 400, { error: "Data inválida." });
      return true;
    }

    const ids = await pool.query(
      `SELECT id
         FROM activities
        WHERE status = 'completed'
          AND (started_at AT TIME ZONE $1)::date = $2::date`,
      [TIME_ZONE, day]
    );

    const activityIds = ids.rows.map(row => row.id);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (activityIds.length) {
        await client.query(
          `DELETE FROM activity_notes WHERE activity_id = ANY($1::text[])`,
          [activityIds]
        );
      }

      await client.query(
        `DELETE FROM activities
          WHERE status = 'completed'
            AND (started_at AT TIME ZONE $1)::date = $2::date`,
        [TIME_ZONE, day]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);

      if (!handled) {
        sendJson(res, 404, { error: "Rota não encontrada." });
      }

      return;
    }

    const filePath = safeFilePath(url.pathname);

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

      const extension = path.extname(filePath).toLowerCase();

      res.writeHead(200, {
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
        "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600"
      });

      fs.createReadStream(filePath).pipe(res);
    });
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      sendJson(res, 500, { error: "Erro interno do servidor." });
    } else {
      res.end();
    }
  }
});

initDatabase()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Linha do Dia rodando na porta ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Falha ao iniciar o banco de dados:", error);
    process.exit(1);
  });
