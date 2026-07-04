/**
 * Email sending via Resend.
 * FROM: portal@updates.summitsensory.com
 *
 * Set EMAIL_LOGO_URL in Vercel env vars to embed your logo in every email.
 * Example: https://summitsensory.com/images/logo.png (must be a public URL)
 */

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = `Summit Sensory Gym <${process.env.EMAIL_FROM || 'portal@updates.summitsensory.com'}>`;
const TEAM_EMAIL = process.env.NOTIFY_TEAM_EMAIL || 'orders@summitsensory.com';
const PORTAL_URL = process.env.NEXTAUTH_URL || 'https://customer-portal-seven-delta.vercel.app';
const LOGO_URL = process.env.EMAIL_LOGO_URL || `${PORTAL_URL}/ssg-logo.png`;

// ── Colors — matched exactly to globals.css portal variables ─────────────────
const C = {
  moss:     '#475569',  // --moss
  mossDark: '#334155',  // --moss-dk
  mossLt:   '#F1F5F9',  // --moss-lt
  paper:    '#F8F9FA',  // --paper
  white:    '#FFFFFF',
  ink:      '#111827',  // --ink
  muted:    '#6B7280',  // --mut
  line:     '#E5E7EB',  // --line
  warn:     '#92400E',
  warnBg:   '#FEF3C7',
  warnBdr:  '#F59E0B',
  ok:       '#16A34A',  // --ok
  okBg:     '#DCFCE7',  // --ok-lt
};

// ── Shared email shell ────────────────────────────────────────────────────────

function shell(content, { preheader = '' } = {}) {
  const logoBlock = LOGO_URL
    ? `<img src="${LOGO_URL}" alt="Summit Sensory Gym" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:10px" />`
    : `<div style="display:inline-flex;align-items:center;gap:10px">
         <div style="width:36px;height:36px;background:${C.moss};border-radius:9px;display:inline-flex;align-items:center;justify-content:center">
           <span style="color:#fff;font-size:18px;font-weight:800;line-height:1">S</span>
         </div>
         <span style="font-size:17px;font-weight:700;color:${C.ink};letter-spacing:-.3px">Summit Sensory Gym</span>
       </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Summit Sensory Gym</title>
  ${preheader ? `<!--[if !mso]><!--><div style="display:none;max-height:0;overflow:hidden">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div><!--<![endif]-->` : ''}
</head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%;mso-line-height-rule:exactly">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};min-height:100vh">
    <tr>
      <td align="center" style="padding:40px 16px 48px">

        <!-- Logo row -->
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;margin-bottom:24px">
          <tr>
            <td style="padding:0 4px">${logoBlock}</td>
          </tr>
        </table>

        <!-- Card -->
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:${C.white};border-radius:16px;overflow:hidden;border:1px solid ${C.line}">
          <tr>
            <!-- Top accent bar -->
            <td height="5" style="background:linear-gradient(90deg,${C.moss} 0%,${C.mossDark} 100%);font-size:0;line-height:0">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:40px 40px 36px">
              ${content}
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;margin-top:28px">
          <tr>
            <td style="text-align:center;font-family:Arial,sans-serif;font-size:12px;color:${C.muted};line-height:1.8;padding:0 4px">
              <strong style="color:${C.ink}">Summit Sensory Gym</strong><br />
              <a href="mailto:orders@summitsensory.com" style="color:${C.moss};text-decoration:none">orders@summitsensory.com</a>
              &nbsp;·&nbsp;
              <a href="tel:+17204575500" style="color:${C.moss};text-decoration:none">(720) 457-5500</a><br />
              <span style="color:${C.line}">──────────────────────────</span><br />
              You're receiving this because you have an active order with Summit Sensory Gym.<br />
              <a href="${PORTAL_URL}" style="color:${C.moss};text-decoration:none">Visit your portal</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Reusable building blocks ──────────────────────────────────────────────────

function btn(label, href, { bg = C.moss, color = '#fff' } = {}) {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:28px">
    <tr>
      <td style="background:${bg};border-radius:10px">
        <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:${color};text-decoration:none;letter-spacing:-.1px">${label} &rarr;</a>
      </td>
    </tr>
  </table>`;
}

function callout(text, { bg = C.mossLt, border = C.moss, icon = '' } = {}) {
  return `<div style="background:${bg};border-left:4px solid ${border};border-radius:0 10px 10px 0;padding:14px 16px;margin:20px 0;font-family:Arial,sans-serif;font-size:14px;color:${C.ink};line-height:1.6">
    ${icon ? `${icon}&nbsp; ` : ''}${text}
  </div>`;
}

