// =====================================================================
// permissions.ts — Motor de permissões RBAC (bitfield estilo Discord)
// =====================================================================
// Regras de resolução (mesma ordem usada pelo Discord):
// 1. Se o usuário é o dono do servidor -> todas as permissões.
// 2. Base = OR de todas as permissões de todos os cargos do membro.
// 3. Se ADMINISTRATOR estiver na base -> todas as permissões (bypassa overrides).
// 4. Overrides de canal aplicados nesta ordem: @everyone -> cargos específicos
//    (por posição, do mais fraco pro mais forte) -> override do usuário
//    individual (sempre vence, é o mais específico).
// 5. Em cada passo: primeiro aplica "deny", depois "allow".
// =====================================================================

import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------
// Definição das permissões (cada uma é um bit distinto)
// ---------------------------------------------------------------------

export const Permissions = {
  VIEW_CHANNEL:      1n << 0n,
  SEND_MESSAGES:     1n << 1n,
  MANAGE_MESSAGES:   1n << 2n,
  ATTACH_FILES:      1n << 3n,
  ADD_REACTIONS:     1n << 4n,
  KICK_MEMBERS:      1n << 5n,
  BAN_MEMBERS:       1n << 6n,
  MANAGE_SERVER:     1n << 7n,
  MANAGE_ROLES:      1n << 8n,
  MANAGE_CHANNELS:   1n << 9n,
  CREATE_INVITE:     1n << 10n,
  CONNECT:           1n << 11n, // entrar em canal de voz
  SPEAK:             1n << 12n,
  STREAM:            1n << 13n, // compartilhar tela/câmera
  MUTE_MEMBERS:      1n << 14n, // mute administrativo (moderação)
  DEAFEN_MEMBERS:    1n << 15n,
  ADMINISTRATOR:     1n << 16n, // bypassa qualquer override
} as const;

export type PermissionKey = keyof typeof Permissions;

const ALL_PERMISSIONS: bigint = Object.values(Permissions).reduce((acc, p) => acc | p, 0n);

function hasFlag(bitfield: bigint, flag: bigint): boolean {
  return (bitfield & flag) === flag;
}

// ---------------------------------------------------------------------
// Cálculo da permissão base (nível de servidor, ignorando overrides de canal)
// ---------------------------------------------------------------------

interface RoleData {
  id: string;
  position: number;
  permissions: bigint;
}

interface OverrideData {
  roleId: string | null;
  userId: string | null;
  allow: bigint;
  deny: bigint;
}

export function computeBasePermissions(
  isOwner: boolean,
  roles: RoleData[]
): bigint {
  if (isOwner) return ALL_PERMISSIONS;

  let base = 0n;
  for (const role of roles) {
    base |= role.permissions;
  }

  if (hasFlag(base, Permissions.ADMINISTRATOR)) {
    return ALL_PERMISSIONS;
  }

  return base;
}

// ---------------------------------------------------------------------
// Aplica overrides de canal em cima da permissão base
// ---------------------------------------------------------------------

export function computeChannelPermissions(
  basePermissions: bigint,
  isOwner: boolean,
  memberRoles: RoleData[],   // cargos do membro, JÁ ORDENADOS por position ASC
  overrides: OverrideData[],
  userId: string
): bigint {
  // Dono do servidor e ADMINISTRATOR sempre têm acesso total, sem exceção
  if (isOwner || hasFlag(basePermissions, Permissions.ADMINISTRATOR)) {
    return ALL_PERMISSIONS;
  }

  let permissions = basePermissions;
  const memberRoleIds = new Set(memberRoles.map((r) => r.id));

  // 1) Override do cargo @everyone (convencionalmente position = 0)
  //    já está incluso no laço abaixo, pois @everyone é um Role normal.

  // 2) Overrides de cargo, aplicados na ordem de "position" (mais fraco -> mais forte)
  const roleOverrides = overrides
    .filter((o) => o.roleId && memberRoleIds.has(o.roleId))
    .sort((a, b) => {
      const posA = memberRoles.find((r) => r.id === a.roleId)?.position ?? 0;
      const posB = memberRoles.find((r) => r.id === b.roleId)?.position ?? 0;
      return posA - posB;
    });

  for (const override of roleOverrides) {
    permissions &= ~override.deny;
    permissions |= override.allow;
  }

  // 3) Override específico do usuário — sempre o mais específico, aplicado por último
  const userOverride = overrides.find((o) => o.userId === userId);
  if (userOverride) {
    permissions &= ~userOverride.deny;
    permissions |= userOverride.allow;
  }

  return permissions;
}

// ---------------------------------------------------------------------
// Carrega tudo do banco e resolve a permissão efetiva de um membro num canal
// ---------------------------------------------------------------------

export async function getEffectiveChannelPermissions(
  userId: string,
  channelId: string
): Promise<bigint> {
  const channel = await prisma.channel.findUniqueOrThrow({
    where: { id: channelId },
    include: { server: true, permissionOverrides: true },
  });

  const member = await prisma.serverMember.findUniqueOrThrow({
    where: { userId_serverId: { userId, serverId: channel.serverId } },
    include: { roles: { include: { role: true } } },
  });

  const isOwner = channel.server.ownerId === userId;
  const roles: RoleData[] = member.roles
    .map((mr) => mr.role)
    .sort((a, b) => a.position - b.position);

  const base = computeBasePermissions(isOwner, roles);

  return computeChannelPermissions(
    base,
    isOwner,
    roles,
    channel.permissionOverrides,
    userId
  );
}

// ---------------------------------------------------------------------
// Middleware Express — protege rotas que exigem uma permissão específica
// ---------------------------------------------------------------------

interface AuthedRequest extends Request {
  userId?: string; // preenchido por um middleware de autenticação anterior
}

export function requireChannelPermission(permission: PermissionKey) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      const { channelId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "Não autenticado" });
      }
      if (!channelId) {
        return res.status(400).json({ error: "channelId ausente na rota" });
      }

      const effective = await getEffectiveChannelPermissions(userId, channelId as string);

      if (!hasFlag(effective, Permissions[permission])) {
        return res.status(403).json({
          error: `Permissão insuficiente: requer ${permission}`,
        });
      }

      next();
    } catch (err) {
      // Membro ou canal não encontrado, ou erro de banco
      return res.status(404).json({ error: "Canal ou membro não encontrado" });
    }
  };
}

// ---------------------------------------------------------------------
// Exemplo de uso em uma rota (Express)
// ---------------------------------------------------------------------
//
// router.post(
//   "/channels/:channelId/voice-token",
//   requireChannelPermission("CONNECT"),
//   issueVoiceTokenController
// );
//
// router.delete(
//   "/channels/:channelId/messages/:messageId",
//   requireChannelPermission("MANAGE_MESSAGES"),
//   deleteMessageController
// );
