// Supabase Edge Function: E-Mail Benachrichtigung bei Upload
// Deployen mit: supabase functions deploy send-email --no-verify-jwt
// Secrets setzen: supabase secrets set SMTP_HOST=mail.your-server.de SMTP_PORT=465 SMTP_USER=info@energiequest.de SMTP_PASS=DeinPasswort

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORS Handle
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Payload lesen (kommt vom Webhook oder Client)
    const payload = await req.json();
    console.log("Empfangene Payload:", payload);

    // Wir erwarten: { record: { name: "...", id: "...", ... } } vom Database Webhook
    // ODER: { fileName: "...", userEmail: "..." } vom Client direkt aufgerufen
    
    let fileName = "Unbekannt";
    let userEmail = "Unbekannt";
    let fullName = "Unbekannt";

    // Fallunterscheidung: Aufruf durch Client (via notifyAdminAboutUpload in app.js)
    if (payload.fileName && payload.userEmail) {
        fileName = payload.fileName;
        userEmail = payload.userEmail;
        fullName = payload.fullName || "Unbekannt";
    } 
    // Fallunterscheidung: Aufruf durch Storage Webhook (optional, falls du das einrichtest)
    else if (payload.record) {
        fileName = payload.record.name;
        // User ID aus Pfad extrahieren (UserID/Timestamp-File)
        const userId = fileName.split('/')[0];
        
        // Hier müssten wir User-Daten nachladen, was einen Supabase Admin Client braucht
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', userId).single();
        if (profile) {
            fullName = profile.full_name;
            userEmail = profile.email; // Falls in Profiles gespeichert, sonst auth.users query (schwieriger)
        }
    }

    console.log(`Sende E-Mail für Upload von ${userEmail} (${fullName})...`);

    // 2. SMTP Client konfigurieren (Hetzner)
    const client = new SmtpClient();
    
    const smtpHost = Deno.env.get('SMTP_HOST') || 'mail.your-server.de';
    const smtpPort = parseInt(Deno.env.get('SMTP_PORT') || '465');
    const smtpUser = Deno.env.get('SMTP_USER') || 'info@energiequest.de';
    const smtpPass = Deno.env.get('SMTP_PASS');

    if (!smtpPass) {
        throw new Error("SMTP_PASS nicht gesetzt!");
    }

    await client.connectTLS({
      hostname: smtpHost,
      port: smtpPort,
      username: smtpUser,
      password: smtpPass,
    });

    // 3. E-Mail senden
    await client.send({
      from: smtpUser, // Muss meistens gleich dem User sein
      to: "info@energiequest.de", // Empfänger (Du)
      subject: `⚡ Neuer Upload: ${fileName}`,
      content: `
Hallo Admin,

ein neuer Upload ist eingegangen!

Details:
----------------------------------------
Nutzer: ${fullName}
E-Mail: ${userEmail}
Datei:  ${fileName}
Datum:  ${new Date().toLocaleString('de-DE')}
----------------------------------------

Bitte prüfe den Upload im Supabase Dashboard.
      `,
    });

    await client.close();

    return new Response(
      JSON.stringify({ message: 'E-Mail erfolgreich gesendet' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error("Fehler:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

