import { pgTable, uuid, text, boolean, timestamp, numeric, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const modeEnum = pgEnum('mode', ['parcel','ltl','ftl','air','ocean','rail','intermodal']);
export const rateTypeEnum = pgEnum('rate_type', ['contract','spot']);
export const chargeBasisEnum = pgEnum('charge_basis', ['per_shipment','per_kg','per_lb','per_cbm']);
export const surchargeKindEnum = pgEnum('surcharge_kind', ['fixed','percent']);

export const carriers = pgTable('carriers', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	code: text('code'),
	mode: text('mode'),
	country: text('country'),
	isActive: boolean('is_active').default(true),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at'),
});

export const rates = pgTable('rates', {
	id: uuid('id').primaryKey(),
	carrierId: uuid('carrier_id').notNull(),
	origin: text('origin').notNull(),
	destination: text('destination').notNull(),
	mode: modeEnum('mode').notNull(),
	rateType: rateTypeEnum('rate_type').notNull(),
	baseRate: numeric('base_rate').notNull(),
	chargeBasis: chargeBasisEnum('charge_basis').default('per_shipment'),
	fuelSurcharge: numeric('fuel_surcharge').default('0'),
	accessorials: jsonb('accessorials'),
	currency: text('currency').default('EUR'),
	validFrom: timestamp('valid_from').notNull(),
	validTo: timestamp('valid_to').notNull(),
	transitDays: text('transit_days'),
	minWeight: numeric('min_weight'),
	maxWeight: numeric('max_weight'),
	contractNumber: text('contract_number'),
	isActive: boolean('is_active').default(true),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at'),
});

export const surcharges = pgTable('surcharges', {
	id: uuid('id').primaryKey(),
	code: text('code').notNull(),        // e.g., THC, DOC, SECURITY
	description: text('description'),
	appliesToMode: text('applies_to_mode'), // optional filter by mode
	appliesToRateType: text('applies_to_rate_type'), // optional filter by rate_type
	kind: surchargeKindEnum('kind').notNull().default('fixed'),
	amount: numeric('amount').notNull(), // if fixed, in currency; if percent, 0-100
	currency: text('currency').default('EUR'),
	isActive: boolean('is_active').default(true),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
});
