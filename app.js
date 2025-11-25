// Supabase Konfiguration
// Konfiguration wird aus config.js geladen (lokal) oder im Build-Prozess injiziert
const SUPABASE_URL = (typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : window.env?.SUPABASE_URL) || '';
const SUPABASE_ANON_KEY = (typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_ANON_KEY : window.env?.SUPABASE_ANON_KEY) || '';

// Supabase Client initialisieren
// Wir prüfen, ob supabase global verfügbar ist (durch das CDN script im HTML)
let supabase;
if (typeof createClient !== 'undefined') {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else if (window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Hilfsfunktion zum Überprüfen der Authentifizierung
async function checkAuth() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}

// Datei hochladen
async function uploadFile(file, bucketName = 'uploads') {
    try {
        const session = await checkAuth();
        if (!session) {
            throw new Error('Nicht angemeldet');
        }

        // Dateinamen bereinigen (Sonderzeichen entfernen)
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const timestamp = Date.now();
        const fileName = `${session.user.id}/${timestamp}-${cleanFileName}`;
        
        // Datei hochladen
        const { data, error } = await supabase.storage
            .from(bucketName)
            .upload(fileName, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) throw error;

        return {
            success: true,
            path: data.path,
            fileName: file.name,
            size: file.size
        };
    } catch (error) {
        console.error('Upload-Fehler:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Dateien abrufen (für den eingeloggten User)
async function getFiles(bucketName = 'uploads') {
    try {
        const session = await checkAuth();
        if (!session) return { success: false, error: 'Nicht angemeldet' };

        // Wir listen Dateien im Ordner des Users auf
        const { data, error } = await supabase.storage
            .from(bucketName)
            .list(session.user.id, {
                limit: 100,
                offset: 0,
                sortBy: { column: 'created_at', order: 'desc' }
            });

        if (error) throw error;

        return {
            success: true,
            files: data
        };
    } catch (error) {
        console.error('Fehler beim Abrufen der Dateien:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Datei löschen
async function deleteFile(fileName, bucketName = 'uploads') {
    try {
        const session = await checkAuth();
        if (!session) return { success: false, error: 'Nicht angemeldet' };

        // Pfad korrigieren: Wenn fileName keinen Slash enthält, füge User-ID hinzu
        const fullPath = fileName.includes('/') ? fileName : `${session.user.id}/${fileName}`;

        const { error } = await supabase.storage
            .from(bucketName)
            .remove([fullPath]);

        if (error) throw error;

        return {
            success: true
        };
    } catch (error) {
        console.error('Fehler beim Löschen:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Hilfsfunktion zum Formatieren der Dateigröße
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Auth State Listener
if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN') {
            console.log('Benutzer angemeldet:', session.user.email);
            // Prüfen ob Profil/Ref-Code existiert, wenn nicht generieren
            ensureProfile(session.user);

            // Wenn User auf Login oder Registrierungsseite ist -> Ab zum Dashboard
            const currentPath = window.location.pathname;
            if (currentPath.includes('index.html') || currentPath.includes('registrieren.html') || currentPath === '/') {
                window.location.href = 'dashboard.html';
            }

        } else if (event === 'SIGNED_OUT') {
            console.log('Benutzer abgemeldet');
            if (!window.location.href.includes('index.html') && !window.location.href.includes('registrieren.html') && !window.location.href.includes('passwort-vergessen.html')) {
                window.location.href = 'index.html';
            }
        }
    });
}

// --- REFERRAL SYSTEM ---

// Profil sicherstellen und Ref-Code generieren
async function ensureProfile(user) {
    try {
        // Prüfen ob Code existiert
        const { data, error } = await supabase
            .from('profiles')
            .select('referral_code')
            .eq('id', user.id)
            .single();

        if (data && !data.referral_code) {
            // Generiere Code: Erste 3 Buchstaben Name/Mail + Zufallszahlen
            const prefix = (user.email.substring(0, 3)).toUpperCase();
            const random = Math.floor(100000 + Math.random() * 900000);
            const newCode = `${prefix}${random}`;

            await supabase
                .from('profiles')
                .update({ referral_code: newCode })
                .eq('id', user.id);
        }
    } catch (e) {
        console.error("Fehler beim Profil-Check", e);
    }
}

// Eigenen Code abrufen
async function getMyReferralCode() {
    const session = await checkAuth();
    if (!session) return null;

    const { data } = await supabase
        .from('profiles')
        .select('referral_code')
        .eq('id', session.user.id)
        .single();
    
    return data?.referral_code || 'Lade...';
}

// Link teilen Funktion
async function shareReferralLink() {
    const code = await getMyReferralCode();
    if (!code) return;

    const shareUrl = `${window.location.origin}/registrieren.html?ref=${code}`;
    const shareData = {
        title: 'EnergieQuest Einladung',
        text: `Spare Energie und Geld mit EnergieQuest! Nutze meinen Code ${code} bei der Anmeldung.`,
        url: shareUrl
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            // Fallback: In Zwischenablage kopieren
            await navigator.clipboard.writeText(shareData.text + ' ' + shareData.url);
            alert('Link in die Zwischenablage kopiert!');
        }
    } catch (err) {
        console.error('Fehler beim Teilen:', err);
    }
}

// Registrierung mit Referral (Ersetzt die Standard-Logik in registrieren.html)
async function signUpWithReferral(email, password, name, refCode) {
    console.log("Starte Registrierung...", { email, refCode });

    // 1. User registrieren
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: { 
            data: { name: name },
            emailRedirectTo: window.location.origin + '/index.html' // Wichtig für Flow
        }
    });

    if (authError) {
        console.error("Auth Fehler:", authError);
        // Bessere Fehlermeldung für User
        if (authError.message.includes("already registered") || authError.status === 422) {
            return { success: false, error: "Diese E-Mail-Adresse ist bereits registriert. Bitte melde dich an." };
        }
        return { success: false, error: authError.message };
    }

    // Sicherheitscheck: Wenn User existiert aber Identities leer sind (kann bei doppelter Registrierung passieren je nach Config)
    if (authData.user && authData.user.identities && authData.user.identities.length === 0) {
        return { success: false, error: "Diese E-Mail-Adresse ist bereits registriert. Bitte melde dich an." };
    }

    console.log("User angelegt:", authData.user?.id);

    // 2. Wenn Ref-Code vorhanden, Verknüpfung erstellen
    if (refCode && authData.user) {
        try {
            console.log("Suche Werber-Code:", refCode);
            
            // Finde die User-ID des Werbers anhand des Codes
            const { data: referrerData, error: refError } = await supabase
                .from('profiles')
                .select('id')
                .eq('referral_code', refCode)
                .single();

            if (refError || !referrerData) {
                console.warn("Werber nicht gefunden oder Fehler:", refError);
                // Wir brechen hier nicht ab, Registrierung war ja erfolgreich
                return { success: true, warning: "Referral Code ungültig" };
            }

            console.log("Werber gefunden:", referrerData.id);

            // WICHTIG: Wir müssen kurz warten oder sicherstellen, dass der Trigger das Profil des NEUEN Users angelegt hat.
            // Aber in 'referrals' speichern wir nur die ID, das sollte auch ohne Profil gehen, solange auth.users existiert.
            
            // Eintrag in die Empfehlungs-Tabelle
            const { error: insertError } = await supabase.from('referrals').insert({
                referrer_id: referrerData.id,
                referred_user_id: authData.user.id,
                status: 0 // 0 = Default Status
            });

            if (insertError) {
                console.error("Fehler beim Speichern des Referrals:", insertError);
                // Auch hier: User ist registriert, nur der Ref-Link hat gefehlt.
            } else {
                console.log("Referral erfolgreich gespeichert!");
            }

        } catch (err) {
            console.error("Unerwarteter Fehler im Referral-Prozess:", err);
        }
    }

    return { success: true };
}

// --- MENU SYSTEM ---
// Initialisiert das Burgermenü auf allen Seiten
document.addEventListener('DOMContentLoaded', () => {
    const menuBtn = document.querySelector('.menu-btn');
    if (!menuBtn) return;

    // Overlay erstellen (falls nicht da)
    if (!document.getElementById('mobileMenuOverlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'mobileMenuOverlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            right: -300px; /* Startposition außerhalb */
            width: 280px;
            height: 100%;
            background: white;
            box-shadow: -5px 0 15px rgba(0,0,0,0.1);
            z-index: 1000;
            transition: right 0.3s ease;
            padding: 20px;
            display: flex;
            flex-direction: column;
        `;
        
        // Hintergrund-Dimmer
        const backdrop = document.createElement('div');
        backdrop.id = 'menuBackdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 999;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
        `;

        // Menu Content
        overlay.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
                <h2 style="font-size: 1.2rem; margin: 0;">Menü</h2>
                <button id="closeMenuBtn" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <a href="profil.html" style="text-decoration: none; color: var(--text-primary); padding: 10px; border-radius: 8px; background: #F9FAFB; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-regular fa-user"></i> Mein Profil
                </a>
                <a href="upload.html" style="text-decoration: none; color: var(--text-primary); padding: 10px; border-radius: 8px; background: #F9FAFB; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-cloud-arrow-up"></i> Uploads
                </a>
                <a href="gutscheine.html" style="text-decoration: none; color: var(--text-primary); padding: 10px; border-radius: 8px; background: #F9FAFB; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-ticket"></i> Gutscheine
                </a>
                 <a href="empfehlungen.html" style="text-decoration: none; color: var(--text-primary); padding: 10px; border-radius: 8px; background: #F9FAFB; display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid fa-user-plus"></i> Empfehlungen
                </a>
                <div style="margin-top: auto; border-top: 1px solid #E5E7EB; padding-top: 20px;">
                    <button id="menuLogoutBtn" style="width: 100%; padding: 12px; background: #FEE2E2; color: #EF4444; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <i class="fa-solid fa-right-from-bracket"></i> Abmelden
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        document.body.appendChild(overlay);

        // Event Listeners
        const closeBtn = document.getElementById('closeMenuBtn');
        const logoutBtn = document.getElementById('menuLogoutBtn');

        function openMenu() {
            overlay.style.right = '0';
            backdrop.style.opacity = '1';
            backdrop.style.pointerEvents = 'auto';
        }

        function closeMenu() {
            overlay.style.right = '-300px';
            backdrop.style.opacity = '0';
            backdrop.style.pointerEvents = 'none';
        }

        menuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openMenu();
        });

        closeBtn.addEventListener('click', closeMenu);
        backdrop.addEventListener('click', closeMenu);

        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                if(supabase) {
                    await supabase.auth.signOut();
                    window.location.href = 'index.html';
                }
            });
        }
    }
});
