import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl, getMissingFacebookOAuthEnv } from "@/lib/env";
import { createOAuthState } from "@/lib/meta/oauth";
import { getFacebookAuthorizationUrl } from "@/lib/meta/facebook";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=forbidden`);
  }

  // Same reasoning as the Instagram connect route: report missing env by name
  // instead of surfacing a 500 on a plain link click.
  const missingEnv = getMissingFacebookOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}/settings?instagram=misconfigured&missing=${encodeURIComponent(
        missingEnv.join(",")
      )}`
    );
  }

  const redirectUri = `${getBaseUrl()}/api/facebook/callback`;
  const state = createOAuthState(context.workspaceId);

  return NextResponse.redirect(getFacebookAuthorizationUrl(redirectUri, state));
}
