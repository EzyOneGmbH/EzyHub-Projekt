-- Add metadata JSONB to clients to store extra UI fields without breaking existing schema
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Extend content_type enum with audit/note/report
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.content_type'::regtype AND enumlabel = 'audit') THEN
    ALTER TYPE public.content_type ADD VALUE 'audit';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.content_type'::regtype AND enumlabel = 'note') THEN
    ALTER TYPE public.content_type ADD VALUE 'note';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.content_type'::regtype AND enumlabel = 'report') THEN
    ALTER TYPE public.content_type ADD VALUE 'report';
  END IF;
END $$;

-- Extend content_status enum with archived
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.content_status'::regtype AND enumlabel = 'archived') THEN
    ALTER TYPE public.content_status ADD VALUE 'archived';
  END IF;
END $$;