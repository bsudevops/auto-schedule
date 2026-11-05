import { oauthJson, preflight } from "@/lib/oauth-http";
import { authorizationServerMetadata } from "@/lib/oauth";

/** RFC 8414: where to register, sign in and fetch tokens. */
export const GET = () => oauthJson(authorizationServerMetadata());
export const OPTIONS = preflight;
