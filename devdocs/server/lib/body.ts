import type { IncomingMessage } from "node:http";
export class BodyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function readJsonBody(request: IncomingMessage, maximum = 1_048_576): Promise<unknown> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw new BodyError(415, "Expected application/json");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maximum) throw new BodyError(413, "Request body exceeds 1 MB");
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new BodyError(400, "Malformed JSON body"); }
}
