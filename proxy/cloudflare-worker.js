// First-party passthrough proxy for Umami Cloud.
//
// Deploy on a subdomain you control (e.g. stats.yourshop.com), then set
// UMAMI_HOST in umami-pixel.js to that subdomain.
//
// Umami identifies visitors by hashing IP + User-Agent, so the proxy must
// pass both through — otherwise every visitor collapses into one session.

const UPSTREAM = 'https://cloud.umami.is';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // The pixel sandbox is a cross-origin iframe, so the browser preflights.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname !== '/api/send' || request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }

    const upstream = await fetch(`${UPSTREAM}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': request.headers.get('User-Agent') || '',
        'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || '',
      },
      body: request.body,
    });

    const response = new Response(upstream.body, upstream);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
    return response;
  },
};
