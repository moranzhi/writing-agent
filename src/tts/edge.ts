import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { readTtsCache, ttsCacheKey, writeTtsCache } from "./cache.js";
import {
  DEFAULT_EDGE_VOICE,
  type TtsSynthesizeParams,
  type TtsSynthesizeResult,
} from "./types.js";

/** Edge SSML 单段不宜过长；按句切到约此字数 */
const CHUNK_TARGET = 1200;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function resolveVoice(explicit?: string): string {
  const fromEnv = process.env.WRITING_AGENT_TTS_VOICE?.trim();
  return (explicit?.trim() || fromEnv || DEFAULT_EDGE_VOICE).trim();
}

function splitChunks(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= CHUNK_TARGET) return [cleaned];

  const parts: string[] = [];
  let buf = "";
  const pushBuf = () => {
    const t = buf.trim();
    if (t) parts.push(t);
    buf = "";
  };

  const sentences = cleaned.split(/(?<=[。！？!?；;\n])/u);
  for (const s of sentences) {
    if (!s) continue;
    if (buf.length + s.length > CHUNK_TARGET && buf.length > 0) {
      pushBuf();
    }
    buf += s;
    if (buf.length >= CHUNK_TARGET) pushBuf();
  }
  pushBuf();
  return parts.length ? parts : [cleaned.slice(0, CHUNK_TARGET)];
}

async function streamToBuffer(
  audioStream: NodeJS.ReadableStream,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function synthesizeChunk(voice: string, text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(escapeXml(text));
  return streamToBuffer(audioStream);
}

/**
 * Edge 在线神经 TTS（微软朗读通道）。文本会发往微软服务端。
 */
export async function synthesizeWithEdge(
  params: TtsSynthesizeParams,
): Promise<TtsSynthesizeResult> {
  const text = params.text.trim();
  if (!text) throw new Error("TTS 文本为空");
  const voice = resolveVoice(params.voice);
  const key = ttsCacheKey({
    provider: "edge",
    voice,
    text,
    extra: params.cacheKey,
  });
  const hit = readTtsCache(key, "mp3");
  if (hit) {
    return {
      audio: hit,
      contentType: "audio/mpeg",
      provider: "edge",
      voice,
      cached: true,
    };
  }

  const chunks = splitChunks(text);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    buffers.push(await synthesizeChunk(voice, chunk));
  }
  const audio = Buffer.concat(buffers);
  writeTtsCache(key, "mp3", audio);
  return {
    audio,
    contentType: "audio/mpeg",
    provider: "edge",
    voice,
    cached: false,
  };
}