function checklist(items) {
  return `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${C.paper};border-radius:12px;border:1px solid ${C.line};margin:20px 0">
    ${items.map((item, i) => `
    <tr>
      <td style="padding:${i === 0 ? '14px 16px 10px' : '10px 16px'} ${i === items.length - 1 ? '14px' : '0'};border-bottom:${i < items.length - 1 ? `1px solid ${C.line}` : 'none'}">
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%">
          <tr>
            <td width="28" style="vertical-align:top;padding-top:1px">
              <div style="width:22px;height:22px;background:${C.moss};border-radius:50%;text-align:center;line-height:22px;font-size:12px;font-weight:700;color:#fff">${i + 1}</div>
            </td>
            <td style="font-family:Arial,sans-serif;font-size:14px;color:${C.ink};line-height:1.5;padding-left:8px">${item}</td>
          </tr>
        </table>
      </td>
    </tr>`).join('')}
  </table>`;
}

function incompleteList(tabs) {
  return `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${C.warnBg};border-radius:12px;border:1px solid ${C.warnBdr};margin:20px 0">
    ${tabs.map((tab, i) => `
    <tr>
      <td style="padding:${i === 0 ? '14px 16px 10px' : '10px 16px'} ${i === tabs.length - 1 ? '14px' : '0'};border-bottom:${i < tabs.length - 1 ? `1px solid ${C.warnBdr}` : 'none'}">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="24" style="vertical-align:top;padding-top:2px;font-size:14px">&#9679;</td>
            <td style="font-family:Arial,sans-serif;font-size:14px;color:${C.warn};font-weight:600;line-height:1.5">${tab}</td>
          </tr>
        </table>
      </td>
    </tr>`).join('')}
  </table>`;
}

function h1(text) {
  return `<h1 style="font-family:Arial,sans-serif;font-size:22px;font-weight:800;color:${C.ink};margin:0 0 6px;letter-spacing:-.3px">${text}</h1>`;
}

function p(text, { muted = false, small = false } = {}) {
  return `<p style="font-family:Arial,sans-serif;font-size:${small ? 13 : 15}px;color:${muted ? C.muted : C.ink};margin:0 0 14px;line-height:1.65">${text}</p>`;
}

function divider() {
  return `<div style="border-top:1px solid ${C.line};margin:24px 0"></div>`;
}

// ── Customer login code ───────────────────────────────────────────────────────

export async function sendLoginCode(email, code) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Your Summit Portal login code: ${code}`,
    html: shell(`
      ${h1('Your Login Code')}
      ${p('Use the code below to sign in to your Summit Sensory Gym portal. It expires in <strong>10 minutes</strong>.')}
      <div style="text-align:center;background:${C.paper};border-radius:14px;border:1px solid ${C.line};padding:28px 20px;margin:24px 0">
        <div style="font-family:'Courier New',monospace;font-size:42px;font-weight:700;letter-spacing:12px;color:${C.moss}">${code}</div>
      </div>
      ${p("If you didn't request this code, someone may have entered your email by mistake. You can safely ignore this email — your account is not at risk.", { muted: true, small: true })}
    `, { preheader: `Your one-time code is ${code} — expires in 10 minutes` }),
  });
}

// ── Portal invitation ─────────────────────────────────────────────────────────

export async function sendPortalInvitation(email, customerName, orderName) {
  const name = customerName || 'there';
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Your Summit Sensory Gym portal is ready — action required`,
    html: shell(`
      ${h1('Welcome to Your Order Portal')}
      ${p(`Hi ${name},`)}
      ${p(`Your order <strong>${orderName}</strong> is underway and your customer portal is ready. To keep manufacturing on schedule, we need you to complete a few steps as soon as possible.`)}
      ${p('<strong>Please complete the following before your order can move into production:</strong>')}
      ${checklist([
        'Confirm your contact information',
        'Provide your billing details',
        'Confirm delivery logistics and sign the freight acknowledgment',
        'Complete your color and product selection form',
        'Submit all required documentation',
      ])}
      ${p('Sign in with your email address — no password needed. We\'ll send you a one-time code.', { muted: true, small: true })}
      ${btn('Access Your Portal', PORTAL_URL)}
      ${divider()}
      ${p('Questions? Reply to this email or message our team directly through the portal once you\'re logged in.', { muted: true, small: true })}
    `, { preheader: `Action required: complete your order portal setup for ${orderName}` }),
  });
}

