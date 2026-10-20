CREATE TYPE "public"."role_level" AS ENUM('employee', 'manager', 'finance', 'admin');--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"level" "role_level" NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_idx" ON "roles" USING btree (lower("name"));--> statement-breakpoint
INSERT INTO "roles" ("name", "level", "is_system") VALUES
	('Employee', 'employee', true), ('Tech Lead', 'manager', true), ('Delivery Manager', 'manager', true),
	('CTO', 'manager', true), ('Finance', 'finance', true), ('Admin', 'admin', true);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role_id" uuid;--> statement-breakpoint
UPDATE "users" u SET "role_id" = r."id" FROM "roles" r WHERE r."name" = CASE u."role"::text
	WHEN 'employee' THEN 'Employee' WHEN 'tech_lead' THEN 'Tech Lead' WHEN 'delivery_manager' THEN 'Delivery Manager'
	WHEN 'cto' THEN 'CTO' WHEN 'finance' THEN 'Finance' WHEN 'admin' THEN 'Admin' END;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");
