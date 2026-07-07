import { handleAuth } from "@workos-inc/authkit-nextjs";

// Completes the WorkOS AuthKit code exchange and sets the session cookie.
export const GET = handleAuth();
