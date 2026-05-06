CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _full_name text;
  _org_id uuid;
  _slug text;
BEGIN
  _full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email);

  -- Profile
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, _full_name)
  ON CONFLICT (id) DO NOTHING;

  -- Legacy global role (first user becomes admin)
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member');
  END IF;

  -- Auto-create an organization for this user if they don't already belong to one
  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = NEW.id) THEN
    _slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]+', '-', 'g'))
             || '-' || substr(NEW.id::text, 1, 8);

    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (COALESCE(_full_name, 'My Organization'), _slug, NEW.id)
    RETURNING id INTO _org_id;

    INSERT INTO public.app_users (organization_id, user_id, role, invited_by)
    VALUES (_org_id, NEW.id, 'owner', NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

-- Make sure the trigger on auth.users exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();