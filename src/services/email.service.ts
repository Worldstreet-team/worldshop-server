import resend from '../configs/resendConfig';
import { CLIENT_URL, RESEND_FROM_EMAIL } from '../configs/envConfig';
import { globalLog } from '../configs/loggerConfig';

/**
 * Transactional email.
 *
 * Table-based layout with inline styles only — every mail client strips
 * <style> blocks, and Outlook ignores anything but a table for structure.
 * There is no templating dependency: two messages share one shell, and the
 * shell is easier to read as a function than as a template file.
 *
 * These are security emails, not marketing, so there is deliberately no
 * unsubscribe link and no postal address: both are for bulk mail, and a
 * password link nobody can opt out of should not pretend otherwise.
 */

const FROM = RESEND_FROM_EMAIL
  ? `WorldStore <${RESEND_FROM_EMAIL}>`
  : 'WorldStore <noreply@worldstreetgold.com>';

// Platform theme, matching the app: page ground, gold brand, ink on white.
const GROUND = '#0B0B0F';
const GOLD = '#FFCC29';
const INK = '#0B0B0F';
const BODY_TEXT = '#52525B';
const MUTED = '#8E8E97';
const HAIRLINE = '#E4E4E7';

// Poppins and Public Sans are the app's faces; mail clients that lack them
// fall through to the system stack rather than to Times.
const FONT = `'Poppins','Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

function clientOrigin(): string {
  return (CLIENT_URL || 'https://shop.worldstreetgold.com').replace(/\/+$/, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface EmailContent {
  /** Small uppercase label above the headline. */
  eyebrow: string;
  heading: string;
  /** Sentences of body copy; each becomes its own paragraph. */
  paragraphs: string[];
  /** The italic line under the copy — how long the link lasts. */
  note: string;
  buttonLabel: string;
  link: string;
  /** Inbox preview line, shown next to the subject before the mail is opened. */
  preheader: string;
}

function render(content: EmailContent): string {
  const { eyebrow, heading, paragraphs, note, buttonLabel, link, preheader } = content;
  const mark = `${clientOrigin()}/brand/wsa-mark.png`;

  const body = paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BODY_TEXT};">${text}</p>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <!-- Tells Gmail and Apple Mail not to invert the palette in dark mode. -->
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${GROUND};-webkit-font-smoothing:antialiased;">
    <!-- Preview line: shown in the inbox list, hidden once the mail is open. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${GROUND};">
      <tr>
        <td align="center" style="padding:40px 16px;">

          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

            <!-- Brand lockup: the gold W mark beside the WorldStore wordmark.
                 The mark is 206x118, so the width and height below have to keep
                 that ratio or the W comes out squashed. It stays a PNG because
                 Gmail drops SVG, which rules out the logo-wordmark-*.svg assets. -->
            <tr>
              <td align="center" style="background:${GROUND};padding:8px 0 30px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right:11px;" valign="middle">
                      <img src="${mark}" width="44" height="25" alt="WorldStore" style="display:block;width:44px;height:25px;border:0;" />
                    </td>
                    <td valign="middle" style="font-family:${FONT};font-size:19px;font-weight:600;letter-spacing:.01em;color:#FAFAFA;line-height:1;">
                      World<span style="color:${GOLD};">Store</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background:#FFFFFF;border-radius:12px;padding:44px 40px 40px;">

                <p style="margin:0 0 12px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${MUTED};text-align:center;">${escapeHtml(eyebrow)}</p>

                <h1 style="margin:0 0 20px;font-family:${FONT};font-size:26px;line-height:1.3;font-weight:700;color:${INK};text-align:center;">${escapeHtml(heading)}</h1>

                <div style="text-align:center;">${body}</div>

                <p style="margin:24px 0 0;font-family:${FONT};font-size:14px;line-height:1.6;font-style:italic;color:${MUTED};text-align:center;">${escapeHtml(note)}</p>

                <!-- Button. A table cell carries the fill so Outlook, which drops
                     padding on inline-block anchors, still renders a real button. -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:32px auto 8px;">
                  <tr>
                    <td align="center" bgcolor="${GOLD}" style="border-radius:999px;">
                      <a href="${link}" style="display:inline-block;padding:15px 38px;font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${INK};text-decoration:none;border-radius:999px;">${escapeHtml(buttonLabel)}</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:28px 0 0;padding-top:24px;border-top:1px solid ${HAIRLINE};font-family:${FONT};font-size:12px;line-height:1.7;color:${MUTED};text-align:center;">
                  Button not working? Paste this into your browser:<br />
                  <span style="word-break:break-all;color:${BODY_TEXT};">${link}</span>
                </p>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding:28px 24px 8px;font-family:${FONT};font-size:12px;line-height:1.7;color:${MUTED};">
                You're getting this because your address has admin access on WorldStore.<br />
                It's a security email, so there's nothing here to unsubscribe from.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:4px 24px 0;font-family:${FONT};font-size:12px;color:${MUTED};">
                <a href="${clientOrigin()}" style="color:${MUTED};text-decoration:none;">worldstreetgold.com</a>
                &nbsp;·&nbsp;
                <a href="${clientOrigin()}/privacy" style="color:${MUTED};text-decoration:none;">Privacy</a>
                &nbsp;·&nbsp;
                <a href="${clientOrigin()}/terms" style="color:${MUTED};text-decoration:none;">Terms</a>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Plain-text alternative. Sending HTML alone is a spam signal. */
function renderText(content: EmailContent): string {
  return [
    `WORLDSTREET SHOP / ${content.eyebrow.toUpperCase()}`,
    '',
    content.heading,
    '',
    ...content.paragraphs.map((p) => p.replace(/<[^>]+>/g, '')),
    '',
    content.note,
    '',
    content.link,
    '',
    '---',
    "You're getting this because your address has admin access on WorldStore.",
  ].join('\n');
}

export async function sendAdminPasswordSetupEmail(params: {
  to: string;
  firstName: string;
  token: string;
}): Promise<void> {
  const link = `${clientOrigin()}/auth/setup-password?token=${encodeURIComponent(params.token)}`;
  const name = params.firstName ? escapeHtml(params.firstName) : 'there';

  const content: EmailContent = {
    eyebrow: 'Admin access',
    heading: 'Set up your admin password',
    paragraphs: [
      `Hi ${name}, you've been given access to the WorldStore admin console.`,
      "Pick a password to finish setting up. It's separate from the one you use to shop, and it's what you'll sign in with from now on.",
    ],
    note: 'The link works once, and only for the next 24 hours.',
    buttonLabel: 'Create password',
    link,
    preheader: 'Pick a password to finish setting up your admin account.',
  };

  const { error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: 'Set up your WorldStore admin password',
    html: render(content),
    text: renderText(content),
  });

  if (error) throw new Error(`Resend failed to send setup email: ${error.message}`);
}

