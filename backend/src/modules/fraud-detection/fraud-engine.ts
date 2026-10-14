export interface FraudCheckContext {
  payeeUpi: string;
  totalAmount: number;
  totalChunks: number;
  recentTransactionsCount?: number; // In the past 1 hour to same VPA
  timestamp?: Date;
}

export interface FraudEvaluation {
  score: number; // 0 to 100
  riskTier: "LOW" | "MEDIUM" | "HIGH";
  triggeredRules: string[];
  recommendation: "PROCEED" | "DELAY_STRETCH" | "MANUAL_REVIEW";
}

export class FraudDetectionEngine {
  /**
   * Evaluates risk score based on transaction attributes, velocity, and timing.
   */
  static evaluate(context: FraudCheckContext): FraudEvaluation {
    let score = 0;
    const triggeredRules: string[] = [];
    const date = context.timestamp || new Date();
    const currentHour = date.getHours(); // 0 to 23

    // 1. High Hourly Velocity Check
    const recentCount = context.recentTransactionsCount || 0;
    if (recentCount >= 8) {
      score += 40;
      triggeredRules.push("CRITICAL_HOURLY_VELOCITY_EXCEEDED");
    } else if (recentCount >= 4) {
      score += 25;
      triggeredRules.push("ELEVATED_HOURLY_VELOCITY");
    }

    // 2. High Total Split Amount Check
    if (context.totalAmount >= 50000) {
      score += 30;
      triggeredRules.push("LARGE_AMOUNT_SPLIT (> ₹50,000)");
    } else if (context.totalAmount >= 20000) {
      score += 15;
      triggeredRules.push("MODERATE_AMOUNT_SPLIT (> ₹20,000)");
    }

    // 3. High Chunk Volume Check
    if (context.totalChunks > 15) {
      score += 20;
      triggeredRules.push("EXCESSIVE_CHUNKS_COUNT (> 15)");
    }

    // 4. Unusual Hours Check (Midnight to 5:00 AM)
    if (currentHour >= 0 && currentHour < 5) {
      score += 15;
      triggeredRules.push("OFF_HOURS_EXECUTION (12 AM - 5 AM)");
    }

    // 5. Suspicious VPA Pattern Check (e.g. invalid domain or temp handles)
    if (!context.payeeUpi.includes("@") || context.payeeUpi.split("@")[0].length < 3) {
      score += 35;
      triggeredRules.push("SUSPICIOUS_UPI_FORMAT");
    }

    // Normalize score to max 100
    score = Math.min(100, score);

    let riskTier: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    let recommendation: "PROCEED" | "DELAY_STRETCH" | "MANUAL_REVIEW" = "PROCEED";

    if (score >= 70) {
      riskTier = "HIGH";
      recommendation = "MANUAL_REVIEW";
    } else if (score >= 40) {
      riskTier = "MEDIUM";
      recommendation = "DELAY_STRETCH";
    }

    return {
      score,
      riskTier,
      triggeredRules,
      recommendation,
    };
  }
}
