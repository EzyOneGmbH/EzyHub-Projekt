-- Add Google Ads customer ID column to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_ads_customer text;

COMMENT ON COLUMN clients.google_ads_customer IS 'Google Ads Customer ID (e.g. 123-456-7890) for fetching campaign data';
