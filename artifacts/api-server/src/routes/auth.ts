import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, cloudUsersTable, companiesTable } from "@workspace/db";
import { LoginBody } from "@workspace/api-zod";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  destroySession,
  getSessionToken,
  getSessionUser,
} from "../lib/auth";
import type { CloudUser, Company } from "@workspace/db";

const router: IRouter = Router();

async function sessionUserPayload(user: CloudUser): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
  isMasterAdmin: boolean;
  companyId: string;
  companyName: string;
}> {
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, user.companyId));
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isMasterAdmin: user.isMasterAdmin,
    companyId: user.companyId,
    companyName: (company as Company | undefined)?.name ?? "",
  };
}

router.post("/www/auth/login", async (req, res, next) => {
  try {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "invalid_input" });
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();

    const [user] = await db
      .select()
      .from(cloudUsersTable)
      .where(eq(cloudUsersTable.email, email));
    if (
      !user ||
      !user.active ||
      !user.passwordHash ||
      !verifyPassword(parsed.data.password, user.passwordHash)
    ) {
      res
        .status(401)
        .json({ error: "Invalid email or password", code: "bad_credentials" });
      return;
    }

    const session = await createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json(await sessionUserPayload(user));
  } catch (err) {
    next(err);
  }
});

router.post("/www/auth/logout", async (req, res, next) => {
  try {
    const token = getSessionToken(req);
    if (token) await destroySession(token);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/www/auth/me", async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Not logged in", code: "unauthorized" });
      return;
    }
    res.json(await sessionUserPayload(user));
  } catch (err) {
    next(err);
  }
});

export default router;
