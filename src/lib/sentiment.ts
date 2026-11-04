/**
 * A small word-list sentiment check for inbox messages. It runs locally, so message text never leaves the server.
 * Good enough to sort the inbox; people can always read the message.
 */
const POSITIVE = ["love", "loved", "loving", "great", "amazing", "awesome", "best", "thanks", "thank", "delicious", "perfect", "beautiful", "excellent", "fantastic", "wonderful", "favorite", "favourite", "yum", "yummy", "nice", "happy", "recommend", "brilliant", "cute", "gorgeous", "incredible", "superb", "congrats", "congratulations", "❤", "❤️", "😍", "🥰", "👏", "🔥", "😊", "🙌", "💯", "👍"];
const NEGATIVE = ["bad", "terrible", "awful", "worst", "hate", "hated", "disappointed", "disappointing", "rude", "cold", "late", "never", "broken", "wrong", "refund", "slow", "dirty", "gross", "horrible", "poor", "overpriced", "unacceptable", "complaint", "angry", "waited", "waiting", "sick", "missing", "scam", "useless", "😡", "😠", "👎", "🤮", "😤"];
const NEGATORS = new Set(["not", "no", "never", "isn't", "wasn't", "don't", "didn't", "can't", "won't", "hardly"]);

export type Sentiment = "positive" | "neutral" | "negative";

export function classifySentiment(text: string): Sentiment {
  const lower = text.toLowerCase();
  const words = lower.match(/[\p{L}']+/gu) ?? [];
  let score = 0;
  words.forEach((w, i) => {
    const flip = i > 0 && NEGATORS.has(words[i - 1]!) ? -1 : 1;
    if (POSITIVE.includes(w)) score += flip;
    else if (NEGATIVE.includes(w) && w !== "never") score -= flip;
  });
  for (const e of POSITIVE) if (!/\p{L}/u.test(e) && lower.includes(e)) score += 1;
  for (const e of NEGATIVE) if (!/\p{L}/u.test(e) && lower.includes(e)) score -= 1;
  if (/!{2,}/.test(text) && score < 0) score -= 1;
  return score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
}
