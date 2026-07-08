/**
 * Razorpay checkout.js loader + opener for the SPA.
 *
 * The order is ALWAYS created server-side (POST /billing/order); this only opens
 * the hosted checkout against that order id. On success Razorpay posts the
 * payment to us AND our webhook flips the plan — the client success handler just
 * triggers a re-fetch, it is not the source of truth for entitlement.
 */
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: (resp: unknown) => void) => void;
}
interface RazorpayCtor {
  new (options: Record<string, unknown>): RazorpayInstance;
}
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let loading: Promise<void> | null = null;

export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("Failed to load Razorpay checkout"));
    };
    document.body.appendChild(script);
  });
  return loading;
}

export interface OpenCheckoutOptions {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  name: string;
  description: string;
  prefillName?: string | null;
  prefillEmail?: string | null;
  themeColor?: string;
  onSuccess: (resp: { razorpay_payment_id: string; razorpay_order_id: string }) => void;
  onDismiss?: () => void;
}

export async function openRazorpayCheckout(opts: OpenCheckoutOptions): Promise<void> {
  await loadRazorpay();
  if (!window.Razorpay) throw new Error("Razorpay unavailable");
  const rzp = new window.Razorpay({
    key: opts.keyId,
    order_id: opts.orderId,
    amount: opts.amountPaise,
    currency: opts.currency,
    name: opts.name,
    description: opts.description,
    // UPI-first: surface UPI at the top of the method list.
    config: { display: { blocks: {}, sequence: ["block.upi"], preferences: { show_default_blocks: true } } },
    prefill: { name: opts.prefillName ?? undefined, email: opts.prefillEmail ?? undefined },
    theme: { color: opts.themeColor ?? "#2563EB" },
    handler: (resp: unknown) => opts.onSuccess(resp as { razorpay_payment_id: string; razorpay_order_id: string }),
    modal: { ondismiss: () => opts.onDismiss?.() },
  });
  rzp.open();
}
