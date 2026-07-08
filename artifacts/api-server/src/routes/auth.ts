import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, cloudUsersTable, companiesTable } from "@workspace/db";
import { LoginBody, AcceptInviteBody } from "@workspace/api-zod";
import {
  verifyPassword,
  hashPassword,
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

router.get("/www/invites/:token", async (req, res, next) => {
  try {
    const token = req.params["token"];
    const [user] = await db
      .select()
      .from(cloudUsersTable)
      .where(
        and(
          eq(cloudUsersTable.inviteToken, token),
          isNull(cloudUsersTable.passwordHash),
        ),
      );
    if (!user || !user.active) {
      res.status(404).json({
        error: "This invitation is invalid or has already been used",
        code: "invalid_invite",
      });
      return;
    }
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, user.companyId));
    res.json({
      email: user.email,
      role: user.role,
      companyName: company?.name ?? "",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/www/invites/accept", async (req, res, next) => {
  try {
    const parsed = AcceptInviteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid input (password must be at least 8 characters)",
        code: "invalid_input",
      });
      return;
    }
    const { token, name, password } = parsed.data;

    const [user] = await db
      .select()
      .from(cloudUsersTable)
      .where(
        and(
          eq(cloudUsersTable.inviteToken, token),
          isNull(cloudUsersTable.passwordHash),
        ),
      );
    if (!user || !user.active) {
      res.status(400).json({
        error: "This invitation is invalid or has already been used",
        code: "invalid_invite",
      });
      return;
    }

    const [updated] = await db
      .update(cloudUsersTable)
      .set({
        name,
        passwordHash: hashPassword(password),
        inviteToken: null,
        updatedAt: new Date(),
      })
      .where(eq(cloudUsersTable.id, user.id))
      .returning();
    if (!updated) throw new Error("Failed to activate invited user");

    const session = await createSession(updated.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json(await sessionUserPayload(updated));
  } catch (err) {
    next(err);
  }
});

export default router;
