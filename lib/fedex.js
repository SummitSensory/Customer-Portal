/**
 * FedEx Track API integration.
 * Uses OAuth2 client credentials to get an access token, then queries tracking.
 */

let _fedexToken = null;
let _tokenExpiry = 0;

// ── OAuth token ───────────────────────────────────────────────────────────────

async function getFedexToken() {
  if (_fedexToken && Date.now() < _tokenExpiry) return _fedexToken;

  const res = await fetch('https://apis.fedex.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.FEDEX_API_KEY,
      client_secret: process.env.FEDEX_SECRET_KEY,
    }),
  });

  if (!res.ok) throw new Error(`FedEx auth failed: ${res.status}`);
  const json = await res.json();
  _fedexToken = json.access_token;
  _tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  return _fedexToken;
}

// ── Track a shipment ──────────────────────────────────────────────────────────

/**
 * Returns simplified tracking info for a given tracking number.
 * Returns null if credentials aren't configured yet.
 */
export async function trackShipment(trackingNumber) {
  if (!process.env.FEDEX_API_KEY || !process.env.FEDEX_SECRET_KEY) return null;
  if (!trackingNumber) return null;

  try {
    const token = await getFedexToken();
    const res = await fetch('https://apis.fedex.com/track/v1/trackingnumbers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-locale': 'en_US',
      },
      body: JSON.stringify({
        includeDetailedScans: true,
        trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
      }),
    });

    if (!res.ok) throw new Error(`FedEx track failed: ${res.status}`);
    const json = await res.json();

    const result = json.output?.completeTrackResults?.[0]?.trackResults?.[0];
    if (!result) return null;

    return {
      trackingNumber,
      status: result.latestStatusDetail?.description || 'Unknown',
      statusCode: result.latestStatusDetail?.code,
      estimatedDelivery: result.estimatedDeliveryTimeWindow?.window?.ends || null,
      actualDelivery: result.actualDeliveryTime || null,
      events: (result.scanEvents || []).slice(0, 10).map(e => ({
        description: e.eventDescription,
        location: [e.scanLocation?.city, e.scanLocation?.stateOrProvinceCode]
          .filter(Boolean).join(', '),
        timestamp: e.date,
      })),
      url: `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
    };
  } catch (err) {
    console.error('FedEx tracking error:', err.message);
    return null;
  }
}
