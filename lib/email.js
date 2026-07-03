/**
 * Email sending via Resend.
 * Used for: customer login codes, notifications, team alerts.
 */

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = `${process.env.EMAIL_FROM_NAME || 'Summit Sensory Gym'} <${process.env.EMAIL_FROM || 'portal@summitsensorygym.com'}>`;
const TEAM_EMAIL = process.env.NOTIFY_TEAM_EMAIL || 'orders@summitsensory.com';

// ── Customer login code ───────────────────────────────────────────────────────

export async function sendLoginCode(email, code) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Your Summit Portal login code: ${code}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <div style="margin-bottom:24px">
          <div style="width:42px;height:42px;background:#2f5d50;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px">
            <span style="color:#fff;font-size:22px;font-weight:700">S</span>
          </div>
          <h1 style="font-size:22px;color:#16201c;margin:0">Summit Sensory Gym Portal</h1>
        </div>
        <p style="color:#6f7a73;font-size:15px;margin:0 0 24px">Your one-time login code:</p>
        <div style="background:#f6f4ee;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#2f5d50">${code}</span>
        </div>
        <p style="color:#6f7a73;font-size:13px;margin:0">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

// ── Customer notifications ────────────────────────────────────────────────────

export async function notifyCustomerStatusChange(email, customerName, orderName, newStatus) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Your order status has been updated — ${orderName}`,
    html: emailWrapper(`
      <h2 style="font-size:20px;color:#16201c;margin:0 0 8px">Order Status Updated</h2>
      <p style="color:#6f7a73;margin:0 0 20px">Hi ${customerName || 'there'},</p>
      <p style="color:#16201c;margin:0 0 20px">Your order <strong>${orderName}</strong> has moved to a new stage:</p>
      <div style="background:#e7efe9;border-radius:10px;padding:16px;text-align:center;margin-bottom:24px">
        <span style="font-size:18px;font-weight:700;color:#1f4339">${newStatus}</span>
      </div>
      <a href="${process.env.NEXTAUTH_URL}/portal" style="display:inline-block;background:#2f5d50;color:#fff;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none">View your portal →</a>
    `),
  });
}

export async function notifyCustomerTaskDue(email, customerName, orderName, taskName) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Action required on your order — ${orderName}`,
    html: emailWrapper(`
      <h2 style="font-size:20px;color:#16201c;margin:0 0 8px">Action Required</h2>
      <p style="color:#6f7a73;margin:0 0 20px">Hi ${customerName || 'there'},</p>
      <p style="color:#16201c;margin:0 0 20px">We need you to complete a form for your order <strong>${orderName}</strong>:</p>
      <div style="background:#fbeede;border-radius:10px;padding:16px;margin-bottom:24px">
        <strong style="color:#7a4a1a">${taskName}</strong>
      </div>
      <a href="${process.env.NEXTAUTH_URL}/portal" style="display:inline-block;background:#2f5d50;color:#fff;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none">Complete the form →</a>
    `),
  });
}

export async function notifyCustomerBalanceChange(email, customerName, orderName, balance) {
  const isPaid = balance === 0;
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: isPaid ? `Balance cleared on ${orderName}` : `Balance updated on your order — ${orderName}`,
    html: emailWrapper(`
      <h2 style="font-size:20px;color:#16201c;margin:0 0 8px">${isPaid ? 'Balance Cleared 🎉' : 'Balance Updated'}</h2>
      <p style="color:#6f7a73;margin:0 0 20px">Hi ${customerName || 'there'},</p>
      ${isPaid
        ? `<p style="color:#16201c;margin:0 0 20px">Your balance for <strong>${orderName}</strong> has been marked as paid. Thank you!</p>`
        : `<p style="color:#16201c;margin:0 0 20px">The balance on your order <strong>${orderName}</strong> has been updated to <strong>$${balance.toFixed(2)}</strong>.</p>`
      }
      <a href="${process.env.NEXTAUTH_URL}/portal" style="display:inline-block;background:#2f5d50;color:#fff;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none">View your portal →</a>
    `),
  });
}

