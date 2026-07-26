// Umami Cloud custom pixel for Shopify.
// Paste into: Shopify admin → Settings → Customer events → Add custom pixel.
//
// Shopify custom pixels have no settings UI — edit the two constants below.
// `analytics`, `browser`, and `init` are injected by the pixel sandbox.

// ==== CONFIG ================================================================
const UMAMI_WEBSITE_ID = 'REPLACE-WITH-YOUR-WEBSITE-ID';
// Umami Cloud default. For a first-party setup, point this at your own
// reverse proxy (see proxy/cloudflare-worker.js), e.g. 'https://stats.yourshop.com'.
const UMAMI_HOST = 'https://cloud.umami.is';
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
  if (data) payload.data = data;
  fetch(UMAMI_HOST + '/api/send', {
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

analytics.subscribe('page_viewed', (event) => send(event));

for (const name of Object.keys(extractors)) {
  analytics.subscribe(name, (event) =>
    send(event, name, clean(extractors[name](event.data || {}))),
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
