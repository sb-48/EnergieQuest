-- ALLES IN EINEM FIX-SKRIPT

-- 1. Policies zurücksetzen (damit wir sicher sind, dass sie stimmen)
DROP POLICY IF EXISTS "View own referrals" ON referrals;
DROP POLICY IF EXISTS "Insert referrals" ON referrals;
DROP POLICY IF EXISTS "Referrals are viewable by involved parties" ON referrals;
DROP POLICY IF EXISTS "System can insert referrals" ON referrals;

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Neue Policy: Werber und Geworbener dürfen sehen
CREATE POLICY "Referrals are viewable by involved parties" 
ON referrals FOR SELECT 
USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);

-- Neue Policy: Authentifizierte User dürfen theoretisch einfügen (wird aber meist vom Trigger gemacht)
-- Wir erlauben es trotzdem, falls wir mal manuell testen wollen
CREATE POLICY "Insert referrals" 
ON referrals FOR INSERT 
TO authenticated
WITH CHECK (true); 

-- 2. Trigger Funktion aktualisieren
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  used_referral_code text;
  referrer_profile_id uuid;
BEGIN
  -- A) Profil anlegen
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    new.id, 
    new.email, 
    new.raw_user_meta_data->>'name'
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = excluded.full_name;

  -- B) Referral Code aus Metadaten lesen
  -- Wir prüfen auf verschiedene Schreibweisen, sicher ist sicher
  used_referral_code := new.raw_user_meta_data->>'referral_code_used';
  
  IF used_referral_code IS NULL THEN
     used_referral_code := new.raw_user_meta_data->>'referralCode'; -- Fallback
  END IF;

  -- C) Wenn Code da ist, Werber suchen
  IF used_referral_code IS NOT NULL AND used_referral_code <> '' THEN
    
    SELECT id INTO referrer_profile_id 
    FROM public.profiles 
    WHERE referral_code = used_referral_code 
    LIMIT 1;
    
    -- D) Referral Eintrag erstellen
    IF referrer_profile_id IS NOT NULL THEN
      -- Prüfen ob nicht schon existiert
      IF NOT EXISTS (SELECT 1 FROM public.referrals WHERE referred_user_id = new.id) THEN
          INSERT INTO public.referrals (referrer_id, referred_user_id, status)
          VALUES (referrer_profile_id, new.id, 0);
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Trigger neu setzen (sicherstellen, dass er aktiv ist)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

