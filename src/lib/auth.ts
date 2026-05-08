import NextAuth from "next-auth"

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        {
            id: "linuxdo",
            name: "Linux DO",
            type: "oidc",
            // Use OIDC discovery (/.well-known/openid-configuration); Connect requires S256 PKCE.
            issuer: "https://connect.linux.do/",
            clientId: process.env.OAUTH_CLIENT_ID,
            clientSecret: process.env.OAUTH_CLIENT_SECRET,
            authorization: {
                params: { scope: "openid profile email" },
            },
            profile(profile) {
                const pid = profile.id ?? (profile as { sub?: string }).sub
                return {
                    id: String(pid),
                    name: profile.username || profile.name,
                    email: profile.email, // Check if Linux DO returns email
                    image: profile.avatar_url,
                    trustLevel: profile.trust_level
                }
            },
        }
    ],
    callbacks: {
        async jwt({ token, user, profile }) {
            if (profile) {
                const p = profile as {
                    id?: string | number
                    sub?: string
                    username?: string
                    trust_level?: number
                    avatar_url?: string
                }
                token.id = String(p.id ?? p.sub)
                token.username = p.username
                token.trustLevel = p.trust_level
                token.avatar_url = p.avatar_url
            }
            return token
        },
        async session({ session, token }) {
            if (token) {
                session.user.id = token.id as string
                // @ts-ignore
                session.user.username = token.username
                // @ts-ignore
                session.user.trustLevel = token.trustLevel
                // @ts-ignore
                session.user.avatar_url = token.avatar_url
            }
            return session
        }
    },
    // Use OAUTH_CLIENT_SECRET as fallback if NEXTAUTH_SECRET is not set
    secret: process.env.NEXTAUTH_SECRET || process.env.OAUTH_CLIENT_SECRET,
    trustHost: true,

})
