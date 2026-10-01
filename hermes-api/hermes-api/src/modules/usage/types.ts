export interface UsageDto {
    id: string;
    taskId: string | null;
    kind: "REQUESTS" | "TOKENS";
    amount: number;
    model: string | null;
    createdAt: string;
}
