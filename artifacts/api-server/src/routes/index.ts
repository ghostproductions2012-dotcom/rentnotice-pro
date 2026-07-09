import { Router, type IRouter } from "express";
import healthRouter from "./health";
import plansRouter from "./plans";
import checkoutRouter from "./checkout";
import authRouter from "./auth";
import adminRouter from "./admin";
import portalRouter from "./portal";
import licenseRouter from "./license";
import fieldRouter from "./field";
import downloadsRouter from "./downloads";

const router: IRouter = Router();

router.use(healthRouter);
router.use(plansRouter);
router.use(checkoutRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(portalRouter);
router.use(licenseRouter);
router.use(fieldRouter);
router.use(downloadsRouter);

export default router;
