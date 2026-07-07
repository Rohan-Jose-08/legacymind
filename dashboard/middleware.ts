import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

// Everything is behind SSO except the OAuth callback itself. Enterprise
// expectation from day one: no anonymous surface at all.
export default authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/callback"],
  },
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
