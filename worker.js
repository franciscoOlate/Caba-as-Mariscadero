// ===== WORKER MARISCADERO API =====
// Protege: contraseña admin, Pantry ID, y Groq API key
// Las variables GROQ_API_KEY, ADMIN_PASS, PANTRY_ID vienen de los Secrets configurados en Cloudflare

const BASKET_NAME = 'reservas';

// Headers CORS para que tu página web pueda llamar a este worker
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // ===== 1) LOGIN ADMIN =====
    // El navegador manda la contraseña, el Worker la compara con el secret real.
    // La contraseña real (ADMIN_PASS) nunca se envía de vuelta al navegador.
    if (path === '/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const ok = body.password === env.ADMIN_PASS;
      return jsonResponse({ ok });
    }

    // ===== 2) LEER RESERVAS (público, sin contraseña) =====
    if (path === '/reservas' && request.method === 'GET') {
      const pantryUrl = `https://getpantry.cloud/apiv1/pantry/${env.PANTRY_ID}/basket/${BASKET_NAME}`;
      const res = await fetch(pantryUrl);
      const data = await res.json().catch(() => ({}));
      return jsonResponse(data);
    }

    // ===== 3) GUARDAR RESERVAS (requiere contraseña) =====
    if (path === '/reservas' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const password = auth.replace('Bearer ', '');

      if (password !== env.ADMIN_PASS) {
        return jsonResponse({ error: 'No autorizado' }, 401);
      }

      const body = await request.json().catch(() => null);
      if (!body) return jsonResponse({ error: 'Datos inválidos' }, 400);

      const pantryUrl = `https://getpantry.cloud/apiv1/pantry/${env.PANTRY_ID}/basket/${BASKET_NAME}`;
      const res = await fetch(pantryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) return jsonResponse({ error: 'Error al guardar en Pantry' }, 502);
      return jsonResponse({ ok: true });
    }

    // ===== 4) CHATBOT (proxy seguro hacia Groq) =====
    if (path === '/chat' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !body.messages) {
        return jsonResponse({ error: 'Faltan mensajes' }, 400);
      }

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: body.messages,
          temperature: 0.7,
          max_tokens: 700,
        }),
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        return jsonResponse({ error: 'Error de Groq', detail: errText }, 502);
      }

      const data = await groqRes.json();
      const respuesta = data.choices?.[0]?.message?.content || 'No pude generar una respuesta.';
      return jsonResponse({ respuesta });
    }

    // Ruta no encontrada
    return jsonResponse({ error: 'Ruta no encontrada' }, 404);
  },
};
