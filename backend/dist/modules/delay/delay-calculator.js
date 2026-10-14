"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DelayCalculator = void 0;
class DelayCalculator {
    static calculateDelayMs(chunkNumber, riskScore = 0, options) {
        if (chunkNumber <= 1) {
            return 0;
        }
        const baseDelay = options?.baseDelayMs ?? 2500;
        const minJitter = options?.minJitterMs ?? 500;
        const maxJitter = options?.maxJitterMs ?? 2000;
        let riskMultiplier = 1.0;
        if (riskScore >= 70) {
            riskMultiplier = 2.2;
        }
        else if (riskScore >= 40) {
            riskMultiplier = 1.5;
        }
        const jitter = Math.floor(Math.random() * (maxJitter - minJitter + 1)) + minJitter;
        const progressiveDelay = (chunkNumber - 1) * baseDelay;
        return Math.round((progressiveDelay + jitter) * riskMultiplier);
    }
}
exports.DelayCalculator = DelayCalculator;
//# sourceMappingURL=delay-calculator.js.map