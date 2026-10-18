import { prisma } from "@/lib/db/client";

export async function canConnectInstagramAccount({
  workspaceId,
  instagramId,
}: {
  workspaceId: string;
  instagramId: string;
}) {
  const existingAccount = await prisma.instagramAccount.findUnique({
    where: { instagramId },
    select: { workspaceId: true },
  });

  if (existingAccount && existingAccount.workspaceId !== workspaceId) {
    return {
      allowed: false,
      reason: "already_connected" as const,
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

/**
 * The account an endpoint should act on: the one named by `instagramAccountId`,
 * otherwise the most recently connected.
 *
 * `platform` defaults to INSTAGRAM because most endpoints (inbox, profile,
 * analytics) call Instagram-only APIs and would fail on a Facebook Page's
 * token. Endpoints that work with both — the post list, campaign import —
 * pass "ANY".
 */
export async function getWorkspaceInstagramAccount(
  workspaceId: string,
  instagramAccountId?: string | null,
  platform: "INSTAGRAM" | "FACEBOOK" | "ANY" = "INSTAGRAM"
) {
  const platformFilter = platform === "ANY" ? {} : { platform };

  if (instagramAccountId && instagramAccountId !== "all") {
    return prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, workspaceId, ...platformFilter },
    });
  }

  return prisma.instagramAccount.findFirst({
    where: { workspaceId, ...platformFilter },
    orderBy: { connectedAt: "desc" },
  });
}

