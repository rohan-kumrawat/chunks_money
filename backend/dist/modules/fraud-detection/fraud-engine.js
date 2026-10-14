"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FraudDetectionEngine = void 0;
class FraudDetectionEngine {
    static evaluate(context) {
        let score = 0;
        const triggeredRules = [];
        const date = context.timestamp || new Date();
        const currentHour = date.getHours();
        const recentCount = context.recentTransactionsCount || 0;
        if (recentCount >= 8) {
            score += 40;
            triggeredRules.push("CRITICAL_HOURLY_VELOCITY_EXCEEDED");
        }
        else if (recentCount >= 4) {
            score += 25;
            triggeredRules.push("ELEVATED_HOURLY_VELOCITY");
        }
        if (context.totalAmount >= 50000) {
            score += 30;
            triggeredRules.push("LARGE_AMOUNT_SPLIT (> ₹50,000)");
        }
        else if (context.totalAmount >= 20000) {
            score += 15;
            triggeredRules.push("MODERATE_AMOUNT_SPLIT (> ₹20,000)");
        }
        if (context.totalChunks > 15) {
            score += 20;
            triggeredRules.push("EXCESSIVE_CHUNKS_COUNT (> 15)");
        }
        if (currentHour >= 0 && currentHour < 5) {
            score += 15;
            triggeredRules.push("OFF_HOURS_EXECUTION (12 AM - 5 AM)");
        }
        if (!context.payeeUpi.includes("@") || context.payeeUpi.split("@")[0].length < 3) {
            score += 35;
            triggeredRules.push("SUSPICIOUS_UPI_FORMAT");
        }
        score = Math.min(100, score);
        let riskTier = "LOW";
        let recommendation = "PROCEED";
        if (score >= 70) {
            riskTier = "HIGH";
            recommendation = "MANUAL_REVIEW";
        }
        else if (score >= 40) {
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
exports.FraudDetectionEngine = FraudDetectionEngine;
//# sourceMappingURL=fraud-engine.js.map