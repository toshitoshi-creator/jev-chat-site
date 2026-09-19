// Jev だけで文章を作る。
//
// Jevは文章を生成しないが、choice型で「候補のうちどれが最も適切か」を選ばせることはできる。
//
// 当初は「1語選ぶ → 下書きに足す → また選ぶ」を繰り返す方式にしていたが、
// 実際に動かすと毎回ほぼ同じ確率分布が返ってきた。Jevは下書きの続きを予測するのではなく、
// 毎回 message に対する答えを選び直していたため、同じ語が選ばれ続けてしまう。
//
// そこで「同じ質問を繰り返す」のをやめ、役割の違う枠(スロット)を用意して
// それぞれ別の質問として1回のリクエストで埋める方式にした。
// Jevは全質問を1リクエストでまとめて評価するので、これは1往復で済む。

// ── スロット定義 ──────────────────────────────────
// 文を「書き出し」「本体」「結び」の3枠に分け、枠ごとに候補を持たせる。
// どの枠にも「なし」があるので、当てはまらないときは何も置かずに済む。
export const SLOTS = [
  {
    key: 'opening',
    description: '書き出し',
    options: {
      なし: { text: '', description: '書き出しを置かず、いきなり本題に入る' },
      挨拶: { text: 'こんにちは！', description: '相手が挨拶してきたとき' },
      初対面: { text: 'はじめまして！', description: '相手が初対面の挨拶をしたとき' },
      相槌: { text: 'なるほど、', description: '相手の話を受け止めるとき' },
      お礼: { text: 'ありがとうございます！', description: '相手がお礼を言ってきたとき' },
      謝罪: { text: 'すみません、', description: '謝るとき' },
    },
  },
  {
    key: 'body',
    description: '返事の本体',
    options: {
      名乗る: { text: 'jevです。', description: '相手が名前や正体を尋ねたとき' },
      役割: {
        text: 'メッセージの内容を判定するAIです。',
        description: '自分が何をするものかを説明するとき',
      },
      できること: {
        text: 'メッセージに特定の内容が含まれているかを判定できます。',
        description: '何ができるのか、能力や機能を尋ねられたとき',
      },
      肯定: { text: 'はい、できます。', description: '可否を尋ねられて、できると答えるとき' },
      否定: { text: 'いいえ、できません。', description: '可否を尋ねられて、できないと答えるとき' },
      了解: { text: 'わかりました。', description: '依頼や連絡を受けて了解するとき' },
      取次: {
        text: 'キャンセルのご相談ですね。担当者におつなぎします。',
        description: 'キャンセルや解約の相談をされたとき',
      },
      不明: {
        text: 'すみません、うまく聞き取れませんでした。',
        description: '上のどれにも当てはまらず、答えようがないとき',
      },
    },
  },
  {
    key: 'closing',
    description: '結び',
    options: {
      なし: { text: '', description: '何も付け足さずに終える' },
      用件を聞く: {
        text: 'なにか聞きたいことはありますか？',
        description: '会話を続けたいとき',
      },
      促す: { text: 'お気軽にどうぞ。', description: '相手を促して終えるとき' },
      丁寧: { text: 'よろしくお願いします。', description: '丁寧に締めるとき' },
      言い直しを促す: {
        text: '別の言い方で送ってみてください。',
        description: '聞き取れなかったとき',
      },
    },
  },
];

// ── 1回目の質問: 各スロットを何で埋めるか ──────────
export function buildSlotQuestions(slots = SLOTS) {
  const questions = {};
  for (const slot of slots) {
    questions[slot.key] = {
      type: 'choice',
      instructions: `messageへの返信を組み立てます。「${slot.description}」に置くものとして最も適切なのはどれですか？`,
      criteria: Object.fromEntries(
        Object.entries(slot.options).map(([label, o]) => [label, o.description]),
      ),
    };
  }
  return questions;
}

function rank(probabilities, n) {
  if (!probabilities) return [];
  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, probability]) => ({ label, probability }));
}

// スロットの選択結果から文を組み立てる
function assemble(slots, labels) {
  return slots.map((s) => s.options[labels[s.key]]?.text ?? '').join('');
}

// ── 2回目の質問: 組み上がった文を比べる ────────────
// 本体を1位・2位・3位に差し替えた案を作り、文として一番良いものをJevに選ばせる。
export function buildCompareQuestions(variants) {
  return {
    best: {
      type: 'choice',
      instructions: 'messageへの返信として最も自然で適切なのはどれですか？',
      criteria: Object.fromEntries(variants.map((v, i) => [`案${i + 1}`, v.text])),
    },
    quality: {
      type: 'score',
      instructions: '案1はmessageへの返信としてどれくらい適切ですか？',
      criteria: ['的外れ', 'かみ合っていない', '悪くない', '適切'],
    },
  };
}

// ── 本体 ──────────────────────────────────────────
// evaluate は ({ state, questions }) => result の関数。
// 本物のJevでもテスト用の偽物でも差し替えられるように引数で受け取る。
export async function generateReply({
  message,
  evaluate,
  slots = SLOTS,
  compare = true,
}) {
  const trace = [];

  // 1往復目: 全スロットを同時に埋める
  const slotResult = await evaluate({
    state: { message },
    questions: buildSlotQuestions(slots),
  });

  const labels = {};
  for (const slot of slots) {
    const answer = slotResult.answers[slot.key];
    labels[slot.key] = answer.choice;
    trace.push({
      phase: 'slot',
      slot: slot.description,
      chosen: answer.choice,
      text: slot.options[answer.choice]?.text ?? '',
      candidates: rank(answer.probabilities, 3),
    });
  }

  const base = assemble(slots, labels);
  if (!compare) return { reply: base, trace };

  // 本体の2位・3位に差し替えた案を作る
  const bodySlot = slots.find((s) => s.key === 'body');
  const bodyRanking = rank(slotResult.answers.body?.probabilities, 3);
  const variants = [{ label: labels.body, text: base }];
  for (const { label } of bodyRanking) {
    if (variants.length >= 3) break;
    if (label === labels.body || !bodySlot.options[label]) continue;
    variants.push({
      label,
      text: assemble(slots, { ...labels, body: label }),
    });
  }

  if (variants.length < 2) {
    trace.push({ phase: 'compare', skipped: '比較する案が1つしかない' });
    return { reply: base, trace };
  }

  // 2往復目: 案を文として比べる
  const compareResult = await evaluate({
    state: { message },
    questions: buildCompareQuestions(variants),
  });

  const winnerIndex = Number(String(compareResult.answers.best.choice).replace(/\D/g, '')) - 1;
  const winner = variants[winnerIndex] ?? variants[0];

  trace.push({
    phase: 'compare',
    variants: variants.map((v, i) => ({ name: `案${i + 1}`, body: v.label, text: v.text })),
    chosen: compareResult.answers.best.choice,
    candidates: rank(compareResult.answers.best.probabilities, 3),
    score: compareResult.answers.quality?.score,
  });

  return { reply: winner.text, trace };
}
