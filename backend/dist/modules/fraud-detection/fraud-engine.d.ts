export interface FraudCheckContext {
    payeeUpi: string;
    totalAmount: number;
    totalChunks: number;
    recentTransactionsCount?: number;
    timestamp?: Date;
}
export interface FraudEvaluation {
    score: number;
    riskTier: "LOW" | "MEDIUM" | "HIGH";
    triggeredRules: string[];
    recommendation: "PROCEED" | "DELAY_STRETCH" | "MANUAL_REVIEW";
}
export declare class FraudDetectionEngine {
    static evaluate(context: FraudCheckContext): FraudEvaluation;
}
