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
    async signIn({ user }) {
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
  session: { strategy: 'jwt' },
};

export default NextAuth(authOptions);
