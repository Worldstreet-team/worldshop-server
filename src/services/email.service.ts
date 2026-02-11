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
        <td style="padding:12px 8px;border-bottom:1px solid #eee;">
          ${item.productImage
          ? `<img src="${item.productImage}" alt="${item.productName}" width="50" height="50" style="border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:8px;" />`
          : ''
        }
          <span style="vertical-align:middle;">
            ${item.productName}${item.variantName ? ` <span style="color:#666;font-size:12px;">(${item.variantName})</span>` : ''}
          </span>
        </td>
        <td style="padding:12px 8px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #eee;text-align:right;">${formatNGN(item.unitPrice)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${formatNGN(item.totalPrice)}</td>
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
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg, #c8a951 0%, #e8d48b 50%, #c8a951 100%);padding:24px 32px;text-align:center;">
      <div style="margin-bottom:6px;"><span style="font-size:28px;">🏆</span></div>
      <h1 style="margin:0;color:#1a1a1a;font-size:22px;font-weight:700;letter-spacing:0.5px;">WorldStreet Gold</h1>
    </td>
  </tr>

  <!-- Thank You -->
  <tr>
    <td style="padding:32px 32px 16px;">
      <h2 style="margin:0 0 8px;color:#111;font-size:20px;">Thank you for your order, ${data.customerName}!</h2>
      <p style="margin:0;color:#555;font-size:14px;line-height:1.5;">
        Your payment has been confirmed and your order is now being processed.
      </p>
    </td>
  </tr>

  <!-- Order Meta -->
  <tr>
    <td style="padding:0 32px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:6px;padding:16px;">
        <tr>
          <td style="padding:8px 12px;">
            <span style="color:#666;font-size:12px;text-transform:uppercase;">Order Number</span><br/>
            <strong style="color:#111;font-size:15px;">${data.orderNumber}</strong>
          </td>
          <td style="padding:8px 12px;">
            <span style="color:#666;font-size:12px;text-transform:uppercase;">Date</span><br/>
            <strong style="color:#111;font-size:15px;">${paidDate}</strong>
          </td>
          <td style="padding:8px 12px;">
            <span style="color:#666;font-size:12px;text-transform:uppercase;">Payment</span><br/>
            <strong style="color:#111;font-size:15px;text-transform:capitalize;">${data.paymentChannel}</strong>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Items Table -->
  <tr>
    <td style="padding:0 32px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th style="padding:10px 8px;text-align:left;font-size:12px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">Item</th>
            <th style="padding:10px 8px;text-align:center;font-size:12px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">Qty</th>
            <th style="padding:10px 8px;text-align:right;font-size:12px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">Price</th>
            <th style="padding:10px 8px;text-align:right;font-size:12px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">Total</th>
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
    <td style="padding:16px 32px 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:6px 0;color:#555;font-size:14px;">Subtotal</td>
          <td style="padding:6px 0;text-align:right;color:#555;font-size:14px;">${formatNGN(data.subtotal)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#555;font-size:14px;">Shipping</td>
          <td style="padding:6px 0;text-align:right;color:#555;font-size:14px;">${data.shipping === 0 ? '<span style="color:#16a34a;">Free</span>' : formatNGN(data.shipping)}</td>
        </tr>
        ${data.discount > 0 ? `
        <tr>
          <td style="padding:6px 0;color:#16a34a;font-size:14px;">Discount</td>
          <td style="padding:6px 0;text-align:right;color:#16a34a;font-size:14px;">-${formatNGN(data.discount)}</td>
        </tr>` : ''}
        <tr>
          <td colspan="2" style="border-top:2px solid #111;padding-top:12px;"></td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:18px;font-weight:700;color:#111;">Total Paid</td>
          <td style="padding:4px 0;text-align:right;font-size:18px;font-weight:700;color:#111;">${formatNGN(data.total)}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Shipping Address -->
  <tr>
    <td style="padding:24px 32px 0;">
      <h3 style="margin:0 0 8px;font-size:14px;color:#666;text-transform:uppercase;">Shipping Address</h3>
      <p style="margin:0;color:#333;font-size:14px;line-height:1.6;">${addressBlock}</p>
    </td>
  </tr>

  ${buildDigitalDownloadsSection(data.digitalDownloads)}

  <!-- CTA -->
  <tr>
    <td style="padding:32px;text-align:center;">
      <a href="${ordersUrl}" style="display:inline-block;background:linear-gradient(135deg, #c8a951, #e8d48b);color:#1a1a1a;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(200,169,81,0.3);">
        View My Orders
      </a>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:24px 32px;border-top:1px solid #eee;text-align:center;">
      <p style="margin:0;color:#999;font-size:12px;line-height:1.5;">
        This is an automated receipt from WorldStreet Shop.<br/>
        If you have questions about your order, please contact
        <a href="mailto:support@worldstreetgold.com" style="color:#c8a951;">support@worldstreetgold.com</a>
      </p>
      <p style="margin:8px 0 0;color:#bbb;font-size:11px;">
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
        <td style="padding:12px 16px;border-bottom:1px solid #eee;">
          <div>
            <span style="font-size:16px;margin-right:6px;">📄</span>
            <strong style="color:#111;font-size:13px;">${dl.fileName}</strong>
            <span style="color:#888;font-size:11px;margin-left:4px;">(${formatFileSize(dl.fileSize)})</span>
          </div>
        </td>
        <td style="padding:12px 8px;border-bottom:1px solid #eee;text-align:center;">
          <span style="color:#666;font-size:11px;">${dl.maxDownloads} downloads<br/>Exp: ${expiry}</span>
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #eee;text-align:center;">
          <a href="${dl.downloadUrl}" style="display:inline-block;background:linear-gradient(135deg,#c8a951,#e8d48b);color:#1a1a1a;padding:6px 14px;border-radius:4px;text-decoration:none;font-size:12px;font-weight:600;">Download</a>
        </td>
      </tr>`;
    })
    .join('');

  return `
  <!-- Digital Downloads -->
  <tr>
    <td style="padding:24px 32px 0;">
      <h3 style="margin:0 0 8px;font-size:14px;color:#666;text-transform:uppercase;">🎁 Your Digital Products</h3>
      <div style="background:#fff8e1;border-left:4px solid #c8a951;border-radius:0 6px 6px 0;padding:10px 14px;margin-bottom:16px;">
        <p style="margin:0;color:#666;font-size:12px;line-height:1.4;">
          <strong style="color:#333;">⚠️ Important:</strong> Each file can be downloaded up to <strong>${downloads[0]?.maxDownloads || 2} times</strong>.
          Links expire on <strong>${firstExpiry}</strong>. Please save your files after downloading.
        </p>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">File</th>
            <th style="padding:10px 8px;text-align:center;font-size:11px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">Limit</th>
            <th style="padding:10px 16px;text-align:center;font-size:11px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${fileRows}
        </tbody>
      </table>
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
          <td style="padding:16px;border-bottom:1px solid #eee;">
            <div style="display:flex;align-items:center;">
              <div style="background:#fff3e0;border-radius:8px;padding:10px;margin-right:12px;display:inline-block;">
                <span style="font-size:20px;">📄</span>
              </div>
              <div>
                <strong style="color:#111;font-size:14px;display:block;">${dl.fileName}</strong>
                <span style="color:#888;font-size:12px;">${formatFileSize(dl.fileSize)}</span>
              </div>
            </div>
          </td>
          <td style="padding:16px;border-bottom:1px solid #eee;text-align:center;">
            <span style="color:#666;font-size:12px;">${dl.maxDownloads} downloads</span>
          </td>
          <td style="padding:16px;border-bottom:1px solid #eee;text-align:center;">
            <span style="color:#666;font-size:12px;">Expires: ${expiry}</span>
          </td>
          <td style="padding:16px;border-bottom:1px solid #eee;text-align:center;">
            <a href="${dl.downloadUrl}" style="display:inline-block;background:linear-gradient(135deg,#c8a951,#e8d48b);color:#1a1a1a;padding:8px 16px;border-radius:4px;text-decoration:none;font-size:12px;font-weight:600;">Download</a>
          </td>
        </tr>`;
      }
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

  <!-- Header with brand color and icon -->
  <tr>
    <td style="background:linear-gradient(135deg, #c8a951 0%, #e8d48b 50%, #c8a951 100%);padding:28px 32px;text-align:center;">
      <div style="margin-bottom:8px;">
        <span style="font-size:32px;">🏆</span>
      </div>
      <h1 style="margin:0;color:#1a1a1a;font-size:22px;font-weight:700;letter-spacing:0.5px;">WorldStreet Gold</h1>
      <p style="margin:4px 0 0;color:#333;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Digital Products</p>
    </td>
  </tr>

  <!-- Greeting -->
  <tr>
    <td style="padding:32px 32px 16px;">
      <h2 style="margin:0 0 8px;color:#111;font-size:20px;">Your files are ready, ${data.customerName}! 🎉</h2>
      <p style="margin:0;color:#555;font-size:14px;line-height:1.6;">
        Your payment for order <strong>${data.orderNumber}</strong> has been confirmed.
        Your digital products are ready to download.
      </p>
    </td>
  </tr>

  <!-- Important notice -->
  <tr>
    <td style="padding:0 32px 24px;">
      <div style="background:#fff8e1;border-left:4px solid #c8a951;border-radius:0 6px 6px 0;padding:14px 16px;">
        <p style="margin:0;color:#666;font-size:13px;line-height:1.5;">
          <strong style="color:#333;">⚠️ Important:</strong> Each file can be downloaded a maximum of <strong>${data.downloads[0]?.maxDownloads || 2} times</strong>.
          Download links expire on <strong>${new Date(data.downloads[0]?.expiresAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>.
          Please save your files after downloading.
        </p>
      </div>
    </td>
  </tr>

  <!-- Files Table -->
  <tr>
    <td style="padding:0 32px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th style="padding:12px 16px;text-align:left;font-size:12px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">File</th>
            <th style="padding:12px 16px;text-align:center;font-size:12px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">Limit</th>
            <th style="padding:12px 16px;text-align:center;font-size:12px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">Expiry</th>
            <th style="padding:12px 16px;text-align:center;font-size:12px;color:#666;text-transform:uppercase;border-bottom:2px solid #eee;">Action</th>
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
    <td style="padding:32px;text-align:center;">
      <a href="${downloadsUrl}" style="display:inline-block;background:linear-gradient(135deg, #c8a951, #e8d48b);color:#1a1a1a;padding:14px 36px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.3px;box-shadow:0 2px 8px rgba(200,169,81,0.3);">
        Access My Downloads
      </a>
      <p style="margin:12px 0 0;color:#999;font-size:12px;">
        Log in to your account to download your files
      </p>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:24px 32px;border-top:1px solid #eee;text-align:center;">
      <p style="margin:0;color:#999;font-size:12px;line-height:1.5;">
        This is an automated email from WorldStreet Gold.<br/>
        If you have questions about your purchase, please contact
        <a href="mailto:support@worldstreetgold.com" style="color:#c8a951;">support@worldstreetgold.com</a>
      </p>
      <p style="margin:8px 0 0;color:#bbb;font-size:11px;">
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