export async function notifyCustomerInstallationReady(email, customerName, orderName) {
  const portalUrl = process.env.NEXTAUTH_URL || 'https://your-portal.vercel.app';
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Your installation instructions are ready — ${orderName}`,
    html: emailWrapper(`
      <h2 style="font-size:20px;color:#16201c;margin:0 0 8px">Installation Instructions Ready</h2>
      <p style="color:#6f7a73;margin:0 0 20px">Hi ${customerName || 'there'},</p>
      <p style="color:#16201c;margin:0 0 16px">Your installation videos and documents for <strong>${orderName}</strong> are now available in your portal.</p>
      <div style="background:#F1F5F9;border-radius:10px;padding:16px;margin-bottom:24px;border-left:4px solid #475569">
        <p style="margin:0;font-weight:600;color:#334155">🖨️ We recommend printing your installation documents before your delivery date.</p>
        <p style="margin:8px 0 0;font-size:13px;color:#475569">Having printed instructions on hand makes installation significantly smoother — you won't need to reference a screen while assembling your equipment.</p>
      </div>
      <a href="${portalUrl}/portal" style="display:inline-block;background:#475569;color:#fff;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none">View Installation Instructions →</a>
      <p style="color:#6f7a73;font-size:13px;margin-top:20px">Questions? Reply to this email or message us directly through the portal.</p>
    `),
  });
}

export async function notifyCustomerNewFile(email, customerName, orderName, fileName) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `New file shared with you — ${orderName}`,
    html: emailWrapper(`
      <h2 style="font-size:20px;color:#16201c;margin:0 0 8px">New File Available</h2>
      <p style="color:#6f7a73;margin:0 0 20px">Hi ${customerName || 'there'},</p>
      <p style="color:#16201c;margin:0 0 20px">Summit Sensory Gym has shared a file with you for your order <strong>${orderName}</strong>:</p>
      <div style="background:#e6eef6;border-radius:10px;padding:16px;margin-bottom:24px">
        <strong style="color:#1e4a7a">📄 ${fileName}</strong>
      </div>
      <a href="${process.env.NEXTAUTH_URL}/portal" style="display:inline-block;background:#2f5d50;color:#fff;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none">View file →</a>
    `),
  });
}

// ── Portal invitation & reminders ────────────────────────────────────────────

export async function sendPortalInvitation(email, customerName, orderName) {
  const portalUrl = process.env.NEXTAUTH_URL || 'https://your-portal.vercel.app';
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Your Summit Sensory Gym portal is ready — action required`,
    html: emailWrapper(`
      <h2 style="font-size:22px;color:#16201c;margin:0 0 8px">Welcome to the Summit Portal</h2>
      <p style="color:#6f7a73;margin:0 0 20px">Hi ${customerName || 'there'},</p>
      <p style="color:#16201c;margin:0 0 16px">Your order <strong>${orderName}</strong> is underway and your customer portal is ready. We've set up a dedicated space where you can track your order, complete required documentation, and communicate directly with our team.</p>
      <p style="color:#16201c;margin:0 0 20px"><strong>To get your order into manufacturing as quickly as possible, please log in and complete the following steps:</strong></p>
      <div style="background:#f6f4ee;border-radius:12px;padding:18px 20px;margin-bottom:24px">
        <div style="display:flex;gap:12px;margin-bottom:10px"><span style="color:#2f5d50;font-weight:700">1.</span><span>Confirm your contact information</span></div>
        <div style="display:flex;gap:12px;margin-bottom:10px"><span style="color:#2f5d50;font-weight:700">2.</span><span>Provide your billing details</span></div>
        <div style="display:flex;gap:12px;margin-bottom:10px"><span style="color:#2f5d50;font-weight:700">3.</span><span>Confirm delivery details and sign the freight acknowledgment</span></div>
        <div style="display:flex;gap:12px;margin-bottom:10px"><span style="color:#2f5d50;font-weight:700">4.</span><span>Confirm site readiness</span></div>
        <div style="display:flex;gap:12px;margin-bottom:10px"><span style="color:#2f5d50;font-weight:700">5.</span><span>Complete your color selection form</span></div>
        <div style="display:flex;gap:12px"><span style="color:#2f5d50;font-weight:700">6.</span><span>Complete the Pickup &amp; Delivery form</span></div>
      </div>
      <p style="color:#6f7a73;font-size:14px;margin:0 0 20px">To log in, simply visit the portal and enter your email address. We'll send you a one-time code — no password needed.</p>
      <a href="${portalUrl}" style="display:inline-block;background:#2f5d50;color:#fff;padding:14px 24px;border-radius:10px;font-weight:700;text-decoration:none;font-size:16px">Access Your Portal →</a>
      <p style="color:#6f7a73;font-size:13px;margin-top:20px">Questions? Reply to this email or message us through the portal. We're here to help.</p>
    `),
  });
}

export async function sendSetupReminder(email, customerName, orderName, incompleteTabs, reminderNumber) {
  const portalUrl = process.env.NEXTAUTH_URL || 'https://your-portal.vercel.app';
  const urgency = reminderNumber >= 3 ? '⚠️ ' : '';
  const subject = reminderNumber >= 3
    ? `Action required — documentation needed to proceed with your order`
    : `Friendly reminder — a few steps left on your Summit portal`;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: urgency + subject,
    html: emailWrapper(`
      <h2 style="font-size:20px;color:#16201c;margin:0 0 8px">${reminderNumber >= 3 ? '⚠️ Documentation Required' : 'A Few Steps Left'}</h2>
      <p style="color:#6f7a73;margin:0 0 20px">Hi ${customerName || 'there'},</p>
      <p style="color:#16201c;margin:0 0 16px">Your order <strong>${orderName}</strong> is waiting on a few items before we can move into the next phase of manufacturing.</p>
      <p style="color:#16201c;margin:0 0 12px"><strong>Still needed:</strong></p>
      <div style="background:#fbeede;border-radius:10px;padding:16px;margin-bottom:24px;border:1px solid #f0c490">
        ${incompleteTabs.map(tab => `<div style="padding:4px 0;color:#7a4a1a">• ${tab}</div>`).join('')}
      </div>
      ${reminderNumber >= 3 ? '<p style="color:#b5485d;font-weight:600;margin:0 0 20px">Your order cannot proceed to the next manufacturing phase until these items are complete.</p>' : ''}
      <a href="${portalUrl}" style="display:inline-block;background:#2f5d50;color:#fff;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none">Complete Now →</a>
      <p style="color:#6f7a73;font-size:13px;margin-top:20px">This takes about 5 minutes. If you have questions, message us through the portal.</p>
    `),
  });
}

