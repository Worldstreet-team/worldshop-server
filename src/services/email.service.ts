/**
 * Email service — transactional receipt emails via Resend.
 *
 * - Fires ONLY after confirmed payment.
 * - Failures are logged, never thrown — checkout must never break.
 * - Callers should trigger it asynchronously (non-blocking).
 */
import { resend } from '../configs/resendConfig';
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
          ${
            item.productImage
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
    <td style="background:#2874f0;padding:24px 32px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">WorldStreet Shop</h1>
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

  <!-- CTA -->
  <tr>
    <td style="padding:32px;text-align:center;">
      <a href="${ordersUrl}" style="display:inline-block;background:#2874f0;color:#ffffff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
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
        <a href="mailto:support@worldstreetgold.com" style="color:#2874f0;">support@worldstreetgold.com</a>
      </p>
      <p style="margin:8px 0 0;color:#bbb;font-size:11px;">
        © ${new Date().getFullYear()} WorldStreet Shop. All rights reserved.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}
