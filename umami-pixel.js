// Umami Cloud custom pixel for Shopify.
// Paste into: Shopify admin → Settings → Customer events → Add custom pixel.
//
// Shopify custom pixels have no settings UI — edit the constants below.
// `analytics`, `browser`, and `init` are injected by the pixel sandbox.

// ==== CONFIG ================================================================
const UMAMI_WEBSITE_ID = 'REPLACE-WITH-YOUR-WEBSITE-ID';
// Umami Cloud default. For a first-party setup, point this at your own
// reverse proxy (see proxy/cloudflare-worker.js), e.g. 'https://stats.yourshop.com'.
const UMAMI_HOST = 'https://cloud.umami.is';
// Custom events forwarded to Umami, e.g. ['mystore:cta_clicked']. The prefix
// is stripped for the Umami event name; customData becomes the event data.
// Allowlist by design — visitors can publish custom events from the console.
// 'umami:ab' is built in (A/B exposure passthrough) — don't list it here.
const CUSTOM_EVENTS = [];
// ============================================================================

// The lax sandbox is an iframe, so window.location is the sandbox URL.
// Real page info comes from the event's context snapshot.
function basePayload(event) {
  const ctx = (event && event.context) || init.context;
  const doc = ctx.document || {};
  const loc = doc.location || {};
  const nav = ctx.navigator || {};
  const screen = (ctx.window && ctx.window.screen) || {};
  return {
    website: UMAMI_WEBSITE_ID,
    hostname: loc.hostname,
    url: (loc.pathname || '/') + (loc.search || ''),
    title: doc.title,
    referrer: doc.referrer || '',
    language: nav.language,
    screen: screen.width ? screen.width + 'x' + screen.height : undefined,
  };
}

function send(event, name, data) {
  const payload = basePayload(event);
  if (name) payload.name = name;
  if (data && Object.keys(data).length) payload.data = data;
  return fetch(UMAMI_HOST + '/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'event', payload }),
    keepalive: true,
  }).catch(() => {});
}

const amount = (money) => (money ? Number(money.amount) : undefined);

function variantData(variant) {
  if (!variant) return {};
  return {
    product: variant.product && variant.product.title,
    variant: variant.title,
    sku: variant.sku || undefined,
    price: amount(variant.price),
    currency: variant.price && variant.price.currencyCode,
  };
}

function checkoutData(checkout) {
  if (!checkout) return {};
  return {
    value: amount(checkout.totalPrice),
    currency: checkout.currencyCode,
    items: checkout.lineItems ? checkout.lineItems.length : undefined,
  };
}

// Event name → data derived from the Shopify event payload.
const extractors = {
  product_viewed: (data) => variantData(data.productVariant),
  collection_viewed: (data) => ({
    collection: data.collection && data.collection.title,
  }),
  search_submitted: (data) => ({
    query: data.searchResult && data.searchResult.query,
  }),
  cart_viewed: (data) =>
    data.cart
      ? {
          value: amount(data.cart.cost && data.cart.cost.totalAmount),
          currency:
            data.cart.cost &&
            data.cart.cost.totalAmount &&
            data.cart.cost.totalAmount.currencyCode,
          items: data.cart.totalQuantity,
        }
      : {},
  product_added_to_cart: (data) => cartLineData(data.cartLine),
  product_removed_from_cart: (data) => cartLineData(data.cartLine),
  checkout_started: (data) => checkoutData(data.checkout),
  checkout_contact_info_submitted: (data) => checkoutData(data.checkout),
  checkout_address_info_submitted: (data) => checkoutData(data.checkout),
  checkout_shipping_info_submitted: (data) => checkoutData(data.checkout),
  payment_info_submitted: (data) => checkoutData(data.checkout),
};

function cartLineData(line) {
  if (!line) return {};
  return {
    ...variantData(line.merchandise),
    quantity: line.quantity,
    value: amount(line.cost && line.cost.totalAmount),
  };
}

function clean(data) {
  const out = {};
  for (const key of Object.keys(data)) {
    if (data[key] !== undefined && data[key] !== null) out[key] = data[key];
  }
  return out;
}

// Everything sends in real time. The only sequencing rule: 'ab_assigned'
// waits for the pageview's request to settle, so exposures always land
// after page_viewed.
let pageViewedSent;
const pageViewed = new Promise((resolve) => {
  pageViewedSent = resolve;
});

analytics.subscribe('page_viewed', (event) => {
  send(event).then(pageViewedSent);
});

// A/B exposure passthrough: the theme buckets, dedupes, and publishes —
//   Shopify.analytics.publish('umami:ab', { test: 'hero', variant: '1' });
// Every publish becomes one 'ab_assigned' event, verbatim.
analytics.subscribe('umami:ab', async (event) => {
  const data = event.customData || {};
  if (!data.test || data.variant === undefined || data.variant === null) return;
  await pageViewed;
  send(event, 'ab_assigned', {
    test: String(data.test),
    variant: String(data.variant),
  });
});

for (const name of Object.keys(extractors)) {
  analytics.subscribe(name, (event) =>
    send(event, name, clean(extractors[name](event.data || {}))),
  );
}

// Theme-published custom events (Shopify.analytics.publish) — forwarded
// verbatim, no dedupe: repeats are real actions.
for (const fullName of CUSTOM_EVENTS) {
  analytics.subscribe(fullName, (event) =>
    send(event, fullName.split(':').pop(), clean(event.customData || {})),
  );
}

// checkout_completed gets a localStorage guard: the thank-you page can
// replay the event on refresh, which would double-count revenue.
analytics.subscribe('checkout_completed', async (event) => {
  const checkout = (event.data && event.data.checkout) || {};
  if (checkout.token) {
    const seen = await browser.localStorage.getItem('umami_checkout_token');
    if (seen === checkout.token) return;
    browser.localStorage.setItem('umami_checkout_token', checkout.token);
  }
  send(
    event,
    'checkout_completed',
    clean({
      // `revenue` + `currency` are the property names Umami's revenue report reads.
      revenue: amount(checkout.totalPrice),
      currency: checkout.currencyCode,
      items: checkout.lineItems ? checkout.lineItems.length : undefined,
      order: checkout.order && checkout.order.id,
    }),
  );
});
