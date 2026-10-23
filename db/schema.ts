import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
export const catalogueProducts = sqliteTable('catalogue_products', {
  id: integer('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull()
});
export const orderRequests = sqliteTable('order_requests', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  reference: text('reference').notNull().unique(),
  payload: text('payload').notNull(),
  status: text('status').notNull().default('pending'),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});
