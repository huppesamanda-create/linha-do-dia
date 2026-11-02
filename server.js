const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { pool, initDatabase } = require("./db");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

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

function validScope(value) {
  return value === "pj" ? "pj" : "pf";
}

function requestScope(url, body = null) {
  return validScope(body?.scope || url.searchParams.get("scope"));
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

  if (
    !validFinanceYear(year) ||
    !validFinanceMonth(month) ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function financeDateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function validMonthKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  return validFinanceYear(Number(match[1])) && validFinanceMonth(Number(match[2]));
}

function daysInFinanceMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function cleanDescription(value) {
  return String(value || "").trim().slice(0, 500);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function marketHolidayKeys(year) {
  const keys = new Set();
  const fixed = [
    [1, 1], [4, 21], [5, 1], [9, 7], [10, 12],
    [11, 2], [11, 15], [11, 20], [12, 25]
  ];

  fixed.forEach(([month, day]) => {
    keys.add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  });

  const easter = easterSunday(year);
  [
    addUtcDays(easter, -48),
    addUtcDays(easter, -47),
    addUtcDays(easter, -2),
    addUtcDays(easter, 60)
  ].forEach(date => {
    keys.add([
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0")
    ].join("-"));
  });

  return keys;
}

function businessDays252(startText, endText) {
  const start = new Date(`${startText}T00:00:00Z`);
  const end = new Date(`${endText}T00:00:00Z`);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    return 0;
  }

  let current = new Date(start.getTime());
  let count = 0;
  const holidayCache = new Map();

  while (current < end) {
    const year = current.getUTCFullYear();
    if (!holidayCache.has(year)) holidayCache.set(year, marketHolidayKeys(year));

    const weekday = current.getUTCDay();
    const key = [
      year,
      String(current.getUTCMonth() + 1).padStart(2, "0"),
      String(current.getUTCDate()).padStart(2, "0")
    ].join("-");

    if (weekday !== 0 && weekday !== 6 && !holidayCache.get(year).has(key)) count += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return count;
}

function projectedTreasuryValue(amount, rate, purchaseDate, maturityDate) {
  const principal = Number(amount);
  const annualRate = Number(rate);

  if (
    !Number.isFinite(principal) ||
    principal <= 0 ||
    !Number.isFinite(annualRate) ||
    annualRate <= -100 ||
    !purchaseDate ||
    !maturityDate
  ) {
    return principal || 0;
  }

  const businessDays = businessDays252(purchaseDate, maturityDate);
  return principal * Math.pow(1 + annualRate / 100, businessDays / 252);
}

async function syncRecurringTransactions(scope, year) {
  if (!validFinanceYear(year)) return;

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-01`;

  const result = await pool.query(
    `SELECT
       id, category_id, name, amount, day_of_month,
       TO_CHAR(start_month, 'YYYY-MM') AS start_month,
       CASE WHEN end_month IS NULL THEN NULL ELSE TO_CHAR(end_month, 'YYYY-MM') END AS end_month
     FROM ld4_finance_recurring_rules
     WHERE owner_scope = $1
       AND active = TRUE
       AND start_month <= $3::date
       AND (end_month IS NULL OR end_month >= $2::date)
     ORDER BY created_at`,
    [scope, yearStart, yearEnd]
  );

  for (const rule of result.rows) {
    for (let month = 1; month <= 12; month++) {
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      if (monthKey < rule.start_month) continue;
      if (rule.end_month && monthKey > rule.end_month) continue;

      const day = Math.min(Number(rule.day_of_month), daysInFinanceMonth(year, month));
      const dateKey = financeDateKey(year, month, day);

      await pool.query(
        `INSERT INTO ld4_finance_transactions
          (
            id, transaction_date, type, nature, amount, category_id,
            status, description, recurring_rule_id, owner_scope
          )
         SELECT
           $1, $2::date, 'expense', 'fixed', $3, $4,
           'provisioned', $5, $6, $7
         WHERE NOT EXISTS (
           SELECT 1
           FROM ld4_finance_recurring_skips
           WHERE recurring_rule_id = $6
             AND skipped_date = $2::date
         )
         ON CONFLICT (recurring_rule_id, transaction_date)
         WHERE recurring_rule_id IS NOT NULL
         DO NOTHING`,
        [randomUUID(), dateKey, Number(rule.amount), rule.category_id, rule.name, rule.id, scope]
      );
    }
  }
}

async function investmentSnapshot(scope, year) {
  const yearEnd = `${year + 1}-01-01`;

  const [accountsResult, transfersResult, valuationsResult] = await Promise.all([
    pool.query(
      `SELECT
         id, name, opening_balance, sort_order, active, system_key, asset_type,
         TO_CHAR(maturity_date, 'YYYY-MM-DD') AS maturity_date, default_rate
       FROM ld4_finance_reserve_accounts
       WHERE owner_scope = $1
         AND active = TRUE
       ORDER BY sort_order, name`,
      [scope]
    ),
    pool.query(
      `SELECT
         t.id, TO_CHAR(t.transfer_date, 'YYYY-MM-DD') AS transfer_date,
         t.account_id, t.direction, t.amount, t.status, t.description,
         t.contracted_rate, TO_CHAR(t.maturity_date, 'YYYY-MM-DD') AS maturity_date
       FROM ld4_finance_reserve_transfers t
       JOIN ld4_finance_reserve_accounts a ON a.id = t.account_id
       WHERE a.owner_scope = $1
         AND t.transfer_date < $2::date
       ORDER BY t.transfer_date, t.created_at`,
      [scope, yearEnd]
    ),
    pool.query(
      `SELECT
         v.id, v.account_id, TO_CHAR(v.valuation_date, 'YYYY-MM-DD') AS valuation_date,
         v.current_value
       FROM ld4_finance_investment_valuations v
       JOIN ld4_finance_reserve_accounts a ON a.id = v.account_id
       WHERE a.owner_scope = $1
         AND v.valuation_date < $2::date
       ORDER BY v.valuation_date, v.created_at`,
      [scope, yearEnd]
    )
  ]);

  return accountsResult.rows.map(row => {
    const openingBalance = Number(row.opening_balance || 0);

    const transfers = transfersResult.rows
      .filter(item => item.account_id === row.id)
      .map(item => ({
        id: item.id,
        date: isoDate(item.transfer_date),
        direction: item.direction,
        amount: Number(item.amount || 0),
        status: item.status,
        description: item.description || "",
        contractedRate: numberOrNull(item.contracted_rate),
        maturityDate: isoDate(item.maturity_date || row.maturity_date)
      }));

    const realized = transfers.filter(item => item.status === "realized");
    const realizedTo = realized
      .filter(item => item.direction === "to_reserve")
      .reduce((sum, item) => sum + item.amount, 0);
    const realizedFrom = realized
      .filter(item => item.direction === "from_reserve")
      .reduce((sum, item) => sum + item.amount, 0);

    const contributed = openingBalance + realizedTo - realizedFrom;

    const valuations = valuationsResult.rows
      .filter(item => item.account_id === row.id)
      .map(item => ({
        id: item.id,
        date: isoDate(item.valuation_date),
        currentValue: Number(item.current_value || 0)
      }));

    const latestValuation = valuations.length ? valuations[valuations.length - 1] : null;
    let currentValue = contributed;

    if (latestValuation) {
      const laterNet = realized
        .filter(item => item.date > latestValuation.date)
        .reduce((sum, item) => {
          return sum + (item.direction === "to_reserve" ? item.amount : -item.amount);
        }, 0);

      currentValue = latestValuation.currentValue + laterNet;
    }

    const lots = realized
      .filter(item => item.direction === "to_reserve")
      .map(item => {
        const rate = item.contractedRate ?? numberOrNull(row.default_rate);
        const maturityDate = item.maturityDate || isoDate(row.maturity_date);

        return {
          ...item,
          rate,
          maturityDate,
          projectedMaturityValue: row.asset_type === "treasury_fixed"
            ? projectedTreasuryValue(item.amount, rate, item.date, maturityDate)
            : item.amount
        };
      });

    let projectedMaturityValue = contributed;

    if (row.asset_type === "treasury_fixed") {
      projectedMaturityValue =
        openingBalance +
        lots.reduce((sum, lot) => sum + lot.projectedMaturityValue, 0) -
        realizedFrom;
    }

    const denominator = lots.reduce((sum, lot) => sum + lot.amount, 0);
    const weightedRate = denominator
      ? lots.reduce((sum, lot) => sum + lot.amount * Number(lot.rate || 0), 0) / denominator
      : numberOrNull(row.default_rate);

    return {
      id: row.id,
      name: row.name,
      sortOrder: Number(row.sort_order || 0),
      systemKey: row.system_key || null,
      assetType: row.asset_type || "cash",
      maturityDate: isoDate(row.maturity_date),
      defaultRate: numberOrNull(row.default_rate),
      weightedRate,
      openingBalance,
      contributed,
      currentValue,
      projectedMaturityValue,
      lots,
      valuations
    };
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    await pool.query("SELECT 1");
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/finance/investments") {
    const year = Number(url.searchParams.get("year"));
    const scope = requestScope(url);

    if (!validFinanceYear(year)) {
      sendJson(res, 400, { error: "Ano inválido." });
      return true;
    }

    const accounts = await investmentSnapshot(scope, year);
    sendJson(res, 200, { year, scope, accounts });
    return true;
  }

  const valuationMatch = url.pathname.match(/^\/api\/finance\/reserve-accounts\/([^/]+)\/valuation$/);

  if (req.method === "PUT" && valuationMatch) {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const accountId = decodeURIComponent(valuationMatch[1]);
    const currentValue = Number(body.currentValue);
    const valuationDate = String(body.valuationDate || "");

    if (!Number.isFinite(currentValue) || currentValue < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(valuationDate)) {
      sendJson(res, 400, { error: "Posição atual inválida." });
      return true;
    }

    const accountResult = await pool.query(
      `SELECT id
       FROM ld4_finance_reserve_accounts
       WHERE id = $1
         AND owner_scope = $2
         AND active = TRUE
       LIMIT 1`,
      [accountId, scope]
    );

    if (!accountResult.rows.length) {
      sendJson(res, 404, { error: "Destino não encontrado." });
      return true;
    }

    await pool.query(
      `INSERT INTO ld4_finance_investment_valuations
        (id, account_id, valuation_date, current_value)
       VALUES ($1, $2, $3::date, $4)
       ON CONFLICT (account_id, valuation_date)
       DO UPDATE SET current_value = EXCLUDED.current_value`,
      [randomUUID(), accountId, valuationDate, currentValue]
    );

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/finance/state") {
    const year = Number(url.searchParams.get("year"));
    const scope = requestScope(url);

    if (!validFinanceYear(year)) {
      sendJson(res, 400, { error: "Ano inválido." });
      return true;
    }

    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;

    await syncRecurringTransactions(scope, year);

    const [
      transactionsResult,
      categoriesResult,
      budgetsResult,
      yearResult,
      reserveAccountsResult,
      reserveTransfersResult,
      recurringRulesResult
    ] = await Promise.all([
      pool.query(
        `SELECT
           id, TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date,
           type, nature, amount, category_id, status, description, recurring_rule_id
         FROM ld4_finance_transactions
         WHERE owner_scope = $1
           AND transaction_date >= $2::date
           AND transaction_date < $3::date
         ORDER BY transaction_date, created_at`,
        [scope, start, end]
      ),
      pool.query(
        `SELECT id, name, sort_order
         FROM ld4_finance_categories
         WHERE owner_scope = $1
           AND active = TRUE
         ORDER BY sort_order, name`,
        [scope]
      ),
      pool.query(
        `SELECT year, month, category_id, amount
         FROM ld4_finance_budgets
         WHERE owner_scope = $1
           AND year = $2
         ORDER BY month, category_id`,
        [scope, year]
      ),
      pool.query(
        `SELECT year, opening_balance, warning_threshold
         FROM ld4_finance_years
         WHERE owner_scope = $1
           AND year = $2
         LIMIT 1`,
        [scope, year]
      ),
      pool.query(
        `SELECT
           a.id, a.name, a.opening_balance, a.sort_order,
           a.system_key, a.asset_type,
           TO_CHAR(a.maturity_date, 'YYYY-MM-DD') AS maturity_date,
           a.default_rate,
           a.opening_balance + COALESCE(SUM(
             CASE
               WHEN t.transfer_date < $2::date AND t.status = 'realized'
               THEN CASE WHEN t.direction = 'to_reserve' THEN t.amount ELSE -t.amount END
               ELSE 0
             END
           ), 0) AS opening_real,
           a.opening_balance + COALESCE(SUM(
             CASE
               WHEN t.transfer_date < $2::date
               THEN CASE WHEN t.direction = 'to_reserve' THEN t.amount ELSE -t.amount END
               ELSE 0
             END
           ), 0) AS opening_projected
         FROM ld4_finance_reserve_accounts a
         LEFT JOIN ld4_finance_reserve_transfers t ON t.account_id = a.id
         WHERE a.owner_scope = $1
           AND a.active = TRUE
         GROUP BY
           a.id, a.name, a.opening_balance, a.sort_order,
           a.system_key, a.asset_type, a.maturity_date, a.default_rate
         ORDER BY a.sort_order, a.name`,
        [scope, start]
      ),
      pool.query(
        `SELECT
           t.id, TO_CHAR(t.transfer_date, 'YYYY-MM-DD') AS transfer_date,
           t.account_id, t.direction, t.amount, t.status, t.description,
           t.contracted_rate, TO_CHAR(t.maturity_date, 'YYYY-MM-DD') AS maturity_date
         FROM ld4_finance_reserve_transfers t
         JOIN ld4_finance_reserve_accounts a ON a.id = t.account_id
         WHERE a.owner_scope = $1
           AND t.transfer_date >= $2::date
           AND t.transfer_date < $3::date
         ORDER BY t.transfer_date, t.created_at`,
        [scope, start, end]
      ),
      pool.query(
        `SELECT
           id, category_id, name, amount, day_of_month, frequency,
           TO_CHAR(start_month, 'YYYY-MM') AS start_month,
           CASE WHEN end_month IS NULL THEN NULL ELSE TO_CHAR(end_month, 'YYYY-MM') END AS end_month,
           active
         FROM ld4_finance_recurring_rules
         WHERE owner_scope = $1
           AND active = TRUE
         ORDER BY category_id, day_of_month, name`,
        [scope]
      )
    ]);

    const transactions = transactionsResult.rows.map(row => {
      const [y, m, d] = String(row.transaction_date).split("-").map(Number);
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
        description: row.description || "",
        recurringRuleId: row.recurring_rule_id || null
      };
    });

    sendJson(res, 200, {
      year,
      scope,
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
      transactions,
      reserveAccounts: reserveAccountsResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        openingBalance: Number(row.opening_balance || 0),
        openingReal: Number(row.opening_real || 0),
        openingProjected: Number(row.opening_projected || 0),
        sortOrder: Number(row.sort_order || 0),
        systemKey: row.system_key || null,
        assetType: row.asset_type || "cash",
        maturityDate: isoDate(row.maturity_date),
        defaultRate: numberOrNull(row.default_rate)
      })),
      reserveTransfers: reserveTransfersResult.rows.map(row => {
        const [y, m, d] = String(row.transfer_date).split("-").map(Number);
        return {
          id: row.id,
          year: y,
          month: m - 1,
          day: d,
          account: row.account_id,
          direction: row.direction,
          value: Number(row.amount || 0),
          status: row.status,
          description: row.description || "",
          contractedRate: numberOrNull(row.contracted_rate),
          maturityDate: isoDate(row.maturity_date)
        };
      }),
      recurringRules: recurringRulesResult.rows.map(row => ({
        id: row.id,
        category: row.category_id,
        name: row.name,
        value: Number(row.amount || 0),
        day: Number(row.day_of_month),
        frequency: row.frequency,
        startMonth: row.start_month,
        endMonth: row.end_month,
        active: Boolean(row.active)
      }))
    });

    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/finance/year") {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const year = Number(body.year);
    const openingBalance = Number(body.openingBalance);
    const warningThreshold = Number(body.warningThreshold);

    if (
      !validFinanceYear(year) ||
      !Number.isFinite(openingBalance) ||
      !Number.isFinite(warningThreshold) ||
      warningThreshold < 0
    ) {
      sendJson(res, 400, { error: "Configuração financeira inválida." });
      return true;
    }

    const result = await pool.query(
      `INSERT INTO ld4_finance_years
        (owner_scope, year, opening_balance, warning_threshold, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (owner_scope, year)
       DO UPDATE SET
         opening_balance = EXCLUDED.opening_balance,
         warning_threshold = EXCLUDED.warning_threshold,
         updated_at = NOW()
       RETURNING year, opening_balance, warning_threshold`,
      [scope, year, openingBalance, warningThreshold]
    );

    sendJson(res, 200, {
      year: Number(result.rows[0].year),
      openingBalance: Number(result.rows[0].opening_balance),
      warningThreshold: Number(result.rows[0].warning_threshold)
    });

    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/finance/budget") {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const year = Number(body.year);
    const month = Number(body.month) + 1;
    const category = String(body.category || "");
    const amount = Math.max(0, Number(body.amount || 0));

    if (!validFinanceYear(year) || !validFinanceMonth(month) || !category || !Number.isFinite(amount)) {
      sendJson(res, 400, { error: "Orçamento inválido." });
      return true;
    }

    const categoryResult = await pool.query(
      `SELECT id
       FROM ld4_finance_categories
       WHERE id = $1
         AND owner_scope = $2
         AND active = TRUE
       LIMIT 1`,
      [category, scope]
    );

    if (!categoryResult.rows.length) {
      sendJson(res, 404, { error: "Categoria não encontrada." });
      return true;
    }

    await pool.query(
      `INSERT INTO ld4_finance_budgets
        (owner_scope, year, month, category_id, amount, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (owner_scope, year, month, category_id)
       DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()`,
      [scope, year, month, category, amount]
    );

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/finance/categories") {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const name = String(body.name || "").trim().slice(0, 120);

    if (!name) {
      sendJson(res, 400, { error: "Informe o nome da categoria." });
      return true;
    }

    const duplicate = await pool.query(
      `SELECT id
       FROM ld4_finance_categories
       WHERE owner_scope = $1
         AND LOWER(name) = LOWER($2)
       LIMIT 1`,
      [scope, name]
    );

    if (duplicate.rows.length) {
      sendJson(res, 409, { error: "Já existe uma categoria com esse nome." });
      return true;
    }

    const orderResult = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
       FROM ld4_finance_categories
       WHERE owner_scope = $1`,
      [scope]
    );

    const result = await pool.query(
      `INSERT INTO ld4_finance_categories
        (id, name, sort_order, active, owner_scope, created_at, updated_at)
       VALUES ($1, $2, $3, TRUE, $4, NOW(), NOW())
       RETURNING id, name, sort_order`,
      [randomUUID(), name, Number(orderResult.rows[0]?.next_order || 10), scope]
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

  const categoryMatch = url.pathname.match(/^\/api\/finance\/categories\/([^/]+)$/);

  if (req.method === "PUT" && categoryMatch) {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const id = decodeURIComponent(categoryMatch[1]);
    const name = String(body.name || "").trim().slice(0, 120);

    if (!name) {
      sendJson(res, 400, { error: "Informe o nome da categoria." });
      return true;
    }

    const duplicate = await pool.query(
      `SELECT id
       FROM ld4_finance_categories
       WHERE owner_scope = $1
         AND LOWER(name) = LOWER($2)
         AND id <> $3
       LIMIT 1`,
      [scope, name, id]
    );

    if (duplicate.rows.length) {
      sendJson(res, 409, { error: "Já existe uma categoria com esse nome." });
      return true;
    }

    const result = await pool.query(
      `UPDATE ld4_finance_categories
       SET name = $3, updated_at = NOW()
       WHERE id = $1
         AND owner_scope = $2
         AND active = TRUE
       RETURNING id, name, sort_order`,
      [id, scope, name]
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

  if (req.method === "POST" && url.pathname === "/api/finance/transactions") {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const year = Number(body.year);
    const month = Number(body.month) + 1;
    const day = Number(body.day);
    const type = String(body.type || "");
    const nature = type === "expense" ? String(body.nature || "") : null;
    const amount = Number(body.value);
    const category = type === "expense" ? String(body.category || "") : null;
    const status = String(body.status || "");
    const description = cleanDescription(body.description);

    if (
      !validFinanceDate(year, month, day) ||
      !["income", "expense"].includes(type) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !["provisioned", "realized"].includes(status)
    ) {
      sendJson(res, 400, { error: "Lançamento inválido." });
      return true;
    }

    if (type === "expense") {
      if (!["fixed", "daily"].includes(nature) || !category) {
        sendJson(res, 400, { error: "Informe o tipo de saída e a categoria." });
        return true;
      }

      const categoryResult = await pool.query(
        `SELECT id FROM ld4_finance_categories
         WHERE id = $1 AND owner_scope = $2 AND active = TRUE LIMIT 1`,
        [category, scope]
      );

      if (!categoryResult.rows.length) {
        sendJson(res, 404, { error: "Categoria não encontrada." });
        return true;
      }
    }

    const result = await pool.query(
      `INSERT INTO ld4_finance_transactions
        (id, transaction_date, type, nature, amount, category_id, status, description, owner_scope)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        randomUUID(),
        financeDateKey(year, month, day),
        type,
        nature,
        amount,
        category,
        status,
        description,
        scope
      ]
    );

    sendJson(res, 201, { id: result.rows[0].id });
    return true;
  }

  const transactionMatch = url.pathname.match(/^\/api\/finance\/transactions\/([^/]+)$/);

  if (req.method === "PUT" && transactionMatch) {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const id = decodeURIComponent(transactionMatch[1]);
    const year = Number(body.year);
    const month = Number(body.month) + 1;
    const day = Number(body.day);
    const type = String(body.type || "");
    const nature = type === "expense" ? String(body.nature || "") : null;
    const amount = Number(body.value);
    const category = type === "expense" ? String(body.category || "") : null;
    const status = String(body.status || "");
    const description = cleanDescription(body.description);

    if (
      !validFinanceDate(year, month, day) ||
      !["income", "expense"].includes(type) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !["provisioned", "realized"].includes(status)
    ) {
      sendJson(res, 400, { error: "Lançamento inválido." });
      return true;
    }

    const result = await pool.query(
      `UPDATE ld4_finance_transactions
       SET transaction_date = $3::date,
           type = $4,
           nature = $5,
           amount = $6,
           category_id = $7,
           status = $8,
           description = $9,
           updated_at = NOW()
       WHERE id = $1
         AND owner_scope = $2
       RETURNING id`,
      [
        id,
        scope,
        financeDateKey(year, month, day),
        type,
        nature,
        amount,
        category,
        status,
        description
      ]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Lançamento não encontrado." });
      return true;
    }

    sendJson(res, 200, { id: result.rows[0].id });
    return true;
  }

  if (req.method === "DELETE" && transactionMatch) {
    const scope = requestScope(url);
    const id = decodeURIComponent(transactionMatch[1]);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT id, recurring_rule_id, TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date
         FROM ld4_finance_transactions
         WHERE id = $1 AND owner_scope = $2
         LIMIT 1`,
        [id, scope]
      );

      if (!existing.rows.length) {
        await client.query("ROLLBACK");
        sendJson(res, 404, { error: "Lançamento não encontrado." });
        return true;
      }

      const row = existing.rows[0];

      if (row.recurring_rule_id) {
        await client.query(
          `INSERT INTO ld4_finance_recurring_skips
            (recurring_rule_id, skipped_date, created_at)
           VALUES ($1, $2::date, NOW())
           ON CONFLICT (recurring_rule_id, skipped_date) DO NOTHING`,
          [row.recurring_rule_id, row.transaction_date]
        );
      }

      await client.query(
        `DELETE FROM ld4_finance_transactions WHERE id = $1 AND owner_scope = $2`,
        [id, scope]
      );

      await client.query("COMMIT");
      sendJson(res, 200, {
        ok: true,
        skippedRecurringMonth: Boolean(row.recurring_rule_id)
      });
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (req.method === "POST" && url.pathname === "/api/finance/reserve-accounts") {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const name = String(body.name || "").trim().slice(0, 120);
    const openingBalance = Number(body.openingBalance || 0);

    if (!name || !Number.isFinite(openingBalance) || openingBalance < 0) {
      sendJson(res, 400, { error: "Reserva inválida." });
      return true;
    }

    const duplicate = await pool.query(
      `SELECT id FROM ld4_finance_reserve_accounts
       WHERE owner_scope = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [scope, name]
    );

    if (duplicate.rows.length) {
      sendJson(res, 409, { error: "Já existe uma reserva com esse nome." });
      return true;
    }

    const orderResult = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
       FROM ld4_finance_reserve_accounts
       WHERE owner_scope = $1`,
      [scope]
    );

    const result = await pool.query(
      `INSERT INTO ld4_finance_reserve_accounts
        (id, name, opening_balance, sort_order, active, owner_scope, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, $5, NOW(), NOW())
       RETURNING id, name, opening_balance, sort_order`,
      [randomUUID(), name, openingBalance, Number(orderResult.rows[0]?.next_order || 10), scope]
    );

    sendJson(res, 201, {
      account: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        openingBalance: Number(result.rows[0].opening_balance || 0),
        sortOrder: Number(result.rows[0].sort_order || 0)
      }
    });

    return true;
  }

  const reserveAccountMatch = url.pathname.match(/^\/api\/finance\/reserve-accounts\/([^/]+)$/);

  if (req.method === "PUT" && reserveAccountMatch && !valuationMatch) {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const id = decodeURIComponent(reserveAccountMatch[1]);
    const name = String(body.name || "").trim().slice(0, 120);
    const openingBalance = Number(body.openingBalance || 0);

    if (!name || !Number.isFinite(openingBalance) || openingBalance < 0) {
      sendJson(res, 400, { error: "Reserva inválida." });
      return true;
    }

    const result = await pool.query(
      `UPDATE ld4_finance_reserve_accounts
       SET name = $3, opening_balance = $4, updated_at = NOW()
       WHERE id = $1
         AND owner_scope = $2
         AND active = TRUE
       RETURNING id, name, opening_balance, sort_order`,
      [id, scope, name, openingBalance]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Reserva não encontrada." });
      return true;
    }

    sendJson(res, 200, {
      account: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        openingBalance: Number(result.rows[0].opening_balance || 0),
        sortOrder: Number(result.rows[0].sort_order || 0)
      }
    });

    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/finance/reserve-transfers") {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const year = Number(body.year);
    const month = Number(body.month) + 1;
    const day = Number(body.day);
    const account = String(body.account || "");
    const direction = String(body.direction || "");
    const amount = Number(body.value);
    const status = String(body.status || "");
    const description = cleanDescription(body.description);
    const contractedRate = numberOrNull(body.contractedRate);
    const maturityDate = body.maturityDate ? String(body.maturityDate) : null;

    if (
      !validFinanceDate(year, month, day) ||
      !account ||
      !["to_reserve", "from_reserve"].includes(direction) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !["provisioned", "realized"].includes(status)
    ) {
      sendJson(res, 400, { error: "Transferência inválida." });
      return true;
    }

    const accountResult = await pool.query(
      `SELECT id, asset_type, maturity_date, default_rate
       FROM ld4_finance_reserve_accounts
       WHERE id = $1
         AND owner_scope = $2
         AND active = TRUE
       LIMIT 1`,
      [account, scope]
    );

    if (!accountResult.rows.length) {
      sendJson(res, 404, { error: "Destino não encontrado." });
      return true;
    }

    const row = accountResult.rows[0];
    const finalRate = row.asset_type === "treasury_fixed" && direction === "to_reserve"
      ? (contractedRate ?? numberOrNull(row.default_rate))
      : null;
    const finalMaturity = row.asset_type === "treasury_fixed"
      ? (maturityDate || isoDate(row.maturity_date))
      : null;

    if (
      row.asset_type === "treasury_fixed" &&
      direction === "to_reserve" &&
      (!Number.isFinite(finalRate) || finalRate <= 0 || !finalMaturity)
    ) {
      sendJson(res, 400, { error: "Informe a taxa contratada do Tesouro." });
      return true;
    }

    const result = await pool.query(
      `INSERT INTO ld4_finance_reserve_transfers
        (id, transfer_date, account_id, direction, amount, status, description, contracted_rate, maturity_date)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9::date)
       RETURNING id`,
      [
        randomUUID(),
        financeDateKey(year, month, day),
        account,
        direction,
        amount,
        status,
        description,
        finalRate,
        finalMaturity
      ]
    );

    sendJson(res, 201, { id: result.rows[0].id });
    return true;
  }

  const reserveTransferMatch = url.pathname.match(/^\/api\/finance\/reserve-transfers\/([^/]+)$/);

  if (req.method === "PUT" && reserveTransferMatch) {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const id = decodeURIComponent(reserveTransferMatch[1]);
    const year = Number(body.year);
    const month = Number(body.month) + 1;
    const day = Number(body.day);
    const account = String(body.account || "");
    const direction = String(body.direction || "");
    const amount = Number(body.value);
    const status = String(body.status || "");
    const description = cleanDescription(body.description);
    const contractedRate = numberOrNull(body.contractedRate);
    const maturityDate = body.maturityDate ? String(body.maturityDate) : null;

    const accountResult = await pool.query(
      `SELECT id, asset_type, maturity_date, default_rate
       FROM ld4_finance_reserve_accounts
       WHERE id = $1 AND owner_scope = $2 AND active = TRUE
       LIMIT 1`,
      [account, scope]
    );

    if (
      !validFinanceDate(year, month, day) ||
      !accountResult.rows.length ||
      !["to_reserve", "from_reserve"].includes(direction) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !["provisioned", "realized"].includes(status)
    ) {
      sendJson(res, 400, { error: "Transferência inválida." });
      return true;
    }

    const row = accountResult.rows[0];
    const finalRate = row.asset_type === "treasury_fixed" && direction === "to_reserve"
      ? (contractedRate ?? numberOrNull(row.default_rate))
      : null;
    const finalMaturity = row.asset_type === "treasury_fixed"
      ? (maturityDate || isoDate(row.maturity_date))
      : null;

    const result = await pool.query(
      `UPDATE ld4_finance_reserve_transfers t
       SET transfer_date = $3::date,
           account_id = $4,
           direction = $5,
           amount = $6,
           status = $7,
           description = $8,
           contracted_rate = $9,
           maturity_date = $10::date,
           updated_at = NOW()
       FROM ld4_finance_reserve_accounts current_account
       WHERE t.id = $1
         AND current_account.id = t.account_id
         AND current_account.owner_scope = $2
       RETURNING t.id`,
      [
        id,
        scope,
        financeDateKey(year, month, day),
        account,
        direction,
        amount,
        status,
        description,
        finalRate,
        finalMaturity
      ]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Transferência não encontrada." });
      return true;
    }

    sendJson(res, 200, { id: result.rows[0].id });
    return true;
  }

  if (req.method === "DELETE" && reserveTransferMatch) {
    const scope = requestScope(url);
    const id = decodeURIComponent(reserveTransferMatch[1]);

    const result = await pool.query(
      `DELETE FROM ld4_finance_reserve_transfers t
       USING ld4_finance_reserve_accounts a
       WHERE t.id = $1
         AND a.id = t.account_id
         AND a.owner_scope = $2
       RETURNING t.id`,
      [id, scope]
    );

    if (!result.rows.length) {
      sendJson(res, 404, { error: "Transferência não encontrada." });
      return true;
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/finance/recurring-rules") {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const category = String(body.category || "");
    const name = cleanDescription(body.name);
    const amount = Number(body.value);
    const day = Number(body.day);
    const startMonth = String(body.startMonth || "");
    const endMonth = body.endMonth ? String(body.endMonth) : null;
    const syncYear = Number(body.year);

    if (
      !category || !name || !Number.isFinite(amount) || amount <= 0 ||
      !Number.isInteger(day) || day < 1 || day > 31 ||
      !validMonthKey(startMonth) ||
      (endMonth && !validMonthKey(endMonth)) ||
      (endMonth && endMonth < startMonth)
    ) {
      sendJson(res, 400, { error: "Recorrência inválida." });
      return true;
    }

    const categoryResult = await pool.query(
      `SELECT id FROM ld4_finance_categories
       WHERE id = $1 AND owner_scope = $2 AND active = TRUE LIMIT 1`,
      [category, scope]
    );

    if (!categoryResult.rows.length) {
      sendJson(res, 404, { error: "Categoria não encontrada." });
      return true;
    }

    const id = randomUUID();

    await pool.query(
      `INSERT INTO ld4_finance_recurring_rules
        (id, category_id, name, amount, day_of_month, frequency, start_month, end_month, active, owner_scope, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'monthly', $6::date, $7::date, TRUE, $8, NOW(), NOW())`,
      [id, category, name, amount, day, `${startMonth}-01`, endMonth ? `${endMonth}-01` : null, scope]
    );

    if (validFinanceYear(syncYear)) await syncRecurringTransactions(scope, syncYear);

    sendJson(res, 201, { id });
    return true;
  }

  const recurringMatch = url.pathname.match(/^\/api\/finance\/recurring-rules\/([^/]+)$/);

  if (req.method === "PUT" && recurringMatch) {
    const body = await readJson(req);
    const scope = requestScope(url, body);
    const id = decodeURIComponent(recurringMatch[1]);
    const category = String(body.category || "");
    const name = cleanDescription(body.name);
    const amount = Number(body.value);
    const day = Number(body.day);
    const startMonth = String(body.startMonth || "");
    const endMonth = body.endMonth ? String(body.endMonth) : null;
    const syncYear = Number(body.year);

    if (
      !category || !name || !Number.isFinite(amount) || amount <= 0 ||
      !Number.isInteger(day) || day < 1 || day > 31 ||
      !validMonthKey(startMonth) ||
      (endMonth && !validMonthKey(endMonth)) ||
      (endMonth && endMonth < startMonth)
    ) {
      sendJson(res, 400, { error: "Recorrência inválida." });
      return true;
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE ld4_finance_recurring_rules
         SET category_id = $3,
             name = $4,
             amount = $5,
             day_of_month = $6,
             start_month = $7::date,
             end_month = $8::date,
             updated_at = NOW()
         WHERE id = $1
           AND owner_scope = $2
           AND active = TRUE
         RETURNING id`,
        [id, scope, category, name, amount, day, `${startMonth}-01`, endMonth ? `${endMonth}-01` : null]
      );

      if (!result.rows.length) {
        await client.query("ROLLBACK");
        sendJson(res, 404, { error: "Recorrência não encontrada." });
        return true;
      }

      await client.query(
        `DELETE FROM ld4_finance_transactions
         WHERE recurring_rule_id = $1
           AND owner_scope = $2
           AND status = 'provisioned'`,
        [id, scope]
      );

      await client.query("COMMIT");

      if (validFinanceYear(syncYear)) await syncRecurringTransactions(scope, syncYear);
      sendJson(res, 200, { id });
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (req.method === "DELETE" && recurringMatch) {
    const scope = requestScope(url);
    const id = decodeURIComponent(recurringMatch[1]);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE ld4_finance_recurring_rules
         SET active = FALSE, updated_at = NOW()
         WHERE id = $1
           AND owner_scope = $2
           AND active = TRUE
         RETURNING id`,
        [id, scope]
      );

      if (!result.rows.length) {
        await client.query("ROLLBACK");
        sendJson(res, 404, { error: "Recorrência não encontrada." });
        return true;
      }

      await client.query(
        `DELETE FROM ld4_finance_transactions
         WHERE recurring_rule_id = $1
           AND owner_scope = $2
           AND status = 'provisioned'`,
        [id, scope]
      );

      await client.query("COMMIT");
      sendJson(res, 200, { ok: true });
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return false;
}

function safePublicPath(pathname) {
  const clean = decodeURIComponent(pathname || "/");
  let requested = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  if (requested.endsWith("/")) requested += "index.html";

  const resolved = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!resolved.startsWith(PUBLIC_DIR)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/financeiro" || url.pathname === "/financeiro/") {
      res.writeHead(308, { Location: "/", "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: "Rota não encontrada." });
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
        "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
      });

      fs.createReadStream(filePath).pipe(res);
    });
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      sendJson(res, 500, {
        error: "Ocorreu um erro no servidor.",
        detail: process.env.NODE_ENV === "development" ? error.message : undefined
      });
    } else {
      res.end();
    }
  }
});

async function startServer() {
  try {
    console.log("Preparando banco...");
    await initDatabase();

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Financeiro PF/PJ pronto na porta ${PORT}`);
    });
  } catch (error) {
    console.error("Falha ao iniciar Financeiro:", error);
    process.exit(1);
  }
}

startServer();
