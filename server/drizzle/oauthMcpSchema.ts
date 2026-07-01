import { relations } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './schema';

export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: varchar('clientId', { length: 255 }).notNull().unique(),
    clientName: varchar('clientName', { length: 255 }).notNull(),
    clientUri: text('clientUri'),
    logoUri: text('logoUri'),
    redirectUris: text('redirectUris').array().notNull(),
    scopes: text('scopes').array().notNull().default([]),
    grantTypes: text('grantTypes')
      .array()
      .notNull()
      .default(['authorization_code', 'refresh_token']),
    responseTypes: text('responseTypes').array().notNull().default(['code']),
    createdAt: timestamp('createdAt', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({ clientIdIdx: index('oauth_clients_clientId_idx').on(table.clientId) })
);

export const oauthAuthorizationRequests = pgTable(
  'oauth_authorization_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: varchar('clientId', { length: 255 }).notNull(),
    redirectUri: text('redirectUri').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    state: text('state'),
    resource: text('resource').notNull(),
    codeChallenge: text('codeChallenge').notNull(),
    codeChallengeMethod: varchar('codeChallengeMethod', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    userid: uuid('userid'),
    expiresAt: timestamp('expiresAt', { withTimezone: true, precision: 6 }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({
    clientIdIdx: index('oauth_authorization_requests_clientId_idx').on(table.clientId),
    expiresAtIdx: index('oauth_authorization_requests_expiresAt_idx').on(table.expiresAt),
    clientFk: foreignKey({ columns: [table.clientId], foreignColumns: [oauthClients.clientId] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    useridFk: foreignKey({ columns: [table.userid], foreignColumns: [users.id] })
      .onDelete('set null')
      .onUpdate('cascade'),
  })
);

export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: text('codeHash').notNull().unique(),
    requestId: uuid('requestId').notNull(),
    clientId: varchar('clientId', { length: 255 }).notNull(),
    userid: uuid('userid').notNull(),
    redirectUri: text('redirectUri').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    resource: text('resource').notNull(),
    codeChallenge: text('codeChallenge').notNull(),
    codeChallengeMethod: varchar('codeChallengeMethod', { length: 20 }).notNull(),
    consumedAt: timestamp('consumedAt', { withTimezone: true, precision: 6 }),
    expiresAt: timestamp('expiresAt', { withTimezone: true, precision: 6 }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({
    codeHashIdx: index('oauth_authorization_codes_codeHash_idx').on(table.codeHash),
    requestIdIdx: index('oauth_authorization_codes_requestId_idx').on(table.requestId),
    clientFk: foreignKey({ columns: [table.clientId], foreignColumns: [oauthClients.clientId] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    requestFk: foreignKey({
      columns: [table.requestId],
      foreignColumns: [oauthAuthorizationRequests.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    useridFk: foreignKey({ columns: [table.userid], foreignColumns: [users.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
  })
);

export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('tokenHash').notNull().unique(),
    clientId: varchar('clientId', { length: 255 }).notNull(),
    userid: uuid('userid').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    resource: text('resource').notNull(),
    revokedAt: timestamp('revokedAt', { withTimezone: true, precision: 6 }),
    replacedByTokenId: uuid('replacedByTokenId'),
    expiresAt: timestamp('expiresAt', { withTimezone: true, precision: 6 }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashIdx: index('oauth_refresh_tokens_tokenHash_idx').on(table.tokenHash),
    clientUserIdx: index('oauth_refresh_tokens_client_user_idx').on(table.clientId, table.userid),
    clientFk: foreignKey({ columns: [table.clientId], foreignColumns: [oauthClients.clientId] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    useridFk: foreignKey({ columns: [table.userid], foreignColumns: [users.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
  })
);

export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userid: uuid('userid').notNull(),
    clientId: varchar('clientId', { length: 255 }).notNull(),
    scopes: text('scopes').array().notNull().default([]),
    resource: text('resource').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true, precision: 6 }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueUserClientResource: unique('unique_oauth_grant_user_client_resource').on(
      table.userid,
      table.clientId,
      table.resource
    ),
    useridIdx: index('oauth_grants_userid_idx').on(table.userid),
    clientFk: foreignKey({ columns: [table.clientId], foreignColumns: [oauthClients.clientId] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    useridFk: foreignKey({ columns: [table.userid], foreignColumns: [users.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
  })
);

export const oauthClientsRelations = relations(oauthClients, ({ many }) => ({
  authorizationRequests: many(oauthAuthorizationRequests),
  authorizationCodes: many(oauthAuthorizationCodes),
  refreshTokens: many(oauthRefreshTokens),
  grants: many(oauthGrants),
}));

export const oauthAuthorizationRequestsRelations = relations(
  oauthAuthorizationRequests,
  ({ one, many }) => ({
    client: one(oauthClients, {
      fields: [oauthAuthorizationRequests.clientId],
      references: [oauthClients.clientId],
    }),
    user: one(users, { fields: [oauthAuthorizationRequests.userid], references: [users.id] }),
    codes: many(oauthAuthorizationCodes),
  })
);

export const oauthAuthorizationCodesRelations = relations(oauthAuthorizationCodes, ({ one }) => ({
  client: one(oauthClients, {
    fields: [oauthAuthorizationCodes.clientId],
    references: [oauthClients.clientId],
  }),
  request: one(oauthAuthorizationRequests, {
    fields: [oauthAuthorizationCodes.requestId],
    references: [oauthAuthorizationRequests.id],
  }),
  user: one(users, { fields: [oauthAuthorizationCodes.userid], references: [users.id] }),
}));

export const oauthRefreshTokensRelations = relations(oauthRefreshTokens, ({ one }) => ({
  client: one(oauthClients, {
    fields: [oauthRefreshTokens.clientId],
    references: [oauthClients.clientId],
  }),
  user: one(users, { fields: [oauthRefreshTokens.userid], references: [users.id] }),
}));

export const oauthGrantsRelations = relations(oauthGrants, ({ one }) => ({
  client: one(oauthClients, {
    fields: [oauthGrants.clientId],
    references: [oauthClients.clientId],
  }),
  user: one(users, { fields: [oauthGrants.userid], references: [users.id] }),
}));

export type OAuthClient = typeof oauthClients.$inferSelect;
export type NewOAuthClient = typeof oauthClients.$inferInsert;
export type OAuthAuthorizationRequest = typeof oauthAuthorizationRequests.$inferSelect;
export type NewOAuthAuthorizationRequest = typeof oauthAuthorizationRequests.$inferInsert;
export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type NewOAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferInsert;
export type OAuthRefreshToken = typeof oauthRefreshTokens.$inferSelect;
export type NewOAuthRefreshToken = typeof oauthRefreshTokens.$inferInsert;
export type OAuthGrant = typeof oauthGrants.$inferSelect;
export type NewOAuthGrant = typeof oauthGrants.$inferInsert;
