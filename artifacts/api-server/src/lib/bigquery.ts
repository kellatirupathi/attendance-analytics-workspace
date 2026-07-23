import { createSign } from "node:crypto";

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID ?? "kossip-helpers";
const BQ_LOCATION = process.env.BQ_LOCATION ?? "asia-south1";

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
): Promise<T[]> {
  const token = await getAccessToken();
  const queryParams = Object.entries(params).map(([k, v]) => buildParam(k, v));
  const body = {
    query: sql,
    useLegacySql: false,
    timeoutMs: 30000,
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
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/datasets`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error("Failed to list datasets");
  const data = (await res.json()) as {
    datasets?: Array<{ datasetReference: { datasetId: string } }>;
  };
  return (data.datasets ?? []).map((d) => d.datasetReference.datasetId);
}

export async function listTables(
  dataset: string,
): Promise<Array<{ tableId: string; kind: string }>> {
  if (!/^[A-Za-z0-9_]+$/.test(dataset)) throw new Error("Invalid dataset name");
  const token = await getAccessToken();
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT_ID}/datasets/${dataset}/tables`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error("Failed to list tables");
  const data = (await res.json()) as {
    tables?: Array<{ tableReference: { tableId: string }; type: string }>;
  };
  return (data.tables ?? []).map((t) => ({
    tableId: t.tableReference.tableId,
    kind: t.type ?? "TABLE",
  }));
}

export async function getTablePreview(
  dataset: string,
  table: string,
  limit: number = 20,
  offset: number = 0,
  search?: string,
): Promise<{
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
}> {
  if (!/^[A-Za-z0-9_]+$/.test(dataset) || !/^[A-Za-z0-9_]+$/.test(table)) {
    throw new Error("Invalid dataset or table name");
  }
  const safeLimit = Math.min(Math.max(1, limit), 200);
  const safeOffset = Math.max(0, Math.floor(offset));
  const fqTable = `\`${BQ_PROJECT_ID}.${dataset}.${table}\``;

  let whereClause = "";
  const params: Record<string, unknown> = {};
  const q = search?.trim();
  if (q) {
    const sample = await bqQuery<Record<string, unknown>>(
      `SELECT * FROM ${fqTable} LIMIT 1`,
    );
    if (sample.length > 0) {
      params["search"] = `%${q.toLowerCase()}%`;
      const cols = Object.keys(sample[0]!);
      const ors = cols
        .map((col) => {
          const safe = col.replace(/`/g, "");
          return `LOWER(COALESCE(CAST(\`${safe}\` AS STRING), '')) LIKE @search`;
        })
        .join(" OR ");
      whereClause = `WHERE (${ors})`;
    }
  }

  const [rows, countRows] = await Promise.all([
    bqQuery(
      `SELECT * FROM ${fqTable} ${whereClause} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    ),
    bqQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM ${fqTable} ${whereClause}`,
      params,
    ),
  ]);

  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const totalRows = Number(countRows[0]?.n ?? rows.length);
  return { columns, rows, totalRows };
}

export const validateStudentId = /^[a-zA-Z0-9_\-]{4,64}$/;

export function pct(present: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((present / total) * 1000) / 10;
}
