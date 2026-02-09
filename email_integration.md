SYSTEM INSTRUCTION FOR LLM — RESEND CHECKOUT RECEIPTS
Goal

Integrate Resend into an e-commerce backend so that immediately after a successful checkout, an email receipt is sent to the customer with full order details.

# Tech Assumptions
Payment already verified (e.g. Paystack/Stripe webhook or post-checkout confirmation)

Order already saved in DB

Resend is used only for transactional emails

# Step 1: Install & Configure Resend

Create a config file and configure it there

# Step 2: Define Email Trigger Point (CRITICAL)

Send the email ONLY AFTER:

Payment is confirmed

Order is successfully persisted

Example trigger locations:

After successful payment webhook verification

🚫 Never send before payment confirmation.

# Step 3

Create Email Template Function

Use HTML email (NOT plain text).

# Step 4 Error Handling (Non-Negotiable)

Email failure must NOT break checkout

Log errors only

# Step 5: Best Practices

Do NOT send marketing emails from this flow

Keep email sending async

Do NOT expose Resend API key to frontend

Prefer webhooks > frontend confirmation

# Final Output Expectation

You should:

Generate production-ready email logic

Integrate Resend safely

Trigger email post-payment only

Use HTML receipt layout

Include error handling

Avoid blocking checkout