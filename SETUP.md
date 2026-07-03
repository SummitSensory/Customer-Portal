# Summit Sensory Gym Portal — Setup Guide

## What's been built

A full-stack Next.js web application with:
- **Customer portal** — email code login, order dashboard, timeline, action items (Jotform), files, invoice/balance, messaging
- **Admin portal** — M365 SSO login, orders table, customer list, file manager, messaging, 7-tab settings
- **Integrations** — Monday.com (orders + files), Jotform (webhooks), FedEx Track API, Resend (email)

---



## Step 1 — Install dependencies

You'll need Node.js 18+ installed on your computer or CI/CD environment.

```bash
cd "Customer Portal"
npm install
```

---

## Step 2 — Set up Monday.com board columns

In your **Manufacturing Process** board, confirm or add these columns:
| Column | Type | Notes |
|---|---|---|
| Customer Email | Email | Match customers to orders |
| Status | Status | Use these labels: Order Placed, Deposit Received, In Manufacturing, Ready to Ship, Shipped, Delivered |
| Tracking Number | Text | FedEx tracking number |
| Files | File | Portal files (shared with customer) |
| Balance | Numbers | Amount owed |
| Invoice Link | Link | URL to invoice |
| Ship Date | Date | Estimated/actual ship date |
| Phone | Phone | Customer phone |
| Address | Location | Ship-to address |
| Contact Name | Text | Primary contact name |
| Product Type | Dropdown | e.g. Sensory Gym Package, Swing Frame, etc. |

After adding columns, note their **column IDs** (visible in the column settings menu).

---

## Step 3 — Set up Azure AD (Microsoft 365 SSO)

1. Go to [portal.azure.com](https://portal.azure.com) → Azure Active Directory → App Registrations → New Registration
2. Name: `Summit Portal`
3. Supported account types: Single tenant
4. Redirect URI: `https://your-domain.vercel.app/api/auth/callback/azure-ad`
5. After creating, note: **Application (client) ID** and **Directory (tenant) ID**
6. Go to Certificates & Secrets → New Client Secret → note the **Value**

---

## Step 4 — Set up Resend (email)

1. Sign up at [resend.com](https://resend.com) (free tier works)
2. Add your domain (`summitsensorygym.com`) and verify DNS records
3. Create an API key — note it

---

## Step 5 — Deploy to Vercel

1. Push this folder to a GitHub repository (private)
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. Set the **Root Directory** to the project folder
4. Add all environment variables from `.env.example`:

```
MONDAY_API_TOKEN=eyJhbGci... (your key)
MONDAY_BOARD_ID=            (get from your board URL)
MONDAY_COL_CUSTOMER_EMAIL=  (column ID from Step 2)
MONDAY_COL_STATUS=          (column ID)
MONDAY_COL_TRACKING_NUMBER= (column ID)
MONDAY_COL_PORTAL_FILES=    (column ID)
MONDAY_COL_BALANCE=         (column ID)
MONDAY_COL_INVOICE_LINK=    (column ID)
MONDAY_COL_SHIP_DATE=       (column ID)
MONDAY_COL_PHONE=           (column ID)
MONDAY_COL_ADDRESS=         (column ID)
MONDAY_COL_CONTACT_NAME=    (column ID)
MONDAY_COL_PRODUCT_TYPE=    (column ID)

NEXTAUTH_URL=https://your-domain.vercel.app
NEXTAUTH_SECRET=            (run: openssl rand -base64 32)

AZURE_AD_CLIENT_ID=         (from Step 3)
AZURE_AD_CLIENT_SECRET=     (from Step 3)
AZURE_AD_TENANT_ID=         (from Step 3)
STAFF_EMAIL_DOMAIN=summitsensorygym.com

RESEND_API_KEY=             (from Step 4)
EMAIL_FROM=portal@summitsensorygym.com
EMAIL_FROM_NAME=Summit Sensory Gym
NOTIFY_TEAM_EMAIL=orders@summitsensorygym.com
```

5. Deploy.

---

## Step 6 — Configure Jotform forms

Set `JOTFORM_FORM_MAP` as a JSON environment variable in Vercel. Example:

```json
{
  "231234567890": {
    "name": "Site Assessment",
    "description": "Required before installation can begin",
    "productTypes": ["Sensory Gym Package"]
  },
  "231234567891": {
    "name": "Install Consent Form",
    "description": "Required for all orders"
  },
  "231234567892": {
    "name": "Post-Purchase Intake",
    "description": "Helps us customize your equipment"
  }
}
```

Then in each Jotform: **Settings → Integrations → Webhooks** → Add URL:
```
https://your-domain.vercel.app/api/jotform/webhook
```

---

## Step 7 — Configure FedEx (when ready)

1. Create a developer account at [developer.fedex.com](https://developer.fedex.com)
2. Create an app and request access to the **Track API**
3. Add `FEDEX_API_KEY`, `FEDEX_SECRET_KEY`, and `FEDEX_ACCOUNT_NUMBER` to Vercel

---

## Step 8 — Get your Monday.com Board ID

From your board URL: `https://monday.com/boards/XXXXXXXXXX` — copy the number and set it as `MONDAY_BOARD_ID`.

---

## Embedding in your website

Once deployed, embed the portal in summitsensorygym.com using an iframe or a direct link.

For a direct link (recommended): add a "Customer Portal" button that links to `https://your-portal-domain.vercel.app`.

For iframe embed: contact your website developer to add:
```html
<iframe src="https://your-portal-domain.vercel.app" style="width:100%;height:100vh;border:none;" />
```