export async function sendAdminPasswordResetEmail(params: {
  to: string;
  firstName: string;
  token: string;
}): Promise<void> {
  const link = `${clientOrigin()}/auth/reset-password?token=${encodeURIComponent(params.token)}`;
  const name = params.firstName ? escapeHtml(params.firstName) : 'there';

  const content: EmailContent = {
    eyebrow: 'Password reset',
    heading: 'Reset your admin password',
    paragraphs: [
      `Hi ${name}, someone asked to reset the password on your WorldStore admin account.`,
      "Pick a new one below. Anywhere you're currently signed in to the console will be signed out.",
    ],
    note: "The link works once, and only for the next hour. If this wasn't you, just ignore this email and nothing changes.",
    buttonLabel: 'Reset password',
    link,
    preheader: 'Pick a new password for your admin account.',
  };

  const { error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: 'Reset your WorldStore admin password',
    html: render(content),
    text: renderText(content),
  });

  if (error) throw new Error(`Resend failed to send reset email: ${error.message}`);
}

/** Fire-and-forget wrapper for paths where a mail failure must not break the request. */
export function sendQuietly(promise: Promise<void>, context: string): void {
  promise.catch((err: unknown) => {
    globalLog.error(`Email failed (${context})`, { message: (err as Error)?.message });
  });
}
