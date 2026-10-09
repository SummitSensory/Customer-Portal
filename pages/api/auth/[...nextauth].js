import NextAuth from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { isStaffEmail } from '../../../lib/auth';

// Without a tenant id next-auth's Azure AD provider uses the multi-tenant
// "common" endpoint, which accepts accounts from ANY Microsoft tenant. Not
// thrown — that would take the whole site down — but logged loudly (every
// console.error is emailed via lib/errorAlerts.js).
if (!process.env.AZURE_AD_TENANT_ID) {
  console.error('AZURE_AD_TENANT_ID is not set — staff sign-in accepts accounts from any Microsoft tenant. Set it in Vercel.');
}

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
      // Restrict staff login to the configured domain
      if (!isStaffEmail(user.email)) {
        return false;
      }
      // The email claim alone is not proof of staff: with the multi-tenant
      // ("common") endpoint, another tenant's admin can mint an account
      // whose email claim is a @summitsensory.com address. Pin sign-in to
      // our tenant (audit 2026-10-09).
      const tenantId = process.env.AZURE_AD_TENANT_ID;
      if (tenantId && profile?.tid && profile.tid !== tenantId) {
        console.error(`Staff sign-in REJECTED for ${user.email}: token tenant ${profile.tid} is not ${tenantId}.`);
        return false;
      }
      if (tenantId && !profile?.tid) {
        console.warn(`Staff sign-in for ${user.email}: no tid claim in the Azure AD profile — tenant could not be verified.`);
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
  session: { strategy: 'jwt' },
};

export default NextAuth(authOptions);
