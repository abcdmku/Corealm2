/** What the chat bar sends to: nearby players, the party, or one named player. */
export type ChatTarget = { channel: "nearby" } | { channel: "party" } | { channel: "whisper"; name: string };

/** Slash commands: `/s`, `/p`, `/w name`, `/r`. A command with no text switches the bar's channel. */
export function parseChatInput(raw: string, current: ChatTarget, replyTo: string | null):
  { target: ChatTarget; text: string } | { error: string } {
  const text = raw.trim();
  if (!text.startsWith("/")) return { target: current, text };
  const [, verb = "", rest = ""] = /^\/(\S*)\s*([\s\S]*)$/.exec(text) ?? [];
  switch (verb.toLowerCase()) {
    case "s": case "say": return { target: { channel: "nearby" }, text: rest };
    case "p": case "party": return { target: { channel: "party" }, text: rest };
    case "w": case "whisper": case "tell": case "msg": {
      const [, name = "", message = ""] = /^(\S*)\s*([\s\S]*)$/.exec(rest) ?? [];
      return name ? { target: { channel: "whisper", name }, text: message } : { error: "Type /w, a player name, then your message." };
    }
    case "r": case "reply":
      return replyTo ? { target: { channel: "whisper", name: replyTo }, text: rest } : { error: "Nobody has whispered you yet." };
    default: return { error: "Unknown chat command. Use /s, /p, /w name or /r." };
  }
}