// ── Setup reminders ───────────────────────────────────────────────────────────

export async function sendSetupReminder(email, customerName, orderName, incompleteTabs, reminderNumber) {
  const name = customerName || 'there';
  const isUrgent = reminderNumber >= 3;
  const subject = isUrgent
    ? `⚠️ Documentation required to proceed — ${orderName}`
    : reminderNumber === 2
    ? `Reminder: a few steps still needed for your order — ${orderName}`
    : `Quick reminder: your portal setup isn't complete yet — ${orderName}`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject,
    html: shell(`
      ${h1(isUrgent ? 'Action Required — Order On Hold' : 'A Few Steps Still Needed')}
      ${p(`Hi ${name},`)}
      ${p(isUrgent
        ? `Your order <strong>${orderName}</strong> cannot move forward until the following items are complete. Please log in and finish these as soon as possible to avoid delays.`
        : `We're still waiting on a few items for your order <strong>${orderName}</strong>. These should only take a few minutes — completing them now keeps your order on schedule.`
      )}
      ${p('<strong>Still needed from you:</strong>')}
      ${incompleteList(incompleteTabs)}
      ${isUrgent ? callout('Your order is currently on hold. Manufacturing cannot begin until all required steps are complete.', { bg: C.warnBg, border: C.warnBdr }) : ''}
      ${p('Log in with your email address — we\'ll send you a one-time code and take you directly to the steps that still need attention.', { muted: true, small: true })}
      ${btn('Complete My Setup Now', PORTAL_URL)}
      ${divider()}
      ${p('This takes about 5 minutes. If you have any questions or need help, message our team through the portal.', { muted: true, small: true })}
    `, { preheader: `${incompleteTabs.length} item${incompleteTabs.length > 1 ? 's' : ''} still needed for ${orderName}` }),
  });
}

// ── Order status change ───────────────────────────────────────────────────────

export async function notifyCustomerStatusChange(email, customerName, orderName, newStatus) {
  const name = customerName || 'there';

  const statusMessages = {
    'In Manufacturing': { icon: '🔧', headline: 'Your Order Is Now In Manufacturing', body: `Great news — all required documentation has been received and your order is now in active production. We\'ll notify you when it\'s ready to ship.` },
    'Ready to Ship':    { icon: '📦', headline: 'Your Order Is Ready to Ship', body: `Your equipment is packed and ready. Our logistics team will be in touch shortly to confirm your delivery window.` },
    'Shipped':          { icon: '🚚', headline: 'Your Order Has Shipped', body: `Your equipment is on its way. Log into the portal to view tracking information and delivery details.` },
    'Delivered':        { icon: '✅', headline: 'Delivery Confirmed', body: `Your equipment has been marked as delivered. Log into your portal to access installation videos, documents, and support resources.` },
  };

  const msg = statusMessages[newStatus] || { icon: '📋', headline: 'Order Status Updated', body: `Your order <strong>${orderName}</strong> has been updated to: <strong>${newStatus}</strong>.` };

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `${msg.headline} — ${orderName}`,
    html: shell(`
      <div style="font-size:40px;margin-bottom:16px">${msg.icon}</div>
      ${h1(msg.headline)}
      ${p(`Hi ${name},`)}
      ${p(msg.body)}
      <div style="background:${C.mossLt};border-radius:12px;padding:16px 20px;margin:20px 0;text-align:center">
        <span style="font-family:Arial,sans-serif;font-size:13px;color:${C.muted};font-weight:600;text-transform:uppercase;letter-spacing:.06em">Current Status</span><br />
        <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:800;color:${C.moss}">${newStatus}</span>
      </div>
      ${btn('View Order in Portal', `${PORTAL_URL}/portal`)}
      ${divider()}
      ${p('Questions? Message our team directly through the portal.', { muted: true, small: true })}
    `, { preheader: `${orderName} — status updated to ${newStatus}` }),
  });
}

// ── Color form ready ──────────────────────────────────────────────────────────

