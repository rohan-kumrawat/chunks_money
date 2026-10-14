"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChunkCalculator = void 0;
class ChunkCalculator {
    static calculateChunks(totalAmount, maxChunkAmount = ChunkCalculator.DEFAULT_MAX_CHUNK) {
        if (totalAmount <= 0) {
            throw new Error("Total amount must be greater than 0");
        }
        if (maxChunkAmount <= 0) {
            throw new Error("Max chunk amount must be greater than 0");
        }
        const chunks = [];
        let remaining = Math.round(totalAmount * 100);
        const chunkLimitInPaise = Math.round(maxChunkAmount * 100);
        let chunkNumber = 1;
        while (remaining > 0) {
            const currentChunkInPaise = Math.min(remaining, chunkLimitInPaise);
            chunks.push({
                chunkNumber,
                amount: currentChunkInPaise / 100,
                currency: "INR",
            });
            remaining -= currentChunkInPaise;
            chunkNumber++;
        }
        return chunks;
    }
}
exports.ChunkCalculator = ChunkCalculator;
ChunkCalculator.DEFAULT_MAX_CHUNK = 1999.00;
//# sourceMappingURL=chunk-calculator.js.map