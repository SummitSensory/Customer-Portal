/**
 * Developer-owned trigger + merge-variable registry.
 *
 * This file is the ONLY place that decides which variables exist and which
 * templates they're available to — admins choose which of these variables to
 * drop into their content; they can never invent a new one. See
 * Email-Template-System-Design.md §B.4.
 *
 * `emCode` cross-references the reference codes already used throughout
 * Customer-Portal-Process-Flow.md, so a citation like "EM-04" in a change
 * request maps directly to a `triggerKey` here (`order_status_change`).
 */

function v(path, label, description, example, required = true) {
  return { path, label, description, example, required };
}

const CUSTOMER = [
  v('customer.first_name', 'First Name', "Customer's first name", 'Sarah'),
  v('customer.last_name', 'Last Name', "Customer's last name", 'Nguyen', false),
  v('customer.email', 'Email', "Customer's email address", 'sarah@example.com'),
];

const ORDER = [
  v('order.number', 'Order Number', 'The order/project name as it appears in Monday', 'Sensory Club of Denver'),
  v('portal.login_url', 'Portal Login Link', 'Link to the customer portal', 'https://portal.summitsensory.com'),
];

export const TRIGGERS = {
  portal_login_code: {
    key: 'portal_login_code', emCode: 'EM-01', label: 'Login Code',
    description: 'Automatically sent when a customer requests a sign-in code.',
    category: 'ACCOUNT',
    variables: [
      v('customer.code', 'Login Code', 'The 6-digit one-time code', '482913'),
    ],
  },
  portal_invitation: {
    key: 'portal_invitation', emCode: 'EM-02', label: 'Portal Invitation',
    description: 'Sent manually by staff from the Orders table ("Invite" action) when a customer\'s portal is ready.',
    category: 'CUSTOMER_PORTAL',
    variables: [...CUSTOMER, ...ORDER],
  },
  setup_reminder: {
    key: 'setup_reminder', emCode: 'EM-03', label: 'Setup Reminder',
    description: 'Sent automatically by the weekday 8am cron until all 5 setup tabs are complete (tone escalates on repeated reminders).',
    category: 'CUSTOMER_PORTAL',
    variables: [
      ...CUSTOMER, ...ORDER,
      v('setup.incomplete_tabs', 'Incomplete Tabs', 'Comma-separated list of setup sections still needed', 'Billing Information, Color & Product Selections'),
      v('setup.reminder_number', 'Reminder Number', 'Which reminder this is (1, 2, 3…)', '2'),
    ],
  },
  order_status_change: {
    key: 'order_status_change', emCode: 'EM-04', label: 'Order Status Change',
    description: 'Sent when staff changes an order\'s status in the admin portal. Does NOT fire on direct Monday edits — see OPEN-1 in Customer-Portal-Process-Flow.md.',
    category: 'ORDERS',
    variables: [
      ...CUSTOMER, ...ORDER,
      v('order.status', 'New Status', 'The status the order was just changed to', 'In Manufacturing'),
    ],
  },
  color_form_ready: {
    key: 'color_form_ready', emCode: 'EM-05', label: 'Color Selection Form Ready',
    description: 'Sent manually by staff from the Orders table ("Notify… → Color Form Ready"). Wired up 2026-08-13 — previously built but had no trigger at all.',
    category: 'ORDERS',
    variables: [...CUSTOMER, ...ORDER],
  },
  task_due: {
    key: 'task_due', emCode: 'EM-06', label: 'Action Required (Ad-hoc Task)',
    description: 'Sent manually by staff from the Orders table ("Notify… → Task Due…"), with a free-text task description staff supplies at send time.',
    category: 'ORDERS',
    variables: [
      ...CUSTOMER, ...ORDER,
      v('task.name', 'Task Description', 'What the customer needs to do, typed by staff at send time', 'Sign the updated freight quote'),
    ],
  },
  installation_ready: {
    key: 'installation_ready', emCode: 'EM-07', label: 'Installation Materials Ready',
    description: 'Sent manually by staff from the Orders table ("Notify… → Installation Ready").',
    category: 'INSTALLATION',
    variables: [...CUSTOMER, ...ORDER],
  },
  new_file_shared: {
    key: 'new_file_shared', emCode: 'EM-08', label: 'New File Shared',
    description: 'Sent automatically when staff attaches a file to an order in the File Manager.',
    category: 'CUSTOMER_PORTAL',
    variables: [
      ...CUSTOMER, ...ORDER,
      v('file.name', 'File Name', 'The name of the file that was shared', 'Installation-Guide.pdf'),
    ],
  },
  balance_change: {
    key: 'balance_change', emCode: 'EM-09', label: 'Balance / Payment Update',
    description: 'Sent when staff updates an order\'s balance in the admin portal. Does NOT fire on direct Monday edits — see OPEN-1.',
    category: 'PAYMENTS',
    variables: [
      ...CUSTOMER, ...ORDER,
      v('order.balance', 'Balance Due', 'The new balance amount (0 = paid in full)', '1250.00'),
    ],
  },
  form_completed_jotform: {
    key: 'form_completed_jotform', emCode: 'EM-10', label: 'Form Completed (Team Notice)',
    description: 'Sent to the team when a customer submits a Jotform (color selection or required documents).',
    category: 'INTERNAL_NOTIFICATIONS',
    variables: [
      v('customer.email', 'Customer Email', "The customer's email address", 'sarah@example.com'),
      ...ORDER,
      v('form.name', 'Form Name', 'Which form was completed', 'Color Selection'),
    ],
  },
  team_reply_notification: {
    key: 'team_reply_notification', emCode: 'EM-11', label: 'Team Replied to Message',
    description: 'Sent automatically to the customer when a staff member replies to their message in Monday.',
    category: 'SUPPORT',
    variables: [
      ...CUSTOMER, ...ORDER,
      v('message.preview', 'Message Preview', "A short excerpt of the staff member's reply", "Thanks for confirming — we'll have this shipped by Friday."),
    ],
  },
  team_new_message: {
    key: 'team_new_message', emCode: 'EM-12', label: 'Incoming Customer Message (Team Notice)',
    description: 'Sent to the team automatically when a customer sends a message through the portal.',
    category: 'INTERNAL_NOTIFICATIONS',
    variables: [
      v('customer.email', 'Customer Email', "The customer's email address", 'sarah@example.com'),
      ...ORDER,
      v('message.preview', 'Message Preview', "A short excerpt of the customer's message", 'Question about our delivery date...'),
    ],
  },
  team_contact_changed: {
    key: 'team_contact_changed', emCode: 'EM-13', label: 'Contact Info Changed (Team Notice)',
    description: 'Sent to the team automatically whenever a customer edits contact, billing, or delivery info — flagged for verification before shipment.',
    category: 'INTERNAL_NOTIFICATIONS',
    variables: [
      v('customer.email', 'Customer Email', "The customer's email address", 'sarah@example.com'),
      ...ORDER,
      v('change.fields', 'Changed Fields', 'Comma-separated list of what changed', 'Ship-to address, Phone'),
    ],
  },
  form_completed_tax_exemption: {
    key: 'form_completed_tax_exemption', emCode: 'EM-14', label: 'Tax Exemption Certificate Submitted (Team Notice)',
    description: 'Sent to the team automatically when a customer uploads a tax exemption certificate. Split out from EM-10 during the email template migration so each can have independent copy — today both share one hardcoded function.',
    category: 'INTERNAL_NOTIFICATIONS',
    variables: [
      v('customer.email', 'Customer Email', "The customer's email address", 'sarah@example.com'),
      ...ORDER,
    ],
  },
  team_new_referral: {
    key: 'team_new_referral', emCode: 'EM-15', label: 'New Referral Submitted (Team Notice)',
    description: 'Sent to the team automatically when a customer submits the Refer a Friend form.',
    category: 'INTERNAL_NOTIFICATIONS',
    variables: [
      v('customer.email', 'Referrer Email', "The referring customer's email address", 'sarah@example.com'),
      ...ORDER,
      v('referral.friend_name', "Friend's Name", 'Name of the person referred', 'Alex Rivera'),
      v('referral.friend_email', "Friend's Email", 'Email of the person referred', 'alex@example.com'),
    ],
  },
  team_ugc_threshold: {
    key: 'team_ugc_threshold', emCode: 'EM-16', label: 'Photo/Video Reward Tier Reached (Team Notice)',
    description: "Sent to the team automatically when a customer's photo/video submissions cross a new $25 reward tier.",
    category: 'INTERNAL_NOTIFICATIONS',
    variables: [
      v('customer.email', 'Customer Email', "The customer's email address", 'sarah@example.com'),
      ...ORDER,
      v('ugc.photo_count', 'Photo Count', 'Number of photos submitted', '4'),
      v('ugc.video_count', 'Video Count', 'Number of videos submitted', '1'),
      v('ugc.credits', 'Total Credits', 'Total reward credits earned so far', '6'),
    ],
  },
  upload_link_email: {
    key: 'upload_link_email', emCode: 'EM-17', label: 'Photo/Video Upload Link',
    description: 'Sent automatically when a customer clicks "Email Me This Link" on the Showcase tab, for easy mobile upload.',
    category: 'MARKETING_EDUCATION',
    variables: [
      ...CUSTOMER,
      v('upload.url', 'Upload Link', 'Direct link to the Jotform upload form', 'https://form.jotform.com/1234567890'),
    ],
  },
};

export function getTrigger(key) {
  return TRIGGERS[key] || null;
}

export function listTriggers() {
  return Object.values(TRIGGERS);
}
