import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import {
  exchangeFacebookCode,
  listFacebookPages,
  subscribeFacebookPageToWebhooks,
} from "@/lib/meta/facebook";
import { encryptToken, verifyOAuthState } from "@/lib/meta/oauth";
import { canManageWorkspace } from "@/lib/workspace-access";

/**
 * Facebook Login callback: connects every Page the person granted. A Page is
 * stored as an account with platform FACEBOOK (instagramId = Page ID), so
 * campaigns, logs and the DM worker treat it like any other account.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=denied`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: state.workspaceId, userId: session.user.id },
  });
  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?instagram=forbidden`);
  }

  try {
    const userToken = await exchangeFacebookCode(
      code,
      `${baseUrl}/api/facebook/callback`
    );
    const pages = await listFacebookPages(userToken);

    if (pages.length === 0) {
      return NextResponse.redirect(`${baseUrl}/settings?instagram=no_pages`);
    }

    let connected = 0;
    let skipped = 0;
    for (const page of pages) {
      const connection = await canConnectInstagramAccount({
        workspaceId: state.workspaceId,
        instagramId: page.id,
      });
      if (!connection.allowed) {
        skipped += 1;
        continue;
      }

      let webhookSubscribed = false;
      try {
        const subscription = await subscribeFacebookPageToWebhooks(
          page.id,
          page.access_token
        );
        webhookSubscribed = Boolean(subscription.success);
      } catch (subscriptionError) {
        console.warn(
          "[Facebook Callback] Webhook subscription failed:",
          subscriptionError
        );
      }

      const data = {
        workspaceId: state.workspaceId,
        platform: "FACEBOOK" as const,
        username: page.name,
        name: page.name,
        accessToken: encryptToken(page.access_token),
        // Page tokens from a long-lived user token do not expire.
        tokenExpiresAt: null,
        webhookSubscribed,
      };
      await prisma.instagramAccount.upsert({
        where: { instagramId: page.id },
        create: { instagramId: page.id, ...data },
        update: data,
      });
      connected += 1;
    }

    if (connected === 0 && skipped > 0) {
      return NextResponse.redirect(
        `${baseUrl}/settings?instagram=already_connected`
      );
    }
    return NextResponse.redirect(`${baseUrl}/dashboard?connected=true`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Facebook Callback] Error:", err);
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Facebook Page connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});

    return NextResponse.redirect(
      `${baseUrl}/settings?instagram=failed&reason=${encodeURIComponent(
        message.slice(0, 200)
      )}`
    );
  }
}
