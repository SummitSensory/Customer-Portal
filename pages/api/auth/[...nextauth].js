import NextAuth from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { isStaffEmail } from '../../../lib/auth';

export const authOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      tenantId: process.env.AZURE_AD_TENANT_ID,
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      // AUDIT-2026-10-06: with AZURE_AD_TENANT_ID unset, next-auth's Azure AD
      // provider falls back to the multi-tenant "common" endpoint, and the
      // domain check below only inspects the `email` claim — which a user in
      // ANY Entra tenant can set to an @summitsensory.com address (the
      // "nOAuth" pattern). Require the tenant to be configured and pin every
      // sign-in to it, so only accounts from our own tenant become staff.
      const tenantId = process.env.AZURE_AD_TENANT_ID;
      if (!tenantId) {
        console.error('Staff sign-in refused: AZURE_AD_TENANT_ID is not set.');
        return false;
      }
      if (!profile?.tid || profile.tid !== tenantId) {
        console.warn('Staff sign-in refused: token tenant does not match AZURE_AD_TENANT_ID.');
        return false;
      }
      // Restrict staff login to the configured domain
      if (!isStaffEmail(user.email)) {
        return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = 'staff';
        token.email = user.email;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role;
      session.user.email = token.email;
      return session;
    },
  },
  pages: {
    signIn: '/',
    error: '/?error=auth',
  },
  // AUDIT-2026-10-06: the staff domain/tenant check only runs at sign-in, so a
  // session outlives a deprovisioned account until it expires. next-auth's
  // default is 30 days; cap it at 7.
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
};

export default NextAuth(authOptions);
