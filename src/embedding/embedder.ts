import { FlagEmbedding, EmbeddingModel } from "fastembed";

let modelPromise: Promise<FlagEmbedding> | undefined;

function getModel(): Promise<FlagEmbedding> {
  if (!modelPromise) {
    modelPromise = FlagEmbedding.init({ model: EmbeddingModel.AllMiniLML6V2 });
  }
  return modelPromise;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = await getModel();
  const vectors: number[][] = [];
  for await (const batch of model.embed(texts)) {
    for (const v of batch) vectors.push(Array.from(v));
  }
  return vectors;
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
