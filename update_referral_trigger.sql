-- 1. Öffne das Supabase Dashboard
-- 2. Gehe zum SQL Editor
-- 3. Füge diesen Code ein und klicke auf "Run"

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  used_referral_code text;
  referrer_profile_id uuid;
BEGIN
  -- 1. Profil anlegen (Existierende Logik)
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    new.id, 
    new.email, 
    new.raw_user_meta_data->>'name'
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = excluded.full_name;

  -- 2. Referral Code aus Metadaten lesen (NEU)
  used_referral_code := new.raw_user_meta_data->>'referral_code_used';
  
  -- Wenn ein Code verwendet wurde...
  IF used_referral_code IS NOT NULL AND used_referral_code <> '' THEN
    -- ...suche den Werber (Profile ID)
    SELECT id INTO referrer_profile_id 
    FROM public.profiles 
    WHERE referral_code = used_referral_code 
    LIMIT 1;
    
    -- ...und erstelle den Eintrag in der referrals Tabelle
    IF referrer_profile_id IS NOT NULL THEN
      -- Wir prüfen zur Sicherheit, ob nicht schon ein Eintrag existiert
      IF NOT EXISTS (SELECT 1 FROM public.referrals WHERE referred_user_id = new.id) THEN
          INSERT INTO public.referrals (referrer_id, referred_user_id, status)
          VALUES (referrer_profile_id, new.id, 0);
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

