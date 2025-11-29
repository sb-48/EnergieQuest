-- FIX: Case-Insensitive Suche und robustere Trigger-Logik

-- 1. Trigger Funktion verbessern
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

  -- B) Referral Code lesen
  used_referral_code := new.raw_user_meta_data->>'referral_code_used';
  
  -- Fallback Key
  IF used_referral_code IS NULL OR used_referral_code = '' THEN
     used_referral_code := new.raw_user_meta_data->>'referralCode';
  END IF;

  -- C) Code verarbeiten (Trimmen)
  IF used_referral_code IS NOT NULL AND used_referral_code <> '' THEN
    
    -- Werber suchen (Case-Insensitive: ILIKE statt =)
    SELECT id INTO referrer_profile_id 
    FROM public.profiles 
    WHERE referral_code ILIKE trim(used_referral_code)
    LIMIT 1;
    
    -- D) Referral Eintrag erstellen
    IF referrer_profile_id IS NOT NULL THEN
      -- Verhindere Selbst-Referral
      IF referrer_profile_id <> new.id THEN
          INSERT INTO public.referrals (referrer_id, referred_user_id, status)
          VALUES (referrer_profile_id, new.id, 0)
          ON CONFLICT DO NOTHING; -- Falls schon da, ignorieren
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

