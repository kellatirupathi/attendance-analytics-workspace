import { Router } from "express";
import { requireSession } from "../lib/auth.js";
import { listDatasets, listTables, getTablePreview } from "../lib/bigquery.js";

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

router.get("/preview", async (req, res): Promise<void> => {
  const dataset = req.query["dataset"] as string;
  const table = req.query["table"] as string;
  const limit = Math.min(Number(req.query["limit"] ?? 20), 200);
  const offset = Math.max(0, Number(req.query["offset"] ?? 0));
  if (!dataset || !table) {
    res.status(400).json({ error: "dataset and table required" });
    return;
  }
  try {
    const preview = await getTablePreview(dataset, table, limit, offset);
    res.json(preview);
  } catch {
    res.status(500).json({ error: "Failed to preview table" });
  }
});

export default router;
