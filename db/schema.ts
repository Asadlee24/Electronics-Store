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
export const adminCredentials = sqliteTable('admin_credentials', {
  id: integer('id').primaryKey(),
  passwordHash: text('password_hash'),
  ownerEmail: text('owner_email'),
  pendingEmail: text('pending_email'),
  pendingEmailHash: text('pending_email_hash'),
  pendingEmailExpires: integer('pending_email_expires'),
  revision: integer('revision').notNull().default(0),
  resetHash: text('reset_hash'),
  resetExpires: integer('reset_expires'),
  resetSentAt: integer('reset_sent_at')
});
export const adminSessions = sqliteTable('admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  revision: integer('revision').notNull(),
  expiresAt: integer('expires_at').notNull()
});
export const adminAttempts = sqliteTable('admin_attempts', {
  id: text('id').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull()
});
export const emailOutbox = sqliteTable('email_outbox', {
  id: text('id').primaryKey(),
  recipient: text('recipient').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttempt: integer('next_attempt'),
  providerId: text('provider_id'),
  lastError: text('last_error')
});
export const mailSettings = sqliteTable('mail_settings', {
  id: integer('id').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: integer('updated_at').notNull()
});
export const emailActivity = sqliteTable('email_activity', {
  id: text('id').primaryKey(),
  purpose: text('purpose').notNull(),
  recipient: text('recipient').notNull(),
  status: text('status').notNull(),
  providerId: text('provider_id'),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull()
});
