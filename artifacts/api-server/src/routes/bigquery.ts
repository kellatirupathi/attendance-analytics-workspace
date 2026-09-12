import { Router } from "express";
import { requireSession } from "../lib/auth.js";
import {
  listDatasets,
  listTables,
  getTablePreview,
  getDatasetCatalog,
  getTableFilterOptions,
  parseExplorerFilters,
} from "../lib/bigquery.js";
import { cacheGet, cacheSet } from "../lib/cache.js";

const router = Router();

// Superadmin only
router.use(requireSession(), (req, res, next) => {
  if (req.session?.role !== "superadmin") {
    res.status(403).json({ error: "Superadmin only" });
    return;
  }
  next();
});

router.get("/datasets", async (req, res): Promise<void> => {
  try {
    const datasets = await listDatasets();
    res.json(datasets.map((d) => ({ datasetId: d })));
  } catch {
    res.status(500).json({ error: "Failed to list datasets" });
  }
});

router.get("/tables", async (req, res): Promise<void> => {
  const dataset = req.query["dataset"] as string;
  if (!dataset) {
    res.status(400).json({ error: "dataset required" });
    return;
  }
  try {
    const tables = await listTables(dataset);
    res.json(tables);
  } catch {
    res.status(500).json({ error: "Failed to list tables" });
  }
});

router.get("/catalog", async (req, res): Promise<void> => {
  const dataset = req.query["dataset"] as string;
  if (!dataset) {
    res.status(400).json({ error: "dataset required" });
    return;
  }
  try {
    const catalog = await getDatasetCatalog(dataset);
    res.json(catalog);
  } catch {
    res.status(500).json({ error: "Failed to list tables and columns" });
  }
});

router.get("/preview", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const dataset = q["dataset"];
  const table = q["table"];
  const limit = Math.min(Number(q["limit"] ?? 20), 200);
  const offset = Math.max(0, Number(q["offset"] ?? 0));
  const search = q["search"]?.trim() || undefined;
  const filters = parseExplorerFilters(q["filters"]);
  if (!dataset || !table) {
    res.status(400).json({ error: "dataset and table required" });
    return;
  }
  try {
    const preview = await getTablePreview(dataset, table, {
      limit,
      offset,
      search,
      filters,
    });
    res.json(preview);
  } catch {
    res.status(500).json({ error: "Failed to preview table" });
  }
});

router.get("/filter-options", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const dataset = q["dataset"];
  const table = q["table"];
  if (!dataset || !table) {
    res.status(400).json({ error: "dataset and table required" });
    return;
  }
  const cacheKey = `bq-filter-options:${dataset}:${table}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  try {
    const options = await getTableFilterOptions(dataset, table);
    cacheSet(cacheKey, options, 5 * 60 * 1000);
    res.json(options);
  } catch {
    res.status(500).json({ error: "Failed to load filter options" });
  }
});

router.get("/export", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const dataset = q["dataset"];
  const table = q["table"];
  const search = q["search"]?.trim() || undefined;
  const filters = parseExplorerFilters(q["filters"]);
  const limit = Math.min(Number(q["limit"] ?? 10000), 10000);
  if (!dataset || !table) {
    res.status(400).json({ error: "dataset and table required" });
    return;
  }
  try {
    const preview = await getTablePreview(dataset, table, {
      limit,
      offset: 0,
      search,
      filters,
      maxLimit: 10000,
      timeoutMs: 60000,
    });
    res.json(preview);
  } catch {
    res.status(500).json({ error: "Failed to export table" });
  }
});

export default router;
