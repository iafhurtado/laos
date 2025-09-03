import type { z } from 'zod';

export type Mode = 'parcel' | 'LTL' | 'FTL' | 'air' | 'ocean';

export interface ShipmentSpec {
  origin: string;
  destination: string;
  weightLbs: number;
  mode?: Mode;
}

export interface RateComponent {
  baseRate: number; // USD
  ratePerLb: number; // USD per lb
}

export interface Quote {
  carrierId: string;
  carrierName?: string;
  mode: Mode;
  origin: string;
  destination: string;
  minWeightLbs?: number | null;
  maxWeightLbs?: number | null;
  components: RateComponent;
  transitDays?: number | null;
  metadata?: Record<string, any>;
  // Pricing metadata (MVP)
  chargeBasis?: ChargeBasis; // per_shipment | per_kg | per_lb | per_cbm
  fuelPct?: number; // percent
  currency?: string; // e.g., EUR
}

export interface ScoreBreakdown {
  totalCostUsd: number;
  costPerLbUsd: number;
  weightFitPenalty: number; // 0..1 (lower is better)
  // Optional multi-factor breakdown (0..1 where higher is better)
  costScore?: number;
  timeScore?: number;
  reliabilityScore?: number;
  riskScore?: number;
  // Weighted composite score (0..1 higher is better)
  compositeScore?: number;
  // The weights used for the composite
  weights?: {
    cost: number;
    time: number;
    reliability: number;
    risk: number;
  };
  // Pricing extras
  currency?: string;
  baseAmount?: number;
  fuelPctApplied?: number;
}

export interface ScoredQuote extends Quote {
  score: number; // lower is better (cost-centric)
  breakdown: ScoreBreakdown;
}

export interface GetRatesInput {
  origin: string;
  destination: string;
  weightLbs: number;
  mode?: Mode;
}

export interface ScoringPolicyWeights {
  cost: number;
  time: number;
  reliability: number;
  risk: number;
}

export interface ScoringPolicy {
  weights: ScoringPolicyWeights; // will be normalized internally to sum to 1
  // Optional constraints or preferences (future use)
  maxTransitDays?: number;
  preferredCarriers?: string[];
}

export type ChargeBasis = 'per_shipment' | 'per_kg' | 'per_lb' | 'per_cbm';


