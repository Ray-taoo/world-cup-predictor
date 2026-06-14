export type GroupId =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L";

export type OutcomeKey = "home" | "draw" | "away";

export interface Team {
  id: string;
  name: string;
  group: GroupId;
  confederation: string;
  isHost: boolean;
  elo: number;
  recentForm: {
    matches: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
  };
  fifaRank: number | null;
  marketValueEurM: number | null;
}

export interface Group {
  id: GroupId;
  teams: string[];
}

export interface Fixture {
  id: string;
  matchNumber: number;
  stage: "group";
  group: GroupId;
  dateLabel: string;
  sortDate: string;
  home: string;
  away: string;
  venue: string;
}

export interface DataSource {
  name: string;
  url: string;
  fetchedAt: string;
  usage: string;
}

export interface BacktestResult {
  year: number;
  champion: string;
  actualChampionPreTournamentProbability: number;
  matches: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  rawAccuracy?: number;
  rawBrier?: number;
  rawLogLoss?: number;
  highConfidence55Matches?: number;
  highConfidence55Accuracy?: number | null;
  highConfidence60Matches?: number;
  highConfidence60Accuracy?: number | null;
  highConfidence70Matches?: number;
  highConfidence70Accuracy?: number | null;
  overconfidentMatches?: number;
  overconfidentWrong?: number;
}

export interface GeneratedData {
  generatedAt: string;
  sources: DataSource[];
  groups: Group[];
  teams: Team[];
  fixtures: Fixture[];
  backtests: BacktestResult[];
  calibration?: {
    modelTemperature: number;
    defaultMarketWeight: number;
    optimizedMarketWeight: number | null;
    note: string;
  };
}

export interface OverrideResult {
  matchId: string;
  homeScore: number;
  awayScore: number;
  note: string | null;
  updatedAt: string;
}

export interface OddsQuote {
  matchId: string;
  provider: string;
  homePrice: number;
  drawPrice: number;
  awayPrice: number;
  quoteType: "opening" | "current" | "closing";
  marketKind: "sportsbook" | "prediction_market";
  fetchedAt: string;
  sourceUrl: string;
}

export interface TeamInput {
  teamName: string;
  fifaRank: number | null;
  marketValueEurM: number | null;
  projectedXIValueEurM: number | null;
  injuries: number;
  suspensions: number;
  keyAbsences: number;
  lineupCheckedAt: string | null;
  updatedAt: string;
  sourceUrl: string;
}

export interface MatchPrediction {
  match: Fixture;
  model: ProbabilitySet;
  market: ProbabilitySet | null;
  blended: ProbabilitySet;
  xgHome: number;
  xgAway: number;
  likelyScore: string;
  odds: OddsQuote | null;
  marketMeta: MarketMeta;
  confidenceLabel: string;
  recommendationLevel: "盘口支持强推荐" | "模型强盘口弱" | "谨慎" | "观望";
  confidenceScore: number;
  manualDataCoverage: "both" | "one" | "none";
  teamDataFreshness: "fresh" | "partial" | "stale" | "missing";
  lineupCheckFreshness: "fresh" | "partial" | "stale" | "missing";
  dataQualityScore: number;
  dataWarnings: string[];
  explanation: string[];
}

export interface ProbabilitySet {
  home: number;
  draw: number;
  away: number;
}

export interface MarketMeta {
  providerCount: number;
  consensusSpread: number | null;
  consensusStatus: "多源一致" | "单一来源" | "分歧偏大" | "缺少盘口";
  marketWeight: number;
  sourceLabel: string;
}

export interface StandingRow {
  team: string;
  group: GroupId;
  played: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  expectedPoints: number;
  elo: number;
}

export interface SimulationResult {
  simulations: number;
  teams: Record<
    string,
    {
      roundOf32: number;
      roundOf16: number;
      quarterFinal: number;
      semiFinal: number;
      final: number;
      champion: number;
    }
  >;
  projectedBracket: BracketMatch[];
}

export interface BracketMatch {
  id: number;
  round: "R32" | "R16" | "QF" | "SF" | "Final" | "Third";
  homeLabel: string;
  awayLabel: string;
  homeTeam?: string;
  awayTeam?: string;
}
