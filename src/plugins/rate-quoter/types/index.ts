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
}

export interface ScoreBreakdown {
  totalCostUsd: number;
  costPerLbUsd: number;
  weightFitPenalty: number; // 0..1 (lower is better)
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


