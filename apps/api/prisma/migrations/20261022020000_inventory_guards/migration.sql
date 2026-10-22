ALTER TABLE "StockMovement" ADD COLUMN "sequence" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "StockMovement_sequence_key" ON "StockMovement"("sequence");
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_balance_nonnegative" CHECK ("balance" >= 0);
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_cost_nonnegative" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_expiry_consistent" CHECK (("expiryStatus" = 'DATED' AND "expiresOn" IS NOT NULL) OR ("expiryStatus" IN ('UNKNOWN','NA') AND "expiresOn" IS NULL));
ALTER TABLE "Product" ADD CONSTRAINT "Product_minimum_nonnegative" CHECK ("minimum" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_supported_unit" CHECK ("unit" IN ('L','kg','g','mL','un','m'));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_delta_nonzero" CHECK ("delta" <> 0);
