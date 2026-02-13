/**
 * Email service — transactional receipt emails via Resend.
 *
 * - Fires ONLY after confirmed payment.
 * - Failures are logged, never thrown — checkout must never break.
 * - Callers should trigger it asynchronously (non-blocking).
 */
import resend from '../configs/resendConfig';
import { RESEND_FROM_EMAIL, CLIENT_URL } from '../configs/envConfig';
import { globalLog as logger } from '../configs/loggerConfig';

// ─── Types ──────────────────────────────────────────────────────
interface OrderReceiptData {
  customerEmail: string;
  customerName: string;
  orderNumber: string;
  orderId: string;
  items: {
    productName: string;
    variantName?: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    productImage?: string | null;
  }[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  paymentChannel: string;
  paidAt: string;
  shippingAddress: {
    firstName: string;
    lastName: string;
    street: string;
    apartment?: string;
    city: string;
    state: string;
    country: string;
    phone: string;
  };
  digitalDownloads?: {
    fileName: string;
    fileSize: number;
    downloadUrl: string;
    maxDownloads: number;
    expiresAt: Date;
  }[];
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Send order receipt email.
 * Returns true if send succeeded, false if it failed.
 */
export async function sendOrderReceipt(
  data: OrderReceiptData
): Promise<boolean> {
  try {
    await _sendReceipt(data);
    return true;
  } catch (err) {
    logger.error('[Email] Failed to send order receipt', {
      orderNumber: data.orderNumber,
      email: data.customerEmail,
      error: (err as Error).message,
    });
    return false;
  }
}

// ─── Internal ───────────────────────────────────────────────────

async function _sendReceipt(data: OrderReceiptData): Promise<void> {
  const fromAddress = RESEND_FROM_EMAIL || 'orders@worldstreetgold.com';

  const { data: resData, error } = await resend.emails.send({
    from: `WorldStreet Shop <${fromAddress}>`,
    to: [data.customerEmail],
    subject: `Order Confirmed — ${data.orderNumber}`,
    html: buildReceiptHTML(data),
  });

  if (error) {
    throw new Error(error.message);
  }

  logger.info('[Email] Order receipt sent', {
    orderNumber: data.orderNumber,
    to: data.customerEmail,
    emailId: resData?.id,
  });
}

// ─── HTML Template ──────────────────────────────────────────────

// Brand Colors (from client SCSS)
const COLORS = {
  primary: '#fed700',      // Yellow
  primaryDark: '#e6c200',
  secondary: '#333e48',    // Dark slate
  secondaryDark: '#232a30',
  success: '#28a745',
  warning: '#ffc107',
  danger: '#dc3545',
  info: '#17a2b8',
  white: '#ffffff',
  gray50: '#fafafa',
  gray100: '#f8f9fa',
  gray200: '#e9ecef',
  gray300: '#dee2e6',
  gray600: '#6c757d',
  gray900: '#212529',
};

function formatNGN(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildReceiptHTML(data: OrderReceiptData): string {
  const shopUrl = CLIENT_URL || 'https://shop.worldstreetgold.com';
  const ordersUrl = `${shopUrl}/account/orders`;

  const itemRows = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding:14px 12px;border-bottom:1px solid ${COLORS.gray200};">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              ${item.productImage
          ? `<td style="vertical-align:middle;padding-right:12px;">
                    <img src="${item.productImage}" alt="${item.productName}" width="56" height="56" style="border-radius:8px;object-fit:cover;border:1px solid ${COLORS.gray200};" />
                  </td>`
          : ''
        }
              <td style="vertical-align:middle;">
                <span style="color:${COLORS.gray900};font-size:14px;font-weight:600;">${item.productName}</span>
                ${item.variantName ? `<br/><span style="color:${COLORS.gray600};font-size:12px;">${item.variantName}</span>` : ''}
              </td>
            </tr>
          </table>
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid ${COLORS.gray200};text-align:center;color:${COLORS.gray600};font-size:14px;">${item.quantity}</td>
        <td style="padding:14px 12px;border-bottom:1px solid ${COLORS.gray200};text-align:right;color:${COLORS.gray600};font-size:14px;">${formatNGN(item.unitPrice)}</td>
        <td style="padding:14px 12px;border-bottom:1px solid ${COLORS.gray200};text-align:right;font-weight:600;color:${COLORS.gray900};font-size:14px;">${formatNGN(item.totalPrice)}</td>
      </tr>`
    )
    .join('');

  const addr = data.shippingAddress;
  const addressBlock = `${addr.firstName} ${addr.lastName}<br/>
    ${addr.street}${addr.apartment ? `, ${addr.apartment}` : ''}<br/>
    ${addr.city}, ${addr.state}<br/>
    ${addr.country}<br/>
    ${addr.phone}`;

  const paidDate = new Date(data.paidAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:${COLORS.gray100};font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.gray100};padding:40px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:${COLORS.white};border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr>
    <td style="background:${COLORS.secondary};padding:32px 40px;text-align:center;">
      <table cellpadding="0" cellspacing="0" border="0" align="center">
        <tr>
          <td style="background:${COLORS.primary};width:48px;height:48px;border-radius:10px;text-align:center;vertical-align:middle;">
            <span style="font-size:24px;line-height:48px;">✦</span>
          </td>
          <td style="padding-left:14px;">
            <h1 style="margin:0;color:${COLORS.white};font-size:24px;font-weight:700;letter-spacing:0.5px;">WorldStreet</h1>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Success Banner -->
  <tr>
    <td style="background:${COLORS.primary};padding:20px 40px;text-align:center;">
      <table cellpadding="0" cellspacing="0" border="0" align="center">
        <tr>
          <td style="padding-right:10px;vertical-align:middle;">
            <div style="background:${COLORS.secondary};width:32px;height:32px;border-radius:50%;text-align:center;line-height:32px;">
              <span style="color:${COLORS.primary};font-size:18px;">✓</span>
            </div>
          </td>
          <td style="vertical-align:middle;">
            <span style="color:${COLORS.secondary};font-size:16px;font-weight:700;">Order Confirmed</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Thank You Message -->
  <tr>
    <td style="padding:40px 40px 24px;">
      <h2 style="margin:0 0 12px;color:${COLORS.gray900};font-size:22px;font-weight:700;">Thank you, ${data.customerName}!</h2>
      <p style="margin:0;color:${COLORS.gray600};font-size:15px;line-height:1.6;">
        Your payment has been confirmed and your order is now being processed. We'll notify you when it ships.
      </p>
    </td>
  </tr>

  <!-- Order Info Cards -->
  <tr>
    <td style="padding:0 40px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.gray50};border-radius:10px;border:1px solid ${COLORS.gray200};">
        <tr>
          <td style="padding:18px 20px;border-right:1px solid ${COLORS.gray200};">
            <span style="color:${COLORS.gray600};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">Order Number</span>
            <strong style="color:${COLORS.gray900};font-size:15px;">${data.orderNumber}</strong>
          </td>
          <td style="padding:18px 20px;border-right:1px solid ${COLORS.gray200};">
            <span style="color:${COLORS.gray600};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">Date</span>
            <strong style="color:${COLORS.gray900};font-size:15px;">${paidDate}</strong>
          </td>
          <td style="padding:18px 20px;">
            <span style="color:${COLORS.gray600};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">Payment</span>
            <strong style="color:${COLORS.gray900};font-size:15px;text-transform:capitalize;">${data.paymentChannel}</strong>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Items Table -->
  <tr>
    <td style="padding:0 40px;">
      <h3 style="margin:0 0 16px;color:${COLORS.gray900};font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Order Items</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr style="background:${COLORS.secondary};">
            <th style="padding:12px;text-align:left;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;border-radius:8px 0 0 0;">Item</th>
            <th style="padding:12px;text-align:center;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
            <th style="padding:12px;text-align:right;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;">Price</th>
            <th style="padding:12px;text-align:right;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;border-radius:0 8px 0 0;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>
    </td>
  </tr>

  <!-- Totals -->
  <tr>
    <td style="padding:24px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:8px 0;color:${COLORS.gray600};font-size:14px;">Subtotal</td>
          <td style="padding:8px 0;text-align:right;color:${COLORS.gray600};font-size:14px;">${formatNGN(data.subtotal)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:${COLORS.gray600};font-size:14px;">Shipping</td>
          <td style="padding:8px 0;text-align:right;color:${COLORS.gray600};font-size:14px;">${data.shipping === 0 ? `<span style="color:${COLORS.success};font-weight:600;">Free</span>` : formatNGN(data.shipping)}</td>
        </tr>
        ${data.discount > 0 ? `
        <tr>
          <td style="padding:8px 0;color:${COLORS.success};font-size:14px;">Discount</td>
          <td style="padding:8px 0;text-align:right;color:${COLORS.success};font-size:14px;">-${formatNGN(data.discount)}</td>
        </tr>` : ''}
        <tr>
          <td colspan="2" style="padding-top:12px;"><div style="height:2px;background:${COLORS.gray200};"></div></td>
        </tr>
        <tr>
          <td style="padding:16px 0 8px;font-size:18px;font-weight:700;color:${COLORS.gray900};">Total Paid</td>
          <td style="padding:16px 0 8px;text-align:right;font-size:20px;font-weight:700;color:${COLORS.secondary};">${formatNGN(data.total)}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Shipping Address -->
  <tr>
    <td style="padding:32px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.gray50};border-radius:10px;border:1px solid ${COLORS.gray200};padding:20px;">
        <tr>
          <td>
            <h3 style="margin:0 0 12px;font-size:12px;color:${COLORS.gray600};text-transform:uppercase;letter-spacing:0.5px;">📍 Shipping Address</h3>
            <p style="margin:0;color:${COLORS.gray900};font-size:14px;line-height:1.7;">${addressBlock}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  ${buildDigitalDownloadsSection(data.digitalDownloads)}

  <!-- CTA Button -->
  <tr>
    <td style="padding:40px;text-align:center;">
      <a href="${ordersUrl}" style="display:inline-block;background:${COLORS.primary};color:${COLORS.secondary};padding:16px 40px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(254,215,0,0.35);">
        View My Orders
      </a>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:32px 40px;background:${COLORS.gray50};border-top:1px solid ${COLORS.gray200};text-align:center;">
      <p style="margin:0 0 8px;color:${COLORS.gray600};font-size:13px;">
        Questions about your order? Contact us at
        <a href="mailto:support@worldstreetgold.com" style="color:${COLORS.secondary};font-weight:600;">support@worldstreetgold.com</a>
      </p>
      <p style="margin:0;color:${COLORS.gray600};font-size:12px;">
        © ${new Date().getFullYear()} WorldStreet Gold. All rights reserved.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}

// ─── Digital Downloads Section (for mixed-order receipts) ──────

function buildDigitalDownloadsSection(
  downloads?: OrderReceiptData['digitalDownloads']
): string {
  if (!downloads || downloads.length === 0) return '';

  const firstExpiry = new Date(downloads[0].expiresAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const fileRows = downloads
    .map((dl) => {
      const expiry = new Date(dl.expiresAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      return `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid ${COLORS.gray200};">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background:${COLORS.primary};width:40px;height:40px;border-radius:8px;text-align:center;vertical-align:middle;">
                <span style="font-size:18px;line-height:40px;">📄</span>
              </td>
              <td style="padding-left:12px;vertical-align:middle;">
                <strong style="color:${COLORS.gray900};font-size:14px;">${dl.fileName}</strong><br/>
                <span style="color:${COLORS.gray600};font-size:12px;">${formatFileSize(dl.fileSize)}</span>
              </td>
            </tr>
          </table>
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid ${COLORS.gray200};text-align:center;">
          <span style="color:${COLORS.gray600};font-size:12px;">${dl.maxDownloads} downloads</span><br/>
          <span style="color:${COLORS.gray600};font-size:11px;">Exp: ${expiry}</span>
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid ${COLORS.gray200};text-align:center;">
          <span style="background:${COLORS.gray100};color:${COLORS.gray600};padding:6px 12px;border-radius:6px;font-size:11px;">Download from account</span>
        </td>
      </tr>`;
    })
    .join('');

  return `
  <!-- Digital Downloads -->
  <tr>
    <td style="padding:32px 40px 0;">
      <div style="background:linear-gradient(135deg,${COLORS.primary}15,${COLORS.primary}08);border-radius:12px;padding:24px;border:1px solid ${COLORS.primary}40;">
        <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
          <tr>
            <td style="background:${COLORS.primary};width:36px;height:36px;border-radius:8px;text-align:center;vertical-align:middle;">
              <span style="font-size:18px;line-height:36px;">🎁</span>
            </td>
            <td style="padding-left:12px;vertical-align:middle;">
              <h3 style="margin:0;font-size:16px;color:${COLORS.gray900};font-weight:700;">Your Digital Products</h3>
            </td>
          </tr>
        </table>
        
        <div style="background:${COLORS.white};border-radius:8px;padding:14px 16px;margin-bottom:20px;border-left:4px solid ${COLORS.warning};">
          <p style="margin:0;color:${COLORS.gray600};font-size:13px;line-height:1.5;">
            <strong style="color:${COLORS.gray900};">⚠️ Important:</strong> Each file can be downloaded up to <strong>${downloads[0]?.maxDownloads || 2} times</strong>.
            Links expire on <strong>${firstExpiry}</strong>. Please save your files after downloading.
          </p>
        </div>
        
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${COLORS.white};border-radius:8px;overflow:hidden;border:1px solid ${COLORS.gray200};">
          <thead>
            <tr style="background:${COLORS.secondary};">
              <th style="padding:12px 16px;text-align:left;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;">File</th>
              <th style="padding:12px 12px;text-align:center;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;">Limit</th>
              <th style="padding:12px 16px;text-align:center;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${fileRows}
          </tbody>
        </table>
      </div>
    </td>
  </tr>`;
}

// ─── Digital Product Delivery ───────────────────────────────────

interface DigitalDeliveryData {
  customerEmail: string;
  customerName: string;
  orderNumber: string;
  downloads: {
    fileName: string;
    fileSize: number;
    downloadId: string;
    downloadUrl: string;
    maxDownloads: number;
    expiresAt: Date;
  }[];
}

/**
 * Send digital product delivery email with download links.
 * Returns true if send succeeded, false if it failed.
 */
export async function sendDigitalProductDelivery(
  data: DigitalDeliveryData
): Promise<boolean> {
  try {
    await _sendDigitalDelivery(data);
    return true;
  } catch (err) {
    logger.error('[Email] Failed to send digital delivery email', {
      orderNumber: data.orderNumber,
      email: data.customerEmail,
      error: (err as Error).message,
    });
    return false;
  }
}

async function _sendDigitalDelivery(data: DigitalDeliveryData): Promise<void> {
  const fromAddress = RESEND_FROM_EMAIL || 'orders@worldstreetgold.com';

  const { data: resData, error } = await resend.emails.send({
    from: `WorldStreet Shop <${fromAddress}>`,
    to: [data.customerEmail],
    subject: `Your Digital Products — ${data.orderNumber}`,
    html: buildDigitalDeliveryHTML(data),
  });

  if (error) {
    throw new Error(error.message);
  }

  logger.info('[Email] Digital delivery email sent', {
    orderNumber: data.orderNumber,
    to: data.customerEmail,
    emailId: resData?.id,
    fileCount: data.downloads.length,
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildDigitalDeliveryHTML(data: DigitalDeliveryData): string {
  const shopUrl = CLIENT_URL || 'https://shop.worldstreetgold.com';
  const downloadsUrl = `${shopUrl}/account/downloads`;

  const fileRows = data.downloads
    .map(
      (dl) => {
        const expiry = new Date(dl.expiresAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        return `
        <tr>
          <td style="padding:16px;border-bottom:1px solid ${COLORS.gray200};">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:${COLORS.primary};width:44px;height:44px;border-radius:10px;text-align:center;vertical-align:middle;">
                  <span style="font-size:20px;line-height:44px;">📄</span>
                </td>
                <td style="padding-left:14px;vertical-align:middle;">
                  <strong style="color:${COLORS.gray900};font-size:15px;display:block;margin-bottom:4px;">${dl.fileName}</strong>
                  <span style="color:${COLORS.gray600};font-size:13px;">${formatFileSize(dl.fileSize)}</span>
                </td>
              </tr>
            </table>
          </td>
          <td style="padding:16px;border-bottom:1px solid ${COLORS.gray200};text-align:center;">
            <div style="background:${COLORS.gray100};padding:8px 12px;border-radius:6px;display:inline-block;">
              <span style="color:${COLORS.gray900};font-size:14px;font-weight:600;">${dl.maxDownloads}</span>
              <span style="color:${COLORS.gray600};font-size:11px;display:block;">downloads</span>
            </div>
          </td>
          <td style="padding:16px;border-bottom:1px solid ${COLORS.gray200};text-align:center;">
            <span style="color:${COLORS.gray600};font-size:13px;">Expires:</span><br/>
            <span style="color:${COLORS.gray900};font-size:13px;font-weight:500;">${expiry}</span>
          </td>
        </tr>`;
      }
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:${COLORS.gray100};font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.gray100};padding:40px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:${COLORS.white};border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr>
    <td style="background:${COLORS.secondary};padding:32px 40px;text-align:center;">
      <table cellpadding="0" cellspacing="0" border="0" align="center">
        <tr>
          <td style="background:${COLORS.primary};width:48px;height:48px;border-radius:10px;text-align:center;vertical-align:middle;">
            <span style="font-size:24px;line-height:48px;">✦</span>
          </td>
          <td style="padding-left:14px;">
            <h1 style="margin:0;color:${COLORS.white};font-size:24px;font-weight:700;letter-spacing:0.5px;">WorldStreet</h1>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Digital Products Banner -->
  <tr>
    <td style="background:linear-gradient(135deg,${COLORS.primary},${COLORS.primaryDark});padding:24px 40px;text-align:center;">
      <table cellpadding="0" cellspacing="0" border="0" align="center">
        <tr>
          <td style="padding-right:12px;vertical-align:middle;">
            <span style="font-size:32px;">🎁</span>
          </td>
          <td style="vertical-align:middle;text-align:left;">
            <span style="color:${COLORS.secondary};font-size:18px;font-weight:700;display:block;">Your Digital Products</span>
            <span style="color:${COLORS.secondaryDark};font-size:13px;opacity:0.8;">Ready for download</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Greeting -->
  <tr>
    <td style="padding:40px 40px 24px;">
      <h2 style="margin:0 0 12px;color:${COLORS.gray900};font-size:22px;font-weight:700;">Hey ${data.customerName}! 🎉</h2>
      <p style="margin:0;color:${COLORS.gray600};font-size:15px;line-height:1.7;">
        Great news! Your payment for order <strong style="color:${COLORS.gray900};">${data.orderNumber}</strong> has been confirmed.
        Your digital products are ready and waiting for you.
      </p>
    </td>
  </tr>

  <!-- Important Notice -->
  <tr>
    <td style="padding:0 40px 32px;">
      <div style="background:linear-gradient(135deg,${COLORS.warning}15,${COLORS.warning}08);border-radius:12px;padding:20px;border:1px solid ${COLORS.warning}40;">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-right:14px;vertical-align:top;">
              <span style="font-size:24px;">⚠️</span>
            </td>
            <td>
              <strong style="color:${COLORS.gray900};font-size:14px;display:block;margin-bottom:6px;">Before you download</strong>
              <p style="margin:0;color:${COLORS.gray600};font-size:13px;line-height:1.6;">
                Each file can be downloaded maximum of <strong style="color:${COLORS.gray900};">${data.downloads[0]?.maxDownloads || 2} times</strong>.
                Links expire on <strong style="color:${COLORS.gray900};">${new Date(data.downloads[0]?.expiresAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>.
                Please save your files immediately after downloading.
              </p>
            </td>
          </tr>
        </table>
      </div>
    </td>
  </tr>

  <!-- Files Table -->
  <tr>
    <td style="padding:0 40px;">
      <h3 style="margin:0 0 16px;color:${COLORS.gray900};font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Your Files</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${COLORS.gray200};border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:${COLORS.secondary};">
            <th style="padding:14px 16px;text-align:left;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;">File</th>
            <th style="padding:14px 16px;text-align:center;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;">Limit</th>
            <th style="padding:14px 16px;text-align:center;font-size:11px;color:${COLORS.white};text-transform:uppercase;letter-spacing:0.5px;">Expiry</th>
          </tr>
        </thead>
        <tbody>
          ${fileRows}
        </tbody>
      </table>
    </td>
  </tr>

  <!-- CTA Button -->
  <tr>
    <td style="padding:40px;text-align:center;">
      <a href="${downloadsUrl}" style="display:inline-block;background:${COLORS.primary};color:${COLORS.secondary};padding:18px 48px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:700;letter-spacing:0.3px;box-shadow:0 4px 16px rgba(254,215,0,0.4);">
        Download My Files
      </a>
      <p style="margin:16px 0 0;color:${COLORS.gray600};font-size:13px;line-height:1.5;">
        Click the button above to access your downloads from your account dashboard.
      </p>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:32px 40px;background:${COLORS.gray50};border-top:1px solid ${COLORS.gray200};text-align:center;">
      <p style="margin:0 0 8px;color:${COLORS.gray600};font-size:13px;">
        Need help? Contact us at
        <a href="mailto:support@worldstreetgold.com" style="color:${COLORS.secondary};font-weight:600;">support@worldstreetgold.com</a>
      </p>
      <p style="margin:0;color:${COLORS.gray600};font-size:12px;">
        © ${new Date().getFullYear()} WorldStreet Gold. All rights reserved.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}
