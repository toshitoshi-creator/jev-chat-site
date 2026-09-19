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

// ここを判定したい内容に合わせて自由に書き換えてください
const JUDGE_INSTRUCTIONS = 'このメッセージに「キャンセル」という内容が含まれているか？';

app.post('/api/check', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const result = await experimental_evaluate({
      model: typeSafeAi.evaluationModel('jev-latest'),
      state: { message },
      questions: {
        matched: {
          type: 'boolean',
          instructions: JUDGE_INSTRUCTIONS,
        },
      },
    });

    // probability(true である確率)が0.5以上なら1、未満なら0とする
    const probability = result.answers.matched.probability;
    const judgment = probability >= 0.5 ? 1 : 0;

    const replyText =
      judgment === 1
        ? `はい、その内容が含まれていると判定しました。（確信度: ${(probability * 100).toFixed(1)}%）`
        : `いいえ、その内容は含まれていないと判定しました。（確信度: ${((1 - probability) * 100).toFixed(1)}%）`;

    res.json({ judgment, probability, reply: replyText });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'TypeSafe AI呼び出しに失敗しました: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
