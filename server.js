import express from 'express';
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { experimental_evaluate } from 'ai';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// 招待時にもらったAPIキーを環境変数 TYPESAFE_AI_API_KEY にセットしてから起動してください
// 例: TYPESAFE_AI_API_KEY=xxxx node server.js
const typeSafeAi = createTypeSafeAi({
  apiKey: process.env.TYPESAFE_AI_API_KEY,
});

// ── 1. Jevに聞く質問 ──────────────────────────────
// ここに項目を足すと、判定できる内容が増えます。
// 値は「はい/いいえ」で答えられる日本語の質問にしてください。
const QUESTIONS = {
  greeting: 'このメッセージは挨拶（こんにちは、おはよう、はじめまして など）か？',
  identity: 'このメッセージは、相手が誰なのか（名前・正体・何者なのか）を尋ねているか？',
  cancel: 'このメッセージに、キャンセル・解約・取り消しの意図が含まれているか？',
  thanks: 'このメッセージは、お礼や感謝を述べているか？',
};

// ── 2. 判定結果ごとの返事 ─────────────────────────
// 上から順に照合し、最初に当てはまったものを返します。
// 複数当てはまる場合に備えて、具体的なものほど上に置いてください。
const RULES = [
  {
    name: 'greeting+identity',
    when: (is) => is.greeting && is.identity,
    reply: 'こんにちは！jevです。',
  },
  {
    name: 'identity',
    when: (is) => is.identity,
    reply: 'jevです。メッセージの内容を判定するAIです。',
  },
  {
    name: 'cancel',
    when: (is) => is.cancel,
    reply: 'キャンセルのご相談ですね。担当者におつなぎします。',
  },
  {
    name: 'greeting',
    when: (is) => is.greeting,
    reply: 'こんにちは！なにか送ってもらえれば、その内容を判定します。',
  },
  {
    name: 'thanks',
    when: (is) => is.thanks,
    reply: 'どういたしまして！',
  },
];

// どのルールにも当てはまらなかったときの返事
const FALLBACK_REPLY = 'すみません、うまく聞き取れませんでした。別の言い方で送ってみてください。';

// 判定結果(is)から、返す内容を決める
export function decide(is) {
  const rule = RULES.find((r) => r.when(is));
  return {
    reply: rule ? rule.reply : FALLBACK_REPLY,
    matched: rule ? rule.name : null,
    judgment: rule ? 1 : 0,
  };
}

app.post('/api/check', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    // QUESTIONS を experimental_evaluate に渡せる形に変換する
    const questions = Object.fromEntries(
      Object.entries(QUESTIONS).map(([key, instructions]) => [
        key,
        { type: 'boolean', instructions },
      ]),
    );

    const result = await experimental_evaluate({
      model: typeSafeAi.evaluationModel('jev-latest'),
      state: { message },
      questions,
    });

    // probability(true である確率)が0.5以上なら true とみなす
    const probabilities = {};
    const is = {};
    for (const key of Object.keys(QUESTIONS)) {
      const probability = result.answers[key].probability;
      probabilities[key] = probability;
      is[key] = probability >= 0.5;
    }

    res.json({ ...decide(is), probabilities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'TypeSafe AI呼び出しに失敗しました: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
