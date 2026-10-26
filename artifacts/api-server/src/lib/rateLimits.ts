import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

/**
 * Rate limits for the public student report and quiz. A whole college often reaches us from one
 * IP (campus Wi-Fi), so the normal limit counts per student on a network, and a much higher
 * per-network cap only stops one network from walking through many student UIDs.
 */
const common = { windowMs: 60 * 1000, standardHeaders: true, legacyHeaders: false } as const;

/** `max` requests a minute for one student from one network. */
export function perStudentLimit(max: number, studentOf: (req: Request) => unknown) {
  return rateLimit({
    ...common,
    limit: max,
    keyGenerator: (req) => {
      const student = studentOf(req);
      return `${ipKeyGenerator(req.ip ?? "")}:${typeof student === "string" ? student.trim().toLowerCase().replace(/-/g, "") : ""}`;
    },
  });
}

/** `max` requests a minute from one network, all students together. */
export function perNetworkLimit(max: number) {
  return rateLimit({ ...common, limit: max });
}

/** Runs the limits in order as one middleware; the first one that is exceeded answers 429. */
export function allLimits(...limits: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    const run = (i: number): void => {
      if (i === limits.length) return next();
      limits[i]!(req, res, (err?: unknown) => (err ? next(err) : run(i + 1)));
    };
    run(0);
  };
}
