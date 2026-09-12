import { createSign } from "node:crypto";

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID ?? "kossip-helpers";
const BQ_LOCATION = process.env.BQ_LOCATION ?? "asia-south1";

export const PROD_SEQUENCE_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.niat_schedule_details_as_per_prod_sequence`";

export const INSTRUCTOR_DETAILS_TABLE =
  "`kossip-helpers.niat_post_onboarding_engagement_ai_analytics_workspace.niat_instructor_details`";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
let saJson: ServiceAccount | null = null;

function getServiceAccount(): ServiceAccount {
  if (saJson) return saJson;
  const raw = process.env.BIGQUERY_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("BIGQUERY_SERVICE_ACCOUNT_JSON not set");
  saJson = JSON.parse(raw) as ServiceAccount;
  return saJson;
}

function base64url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - 30000 > Date.now()) {
    return tokenCache.accessToken;
  }
  const sa = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/bigquery.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const signing = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signing);
  const sig = sign.sign(sa.private_key, "base64url");
  const jwt = `${signing}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`BQ token error: ${err}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.accessToken;
}

export interface BqParam {
  name: string;
  parameterType:
    | { type: string }
    | { type: "ARRAY"; arrayType: { type: string } };
  parameterValue: { value?: string; arrayValues?: Array<{ value: string }> };
}

function buildParam(name: string, value: unknown): BqParam {
  if (Array.isArray(value)) {
    return {
      name,
      parameterType: { type: "ARRAY", arrayType: { type: "STRING" } },
      parameterValue: {
        arrayValues: (value as string[]).map((v) => ({ value: String(v) })),
      },
    };
  }
  if (typeof value === "number") {
    return {
      name,
      parameterType: { type: "INT64" },
      parameterValue: { value: String(value) },
    };
  }
  return {
    name,
    parameterType: { type: "STRING" },
    parameterValue: { value: String(value) },
  };
}

export async function bqQuery<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, unknown> = {},
  location: string = BQ_LOCATION,
  timeoutMs: number = 30000,
): Promise<T[]> {
  const token = await getAccessToken();
  const queryParams = Object.entries(params).map(([k, v]) => buildParam(k, v));
  const body = {
    query: sql,
    useLegacySql: false,
    timeoutMs,
    location,
    queryParameters: queryParams,
    parameterMode: queryParams.length > 0 ? "NAMED" : undefined,
  };
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/queries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`BQ query error: ${res.status}`);
  }
  const data = (await res.json()) as {
    schema?: { fields: Array<{ name: string }> };
    rows?: Array<{ f: Array<{ v: unknown }> }>;
    jobComplete?: boolean;
    errors?: unknown[];
  };
  if (data.errors && (data.errors as unknown[]).length > 0) {
    throw new Error("BQ query returned errors");
  }
  if (!data.schema || !data.rows) return [];
  const cols = data.schema.fields.map((f) => f.name);
  return (data.rows ?? []).map((row) => {
    const obj: Record<string, unknown> = {};
    row.f.forEach((cell, i) => {
      obj[cols[i]!] = cell.v;
    });
    return obj as T;
  });
}

export async function listDatasets(): Promise<string[]> {
  const token = await getAccessToken();
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/datasets`,
    );
    url.searchParams.set("maxResults", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to list datasets");
    const data = (await res.json()) as {
      datasets?: Array<{ datasetReference: { datasetId: string } }>;
      nextPageToken?: string;
    };
    ids.push(...(data.datasets ?? []).map((d) => d.datasetReference.datasetId));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

export async function listTables(
  dataset: string,
): Promise<Array<{ tableId: string; kind: string }>> {
  if (!/^[A-Za-z0-9_]+$/.test(dataset)) throw new Error("Invalid dataset name");
  const token = await getAccessToken();
  const tables: Array<{ tableId: string; kind: string }> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/datasets/${dataset}/tables`,
    );
    url.searchParams.set("maxResults", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to list tables");
    const data = (await res.json()) as {
      tables?: Array<{ tableReference: { tableId: string }; type: string }>;
      nextPageToken?: string;
    };
    for (const t of data.tables ?? []) {
      tables.push({
        tableId: t.tableReference.tableId,
        kind: t.type ?? "TABLE",
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return tables.sort((a, b) => a.tableId.localeCompare(b.tableId));
}

export interface CatalogColumn {
  name: string;
  type: string;
}

export interface CatalogTable {
  tableId: string;
  kind: string;
  columns: CatalogColumn[];
}

/** Every table/view in a dataset plus every column from INFORMATION_SCHEMA. */
export async function getDatasetCatalog(dataset: string): Promise<CatalogTable[]> {
  if (!/^[A-Za-z0-9_]+$/.test(dataset)) throw new Error("Invalid dataset name");
  const [tables, colRows] = await Promise.all([
    listTables(dataset),
    bqQuery<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
       FROM \`${BQ_PROJECT_ID}.${dataset}.INFORMATION_SCHEMA.COLUMNS\`
       ORDER BY table_name, ordinal_position`,
    ),
  ]);
  const colsByTable = new Map<string, CatalogColumn[]>();
  for (const row of colRows) {
    const list = colsByTable.get(row.table_name) ?? [];
    list.push({ name: row.column_name, type: row.data_type });
    colsByTable.set(row.table_name, list);
  }
  return tables.map((t) => ({
    tableId: t.tableId,
    kind: t.kind,
    columns: colsByTable.get(t.tableId) ?? [],
  }));
}

