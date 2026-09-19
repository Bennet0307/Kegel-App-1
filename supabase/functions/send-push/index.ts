// CORS-Proxy für Expo's Push-Send-Endpunkt (https://exp.host/--/api/v2/push/send).
// Läuft server-seitig, deshalb keine CORS-Blockade wie beim bisherigen
// direkten Browser-Aufruf aus sendNewEventPush() (siehe Migration 28) –
// das war die einzige Einschränkung, die einen Versand von der
// Web-Oberfläche aus verhindert hat. Nimmt bereits aufgelöste Tokens
// entgegen; der Client löst sie weiterhin selbst über die club-weit
// lesbare `member`-Tabelle auf (RLS regelt dort schon, wer welche
// Tokens sehen darf) und übergibt hier nur die fertige Liste.
// verify_jwt bleibt beim Default (aktiv): nur eingeloggte User können
// diese Funktion aufrufen, kein offenes Relay für Dritte.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { tokens, title, body } = await req.json();

    if (!Array.isArray(tokens) || tokens.length === 0 || typeof title !== 'string' || typeof body !== 'string') {
      return new Response(JSON.stringify({ error: 'tokens (string[]), title und body sind erforderlich' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const messages = tokens.map((to: string) => ({ to, title, body, sound: 'default' }));

    const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });

    const result = await expoResponse.json();

    return new Response(JSON.stringify(result), {
      status: expoResponse.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
