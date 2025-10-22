import { z } from "zod";

export interface RoutingInput {
  transcript: string;
  hints?: string[];
}

export interface RoutingCandidate {
  client: string;
  project: string;
  confidence: number;
}

export interface DaraExtractInput {
  docContent: string;
}

export interface DaraExtractResult {
  decisions: DaraCandidate[];
  assumptions: DaraCandidate[];
  risks: DaraCandidate[];
  actions: DaraCandidate[];
}

export interface DaraCandidate {
  title: string;
  detail?: string;
  confidence: number;
}

const routingCandidateSchema = z.object({
  client: z.string(),
  project: z.string(),
  confidence: z.number().min(0).max(1)
});

export const suggestRouting = (input: RoutingInput): RoutingCandidate[] => {
  const lines = input.transcript.split("\n").map((line) => line.toLowerCase());
  const candidates: RoutingCandidate[] = [];
  const clientMatch = lines.find((line) => line.includes("client"));
  const projectMatch = lines.find((line) => line.includes("project"));

  if (clientMatch) {
    candidates.push({
      client: clientMatch.replace(/.*client[:：]\s*/i, "").trim() || "不明顧客",
      project: projectMatch?.replace(/.*project[:：]\s*/i, "").trim() ?? "新規案件",
      confidence: 0.82
    });
  } else {
    candidates.push({ client: "未分類", project: "保留", confidence: 0.55 });
  }

  return candidates.slice(0, 3).map((candidate) => routingCandidateSchema.parse(candidate));
};

const keywords = {
  decisions: ["決定", "合意", "実施"],
  assumptions: ["想定", "仮定", "前提"],
  risks: ["リスク", "懸念", "課題"],
  actions: ["TODO", "対応", "アクション", "フォロー"]
} satisfies Record<keyof DaraExtractResult, string[]>;

export const extractDara = (input: DaraExtractInput): DaraExtractResult => {
  const sentences = input.docContent.split(/\n|。/).map((s) => s.trim()).filter(Boolean);
  const result: DaraExtractResult = {
    decisions: [],
    assumptions: [],
    risks: [],
    actions: []
  };

  sentences.forEach((sentence) => {
    (Object.keys(keywords) as Array<keyof DaraExtractResult>).forEach((kind) => {
      if (keywords[kind].some((keyword) => sentence.includes(keyword))) {
        result[kind].push({
          title: sentence.slice(0, 80),
          detail: sentence,
          confidence: keywordConfidence(sentence)
        });
      }
    });
  });

  return result;
};

const keywordConfidence = (sentence: string): number => {
  const lengthFactor = Math.min(sentence.length / 120, 1);
  return Number(Math.min(0.9, 0.6 + lengthFactor * 0.3).toFixed(2));
};
