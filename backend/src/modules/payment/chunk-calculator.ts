export interface ChunkPlan {
  chunkNumber: number;
  amount: number;
  currency: string;
}

export class ChunkCalculator {
  static readonly DEFAULT_MAX_CHUNK = 1999.00;

  /**
   * Splits a total payment amount into discrete chunks strictly <= maxChunkAmount.
   * e.g., ₹5,000.00 with limit ₹1,999.00 -> [1999.00, 1999.00, 1002.00]
   */
  static calculateChunks(totalAmount: number, maxChunkAmount: number = ChunkCalculator.DEFAULT_MAX_CHUNK): ChunkPlan[] {
    if (totalAmount <= 0) {
      throw new Error("Total amount must be greater than 0");
    }

    if (maxChunkAmount <= 0) {
      throw new Error("Max chunk amount must be greater than 0");
    }

    const chunks: ChunkPlan[] = [];
    // Round to 2 decimal places to prevent floating point inaccuracies
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