export async function notifyCustomerColorFormReady(email, customerName, orderName) {
  const name = customerName || 'there';
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Your color selection form is ready — ${orderName}`,
    html: shell(`
      <div style="font-size:40px;margin-bottom:16px">🎨</div>
      ${h1('Your Color Selection Form Is Ready')}
      ${p(`Hi ${name},`)}
      ${p(`Your color and product selection form for order <strong>${orderName}</strong> is ready to complete in your portal. Your selections determine the final configuration of your equipment — please complete this as soon as possible so we can confirm your order details before manufacturing begins.`)}
      ${callout('Completing this form is required before your order can move into production. It should take less than 5 minutes.', { icon: '⏱️' })}
      ${p('The form is embedded directly in your portal — you won\'t need to navigate anywhere else.', { muted: true, small: true })}
      ${btn('Complete Color Selections', `${PORTAL_URL}/portal`)}
      ${divider()}
      ${p('Questions about colors or options? Message our team through the portal and we\'ll help you choose.', { muted: true, small: true })}
    `, { preheader: `Action required: complete your color selections for ${orderName}` }),
  });
}

// ── Installation ready ────────────────────────────────────────────────────────

export async function notifyCustomerInstallationReady(email, customerName, orderName) {
  const name = customerName || 'there';
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Your installation materials are ready — ${orderName}`,
    html: shell(`
      <div style="font-size:40px;margin-bottom:16px">🔧</div>
      ${h1('Your Installation Materials Are Ready')}
      ${p(`Hi ${name},`)}
      ${p(`Your installation videos and documents for order <strong>${orderName}</strong> are now available in your portal. We recommend reviewing these <strong>before your delivery date</strong> so your team is prepared.`)}
      ${callout('🖨️&nbsp; We recommend printing your installation documents before delivery day. Having physical copies on hand makes the assembly process significantly smoother.', { bg: '#FFFBEB', border: '#F59E0B' })}
      <div style="background:${C.paper};border-radius:12px;border:1px solid ${C.line};padding:16px 20px;margin:20px 0">
        <p style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.05em;margin:0 0 10px">Your portal includes</p>
        ${['Step-by-step installation videos', 'Printed installation guide (PDF)', 'Anchor point and safety requirements', 'Assembly diagrams and hardware lists'].map(item =>
          `<p style="font-family:Arial,sans-serif;font-size:14px;color:${C.ink};margin:0 0 8px;padding-left:4px">&#10003;&nbsp; ${item}</p>`
        ).join('')}
      </div>
      ${btn('View Installation Materials', `${PORTAL_URL}/portal`)}
      ${divider()}
      ${p('Have installation questions? Message our team through the portal — we\'re here to help.', { muted: true, small: true })}
    `, { preheader: `Installation videos and documents are ready for ${orderName}` }),
  });
}

// ── New file shared ───────────────────────────────────────────────────────────

export async function notifyCustomerNewFile(email, customerName, orderName, fileName) {
  const name = customerName || 'there';
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `New document available — ${orderName}`,
    html: shell(`
      <div style="font-size:40px;margin-bottom:16px">📄</div>
      ${h1('A New File Has Been Shared With You')}
      ${p(`Hi ${name},`)}
      ${p(`Summit Sensory Gym has shared a new document with you for order <strong>${orderName}</strong>.`)}
      <div style="background:${C.paper};border-radius:12px;border:1px solid ${C.line};padding:16px 20px;margin:20px 0;display:flex;align-items:center;gap:14px">
        <span style="font-size:28px">📎</span>
        <span style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:${C.ink}">${fileName}</span>
      </div>
      ${btn('View File in Portal', `${PORTAL_URL}/portal`)}
    `, { preheader: `New document shared: ${fileName} — ${orderName}` }),
  });
}

// ── New portal message (customer → team notification) ─────────────────────────

export async function notifyCustomerTaskDue(email, customerName, orderName, taskName) {
  const name = customerName || 'there';
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Action required on your order — ${orderName}`,
    html: shell(`
      ${h1('Action Required')}
      ${p(`Hi ${name},`)}
      ${p(`We need you to complete the following for your order <strong>${orderName}</strong>:`)}
      ${callout(`<strong>${taskName}</strong>`, { icon: '📋' })}
      ${btn('Complete Now', PORTAL_URL)}
    `, { preheader: `Action required: ${taskName} — ${orderName}` }),
  });
}

// ── Balance update ────────────────────────────────────────────────────────────

