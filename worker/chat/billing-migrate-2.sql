-- Lets you switch off online (Stripe) payment for a single invoice. Run once; fails harmlessly if the column already exists.
ALTER TABLE invoices ADD COLUMN online_pay INTEGER NOT NULL DEFAULT 1;
