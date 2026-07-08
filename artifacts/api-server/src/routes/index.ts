import { Router, type IRouter } from "express";
import healthRouter from "./health";
import plansRouter from "./plans";
import checkoutRouter from "./checkout";
import authRouter from "./auth";
import portalRouter from "./portal";
import licenseRouter from "./license";
import fieldRouter from "./field";

const router: IRouter = Router();

router.use(healthRouter);
router.use(plansRouter);
router.use(checkoutRouter);
router.use(authRouter);
router.use(portalRouter);
router.use(licenseRouter);
router.use(fieldRouter);

export default router;