interface BqSchemaField {
  name: string;
  type?: string;
  fields?: BqSchemaField[];
}

function flattenSchemaFields(
  fields: BqSchemaField[],
  prefix = "",
): CatalogColumn[] {
  const out: CatalogColumn[] = [];
  for (const field of fields) {
    const name = prefix ? `${prefix}.${field.name}` : field.name;
    if (field.type === "RECORD" && field.fields && field.fields.length > 0) {
      out.push(...flattenSchemaFields(field.fields, name));
    } else {
      out.push({ name, type: field.type ?? "STRING" });
    }
  }
  return out;
}

export async function getTableSchema(
  dataset: string,
  table: string,
  options: { flatten?: boolean } = {},
): Promise<CatalogColumn[]> {
  if (!/^[A-Za-z0-9_]+$/.test(dataset) || !/^[A-Za-z0-9_]+$/.test(table)) {
    throw new Error("Invalid dataset or table name");
  }
  const token = await getAccessToken();
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/datasets/${dataset}/tables/${table}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error("Failed to load table schema");
  const data = (await res.json()) as { schema?: { fields?: BqSchemaField[] } };
  const fields = data.schema?.fields ?? [];
  if (options.flatten === false) {
    return fields.map((field) => ({
      name: field.name,
      type: field.type ?? "STRING",
    }));
  }
  return flattenSchemaFields(fields);
}

export interface TableColumnFilter {
  column: string;
  op: "eq" | "contains";
  value: string;
}

export interface TableColumnFilterOption {
  column: string;
  categorical: boolean;
  values: string[];
}

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CATEGORICAL_MAX = 200;
const SKIP_DISTINCT_TYPES = new Set([
  "RECORD",
  "STRUCT",
  "ARRAY",
  "BYTES",
  "GEOGRAPHY",
  "JSON",
]);

function assertIdent(name: string): string {
  if (!SAFE_IDENT.test(name)) throw new Error("Invalid identifier");
  return name;
}

function quoteIdent(name: string): string {
  return `\`${assertIdent(name)}\``;
}

function parseColumnFilters(raw: unknown): TableColumnFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: TableColumnFilter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const column = typeof rec.column === "string" ? rec.column.trim() : "";
    const value = typeof rec.value === "string" ? rec.value.trim() : "";
    const op = rec.op === "eq" ? "eq" : "contains";
    if (!column || !SAFE_IDENT.test(column) || !value || value === "all") {
      continue;
    }
    out.push({ column, op, value });
  }
  return out;
}

export function parseExplorerFilters(
  raw: string | undefined,
): TableColumnFilter[] {
  if (!raw?.trim()) return [];
  try {
    return parseColumnFilters(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function buildExplorerWhere(
  columns: string[],
  search?: string,
  filters: TableColumnFilter[] = [],
): Promise<{ where: string; params: Record<string, unknown> }> {
  const allowed = new Set(columns.filter((c) => SAFE_IDENT.test(c)));
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  const q = search?.trim();
  if (q) {
    params["search"] = `%${q.toLowerCase()}%`;
    const ors = [...allowed].map(
      (col) =>
        `LOWER(COALESCE(CAST(${quoteIdent(col)} AS STRING), '')) LIKE @search`,
    );
    if (ors.length > 0) clauses.push(`(${ors.join(" OR ")})`);
  }
  filters.forEach((filter, i) => {
    if (!allowed.has(filter.column)) return;
    const key = `f${i}`;
    const col = quoteIdent(filter.column);
    if (filter.op === "eq") {
      params[key] = filter.value;
      clauses.push(`CAST(${col} AS STRING) = @${key}`);
    } else {
      params[key] = `%${filter.value.toLowerCase()}%`;
      clauses.push(
        `LOWER(COALESCE(CAST(${col} AS STRING), '')) LIKE @${key}`,
      );
    }
  });
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

async function mapPool<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(size, Math.max(items.length, 1)) }, worker),
  );
  return out;
}

