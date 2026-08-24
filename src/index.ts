import { Hono } from "hono";
import { prisma } from "./prisma/client";

const app = new Hono();

// Health check — o Prisma Compute usa isso para saber que o processo subiu
app.get("/", (c) => c.json({ status: "ok", service: "discord-clone-api" }));

// Rota de exemplo: lista servidores do banco (prova de que o Prisma está conectado)
app.get("/servers", async (c) => {
  const servers = await prisma.server.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, ownerId: true, createdAt: true },
  });
  return c.json(servers);
});

// Exportação nativa para o Bun e Prisma Compute
export default {
  port: 3000, // Cravado em 3000, sem ler o env!
  hostname: '0.0.0.0',
  fetch: app.fetch,
};