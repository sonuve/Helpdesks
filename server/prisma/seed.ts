import { randomUUID } from "node:crypto";
import { auth } from "../src/lib/auth.js";
import { getOrCreateAiAssistantUser } from "../src/lib/ai-assistant.js";
import { prisma } from "../src/lib/prisma.js";
import { Role } from "../src/generated/prisma/enums.js";

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment");
}

const ctx = await auth.$context;
const hashedPassword = await ctx.password.hash(password);
const now = new Date();

const user = await prisma.user.upsert({
  where: { email },
  update: { role: Role.ADMIN },
  create: {
    id: randomUUID(),
    name: "Admin",
    email,
    emailVerified: true,
    role: Role.ADMIN,
    createdAt: now,
    updatedAt: now,
  },
});

const existingAccount = await prisma.account.findFirst({
  where: { userId: user.id, providerId: "credential" },
});

if (existingAccount) {
  await prisma.account.update({
    where: { id: existingAccount.id },
    data: { password: hashedPassword, updatedAt: now },
  });
} else {
  await prisma.account.create({
    data: {
      id: randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
    },
  });
}

console.log(`Seeded admin user: ${email}`);

// Same well-known "AI Assistant" agent lib/queue.ts's auto-resolve job
// assigns tickets to and authors resolved-by-AI replies as (see
// lib/ai-assistant.ts) — seeded here too so it exists (and is visible/
// assignable) immediately in a fresh database, rather than only appearing
// after the first ticket's auto-resolve job happens to run.
const aiAssistant = await getOrCreateAiAssistantUser();
console.log(`Seeded AI Assistant agent: ${aiAssistant.email}`);

await prisma.$disconnect();
