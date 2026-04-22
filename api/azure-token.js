const AZURE_TOKEN_ENDPOINT = (region) =>
  `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`;

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region) {
    console.error('Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION');
    return res.status(500).json({ error: 'Speech service not configured' });
  }

  try {
    const apiRes = await fetch(AZURE_TOKEN_ENDPOINT(region), {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Length': '0'
      }
    });

    if (!apiRes.ok) {
      console.error(`Azure token fetch failed: ${apiRes.status}`);
      return res.status(502).json({ error: 'Failed to obtain speech token' });
    }

    const token = await apiRes.text();

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      token,
      region,
      expiresInSeconds: 540
    });
  } catch (error) {
    console.error('Azure token error:', error);
    return res.status(500).json({ error: 'Failed to obtain speech token' });
  }
}