export async function notifyCustomerBalanceChange(email, customerName, orderName, balance) {
  const name = customerName || 'there';
  const isPaid = balance === 0;
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: isPaid ? `Payment received — thank you! — ${orderName}` : `Payment reminder — ${orderName}`,
    html: shell(`
      <div style="font-size:40px;margin-bottom:16px">${isPaid ? '🎉' : '💳'}</div>
      ${h1(isPaid ? 'Payment Received — Thank You!' : 'Payment Reminder')}
      ${p(`Hi ${name},`)}
      ${isPaid
        ? p(`Your payment for order <strong>${orderName}</strong> has been received and your balance is now cleared. Thank you!`)
        : p(`A balance is due on your order <strong>${orderName}</strong>. Log into your portal to view your invoice and submit payment.`)
      }
      ${!isPaid ? `<div style="background:${C.paper};border-radius:12px;border:1px solid ${C.line};padding:16px 20px;margin:20px 0;text-align:center">
        <span style="font-family:Arial,sans-serif;font-size:13px;color:${C.muted};font-weight:600;text-transform:uppercase;letter-spacing:.06em">Balance Due</span><br />
        <span style="font-family:Arial,sans-serif;font-size:28px;font-weight:800;color:${C.ink}">$${balance.toFixed(2)}</span>
      </div>` : ''}
      ${btn(isPaid ? 'View Your Portal' : 'View Invoice & Pay Now', `${PORTAL_URL}/portal`)}
    `, { preheader: isPaid ? `Payment confirmed for ${orderName}` : `Balance of $${balance?.toFixed(2)} due on ${orderName}` }),
  });
}

// ── Message reply notification (team → customer) ──────────────────────────────

export async function sendCustomerReplyNotification(email, customerName, orderName, messagePreview) {
  const name = customerName || 'there';
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `New message from Summit Sensory Gym — ${orderName}`,
    html: shell(`
      <div style="font-size:40px;margin-bottom:16px">💬</div>
      ${h1('You Have a New Message')}
      ${p(`Hi ${name},`)}
      ${p(`The Summit Sensory Gym team replied to your message regarding order <strong>${orderName}</strong>.`)}
      <div style="background:${C.paper};border-left:4px solid ${C.moss};border-radius:0 12px 12px 0;padding:16px 20px;margin:20px 0;font-family:Arial,sans-serif;font-size:14px;color:${C.muted};line-height:1.65;font-style:italic">
        &ldquo;${messagePreview}&rdquo;
      </div>
      ${btn('Read & Reply in Portal', `${PORTAL_URL}/portal`)}
      ${divider()}
      ${p('Replies sent outside the portal may not be linked to your order. Use the Messages tab in your portal for the fastest response.', { muted: true, small: true })}
    `, { preheader: `The Summit team replied to your message — ${orderName}` }),
  });
}

// ── Team notifications ────────────────────────────────────────────────────────

export async function notifyTeamNewMessage(orderName, customerEmail, messagePreview) {
  await resend.emails.send({
    from: FROM,
    to: TEAM_EMAIL,
    subject: `[Portal] New customer message — ${orderName}`,
    html: shell(`
      ${h1('New customer message')}
      ${p(`<strong>${customerEmail}</strong> sent a message through the portal for order <strong>${orderName}</strong>.`)}
      <div style="background:${C.paper};border-left:4px solid ${C.moss};border-radius:0 12px 12px 0;padding:14px 18px;margin:16px 0;font-family:Arial,sans-serif;font-size:14px;color:${C.muted};font-style:italic">&ldquo;${messagePreview}&rdquo;</div>
      ${p('Reply to the <strong>[PORTAL]</strong> update in Monday.com — your reply will appear in the customer\'s Messages tab.', { small: true })}
      ${btn('Open Admin Portal', `${PORTAL_URL}/admin`)}
    `),
  });
}

export async function notifyTeamFormCompleted(orderName, customerEmail, formName) {
  await resend.emails.send({
    from: FROM,
    to: TEAM_EMAIL,
    subject: `[Portal] Form completed — ${orderName}`,
    html: shell(`
      ${h1('Form completed')}
      ${p(`<strong>${customerEmail}</strong> submitted <strong>${formName}</strong> for order <strong>${orderName}</strong>.`)}
      ${btn('View in Admin Portal', `${PORTAL_URL}/admin`)}
    `),
  });
}

export async function notifyTeamContactChange(orderName, customerEmail, changedFields) {
  await resend.emails.send({
    from: FROM,
    to: TEAM_EMAIL,
    subject: `⚠️ [Portal] Contact info changed — ${orderName}`,
    html: shell(`
      ${callout('Customer contact information has been updated. Please verify in Monday.com before shipment.', { bg: '#FEF2F2', border: '#EF4444', icon: '⚠️' })}
      ${h1('Contact information updated')}
      ${p(`Order: <strong>${orderName}</strong>`)}
      ${p(`Customer: <strong>${customerEmail}</strong>`)}
      ${p(`Fields changed: <strong>${changedFields.join(', ')}</strong>`)}
      ${btn('Review in Admin Portal', `${PORTAL_URL}/admin`)}
    `),
  });
}