export async function getTableFilterOptions(
  dataset: string,
  table: string,
): Promise<TableColumnFilterOption[]> {
  if (!SAFE_IDENT.test(dataset) || !SAFE_IDENT.test(table)) {
    throw new Error("Invalid dataset or table name");
  }
  const schemaCols = await getTableSchema(dataset, table, { flatten: false });
  const fqTable = `\`${BQ_PROJECT_ID}.${dataset}.${table}\``;
  return mapPool(schemaCols, 6, async (col) => {
    if (
      !SAFE_IDENT.test(col.name) ||
      SKIP_DISTINCT_TYPES.has((col.type ?? "").toUpperCase())
    ) {
      return { column: col.name, categorical: false, values: [] };
    }
    try {
      const rows = await bqQuery<{ v: string }>(
        `SELECT DISTINCT CAST(${quoteIdent(col.name)} AS STRING) AS v
         FROM ${fqTable}
         WHERE ${quoteIdent(col.name)} IS NOT NULL
           AND TRIM(CAST(${quoteIdent(col.name)} AS STRING)) != ''
         ORDER BY v
         LIMIT ${CATEGORICAL_MAX + 1}`,
      );
      const values = rows
        .map((r) => String(r.v ?? "").trim())
        .filter(Boolean);
      const categorical = values.length > 0 && values.length <= CATEGORICAL_MAX;
      return {
        column: col.name,
        categorical,
        values: categorical ? values : [],
      };
    } catch {
      return { column: col.name, categorical: false, values: [] };
    }
  });
}

export async function getTablePreview(
  dataset: string,
  table: string,
  opts: {
    limit?: number;
    offset?: number;
    search?: string;
    filters?: TableColumnFilter[];
    maxLimit?: number;
    timeoutMs?: number;
  } = {},
): Promise<{
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}> {
  if (!SAFE_IDENT.test(dataset) || !SAFE_IDENT.test(table)) {
    throw new Error("Invalid dataset or table name");
  }
  const maxLimit = Math.min(Math.max(1, opts.maxLimit ?? 200), 10000);
  const safeLimit = Math.min(Math.max(1, opts.limit ?? 20), maxLimit);
  const safeOffset = Math.max(0, Math.floor(opts.offset ?? 0));
  const fqTable = `\`${BQ_PROJECT_ID}.${dataset}.${table}\``;
  const schemaCols = await getTableSchema(dataset, table, { flatten: false });
  const columns = schemaCols.map((c) => c.name);
  const { where, params } = await buildExplorerWhere(
    columns,
    opts.search,
    opts.filters,
  );
  const timeoutMs = opts.timeoutMs ?? 30000;

  const [rows, countRows] = await Promise.all([
    bqQuery(
      `SELECT * FROM ${fqTable} ${where} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
      BQ_LOCATION,
      timeoutMs,
    ),
    bqQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM ${fqTable} ${where}`,
      params,
      BQ_LOCATION,
      timeoutMs,
    ),
  ]);

  const rowColumns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const totalRows = Number(countRows[0]?.n ?? rows.length);
  return {
    columns: columns.length > 0 ? columns : rowColumns,
    rows,
    totalRows,
    truncated: safeOffset + rows.length < totalRows,
  };
}

export const validateStudentId = /^[a-zA-Z0-9_\-]{4,64}$/;

/**
 * Student ids reach us in both hyphenated UUID form (`40b54050-8476-...`,
 * used in SPI links and the attendance table) and bare hex form
 * (`40b540508476...`, how the quiz table stores user_id). Strip hyphens so a
 * single normalized value matches either representation in SQL.
 */
export function normalizeStudentId(studentId: string): string {
  return studentId.replace(/-/g, "").toLowerCase();
}

export function pct(present: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((present / total) * 1000) / 10;
}