export async function sendCustomerReplyNotification(email, customerName, orderName, messagePreview) {
  const portalUrl = process.env.NEXTAUTH_URL || 'https://your-portal.vercel.app';
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `New message from Summit Sensory Gym — ${orderName}`,
    html: emailWrapper(`
      <h2 style="font-size:20px;color:#16201c;margin:0 0 8px">New Message</h2>
      <p style="color:#6f7a73;margin:0 0 20px">Hi ${customerName || 'there'},</p>
      <p style="color:#16201c;margin:0 0 16px">The Summit Sensory Gym team replied to your message about order <strong>${orderName}</strong>:</p>
      <div style="background:#f6f4ee;border-radius:10px;padding:14px 16px;margin-bottom:24px;border-left:3px solid #2f5d50;font-style:italic;color:#6f7a73">
        ${messagePreview}
      </div>
      <a href="${portalUrl}/portal" style="display:inline-block;background:#2f5d50;color:#fff;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none">View & Reply in Portal →</a>
    `),
  });
}

// ── Team notifications ────────────────────────────────────────────────────────

export async function notifyTeamFormCompleted(orderName, customerEmail, formName) {
  await resend.emails.send({
    from: FROM,
    to: TEAM_EMAIL,
    subject: `[Portal] Form completed — ${orderName}`,
    html: emailWrapper(`
      <h2 style="font-size:18px;color:#16201c;margin:0 0 8px">Form Completed</h2>
      <p><strong>${customerEmail}</strong> completed <strong>${formName}</strong> for order <strong>${orderName}</strong>.</p>
      <p style="margin-top:12px"><a href="${process.env.NEXTAUTH_URL}/admin" style="color:#2f5d50;font-weight:600">View in Admin Portal →</a></p>
    `),
  });
}

export async function notifyTeamNewMessage(orderName, customerEmail, messagePreview) {
  await resend.emails.send({
    from: FROM,
    to: TEAM_EMAIL,
    subject: `[Portal] New message — ${orderName}`,
    html: emailWrapper(`
      <h2 style="font-size:18px;color:#16201c;margin:0 0 8px">New Customer Message</h2>
      <p>From: <strong>${customerEmail}</strong></p>
      <p>Order: <strong>${orderName}</strong></p>
      <div style="background:#f6f4ee;border-radius:10px;padding:14px;margin:12px 0;font-style:italic;color:#6f7a73">
        "${messagePreview}"
      </div>
      <p style="margin-top:8px;font-size:13px;color:#6f7a73">Reply directly in Monday.com on the order item, or log into the admin portal.</p>
      <a href="${process.env.NEXTAUTH_URL}/admin" style="color:#2f5d50;font-weight:600">Open Admin Portal →</a>
    `),
  });
}

export async function notifyTeamContactChange(orderName, customerEmail, changedFields) {
  await resend.emails.send({
    from: FROM,
    to: TEAM_EMAIL,
    subject: `⚠️ [Portal] Contact info changed — ${orderName}`,
    html: emailWrapper(`
      <div style="background:#f7e6ea;border-radius:10px;padding:14px;margin-bottom:16px;border:1px solid #e0a0af">
        <strong style="color:#7a1f30">⚠️ Customer contact information has been updated</strong>
      </div>
      <p>Order: <strong>${orderName}</strong></p>
      <p>Customer: <strong>${customerEmail}</strong></p>
      <p style="margin-top:12px">Fields changed: <strong>${changedFields.join(', ')}</strong></p>
      <p style="margin-top:12px;color:#6f7a73;font-size:13px">Please verify the updated information in Monday.com before shipping.</p>
      <p style="margin-top:12px"><a href="${process.env.NEXTAUTH_URL}/admin" style="color:#2f5d50;font-weight:600">View in Admin Portal →</a></p>
    `),
  });
}

// ── Shared email wrapper ──────────────────────────────────────────────────────

function emailWrapper(content) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
      <div style="margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #e3ddd0">
        <span style="font-size:18px;font-weight:700;color:#2f5d50">Summit Sensory Gym</span>
      </div>
      ${content}
      <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e3ddd0">
        <p style="font-size:12px;color:#6f7a73;margin:0">
          Summit Sensory Gym · Denver, CO ·
          <a href="${process.env.NEXTAUTH_URL}" style="color:#2f5d50">Portal</a>
        </p>
      </div>
    </div>
  `;
}
