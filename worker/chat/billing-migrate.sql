-- For databases created before invoices had a title. Run once; it fails harmlessly if the column already exists.
ALTER TABLE invoices ADD COLUMN title TEXT NOT NULL DEFAULT '';
