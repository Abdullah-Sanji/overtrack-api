ALTER TABLE "roles" ADD COLUMN "system_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_key_idx" ON "roles" USING btree ("system_key");--> statement-breakpoint
UPDATE "roles" SET "system_key" = CASE "name" WHEN 'Employee' THEN 'employee' WHEN 'Tech Lead' THEN 'tech_lead' WHEN 'Delivery Manager' THEN 'delivery_manager' WHEN 'CTO' THEN 'cto' WHEN 'Finance' THEN 'finance' WHEN 'Admin' THEN 'admin' END WHERE "is_system" AND "system_key" IS NULL;
