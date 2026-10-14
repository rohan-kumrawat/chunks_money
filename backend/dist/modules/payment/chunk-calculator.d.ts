export interface ChunkPlan {
    chunkNumber: number;
    amount: number;
    currency: string;
}
export declare class ChunkCalculator {
    static readonly DEFAULT_MAX_CHUNK = 1999;
    static calculateChunks(totalAmount: number, maxChunkAmount?: number): ChunkPlan[];
}
