import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import attendanceRouter from "./attendance.js";
import dashboardRouter from "./dashboard.js";
import adminRouter from "./admin.js";
import bigqueryRouter from "./bigquery.js";
import profileRouter from "./profile.js";
import notificationsRouter from "./notifications.js";
// Recovery is switched off for now; uncomment both lines to bring it back.
// import recoveryRouter from "./recovery.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/attendance", attendanceRouter);
router.use("/dashboard", dashboardRouter);
router.use("/admin", adminRouter);
router.use("/bigquery", bigqueryRouter);
router.use("/profile", profileRouter);
router.use("/notifications", notificationsRouter);
// router.use("/recovery", recoveryRouter);

export default router;
