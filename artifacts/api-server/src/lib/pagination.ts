/** Rows per page when the client does not ask for a size. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  page: number;
  pageSize: number;
  /** `export=1`: every row in one response, for CSV downloads only. */
  all: boolean;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Reads `page` (1-based), `pageSize` and `export` from the query string. Bad values fall back to defaults. */
export function readPageRequest(q: Record<string, unknown>): PageRequest {
  const page = Math.floor(Number(q["page"]));
  const pageSize = Math.floor(Number(q["pageSize"]));
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize >= 1 ? Math.min(pageSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
    all: q["export"] === "1",
  };
}

/** One page of `rows`. A page past the end is clamped to the last page. */
export function pageOf<T>(rows: T[], req: PageRequest): Page<T> {
  const total = rows.length;
  if (req.all) {
    return { rows, total, page: 1, pageSize: Math.max(total, 1), totalPages: 1 };
  }
  const totalPages = Math.max(1, Math.ceil(total / req.pageSize));
  const page = Math.min(req.page, totalPages);
  const start = (page - 1) * req.pageSize;
  return { rows: rows.slice(start, start + req.pageSize), total, page, pageSize: req.pageSize, totalPages };
}
