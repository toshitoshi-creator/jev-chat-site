// Jev だけで文章を作るための探索ループ。
//
// Jevは文章を生成しないが、choice型で「候補のうちどれが最も自然か」を選ばせることはできる。
// そこで「候補を出す → 選ばせる → つなげる」を繰り返して文を組み立てる。
// 言語モデルのデコード処理を、語彙を自前の候補リストに置き換えて外側で書いている形になる。

// ── 候補バンク ────────────────────────────────────
// カテゴリごとに、続きの候補を並べる。
// キーが実際に出力される文字列、値はJevへの説明。
export const PHRASE_BANK = {
  greeting: {
    description: '挨拶',
    phrases: {
      'こんにちは': 'ふつうの挨拶',
      'はじめまして': '初対面のとき',
      'おはようございます': '朝の挨拶',
      'こんばんは': '夜の挨拶',
    },
  },
  selfIntro: {
    description: '自分が何者かを名乗る',
    phrases: {
      '！jevです': '名前を名乗る',
      '。わたしはjevといいます': '丁寧に名乗る',
      '。メッセージの内容を判定するAIです': '役割を説明する',
    },
  },
  ack: {
    description: '相手の発言を受け止める相槌',
    phrases: {
      'なるほど': '納得したとき',
      'そうなんですね': '共感を示すとき',
      'ありがとうございます': 'お礼を言われたときの返し',
      'すみません': '謝るとき',
    },
  },
  answer: {
    description: '質問への直接の答え',
    phrases: {
      'はい': '肯定',
      'いいえ': '否定',
      '、わかりました': '了解したとき',
      '、できます': '可能だと伝えるとき',
      '、できません': '不可能だと伝えるとき',
    },
  },
  askBack: {
    description: '相手に聞き返す',
    phrases: {
      '。なにか聞きたいことはありますか？': '用件をたずねる',
      '。どうされましたか？': '困りごとをたずねる',
      '。もう少し詳しく教えてください': '説明を求める',
    },
  },
  closing: {
    description: '文を締めくくる',
    phrases: {
      '。よろしくお願いします': '丁寧に締める',
      '。お気軽にどうぞ': '相手を促して締める',
      '。': '句点だけで終える',
    },
  },
};

// ── 質問の組み立て ────────────────────────────────
// Jevは「全質問を1リクエストで同じstateに対して」評価する。
// そこでカテゴリ選択と、全カテゴリ分の候補選択を同時に投げ、
// 返ってきたカテゴリに対応する答えだけを採用する。1語につき1往復で済む。
export function buildQuestions(bank = PHRASE_BANK) {
  const questions = {
    category: {
      type: 'choice',
      instructions:
        'draftはmessageへの返信の書きかけです。この続きとして最も自然な種類はどれですか？',
      criteria: Object.fromEntries(
        Object.entries(bank).map(([key, cat]) => [key, cat.description]),
      ),
    },
    finished: {
      type: 'boolean',
      instructions:
        'draftは、messageへの返信としてすでに文が完結していますか？',
    },
  };

  for (const [key, cat] of Object.entries(bank)) {
    questions[`pick_${key}`] = {
      type: 'choice',
      instructions: `「${cat.description}」として、draftの続きに最も自然なものはどれですか？`,
      criteria: cat.phrases,
    };
  }

  return questions;
}

// 確率分布から上位n件を取り出す(probabilitiesは返らないことがある)
function topCandidates(probabilities, n = 3) {
  if (!probabilities) return null;
  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([phrase, probability]) => ({ phrase, probability }));
}

// 既に使った候補を避けて次点を選ぶ(同じ語を繰り返して無限ループになるのを防ぐ)
function chooseUnused(picked, used) {
  if (!used.has(picked.choice)) return picked.choice;

  const ranked = topCandidates(picked.probabilities, Infinity) ?? [];
  const alternative = ranked.find((c) => !used.has(c.phrase));
  return alternative ? alternative.phrase : null;
}

// ── 生成ループ ────────────────────────────────────
// evaluate は ({ state, questions }) => result の関数。
// 本物のJevでもテスト用の偽物でも差し替えられるように引数で受け取る。
export async function generateReply({
  message,
  evaluate,
  bank = PHRASE_BANK,
  maxSteps = 6,
  stopThreshold = 0.7,
}) {
  const questions = buildQuestions(bank);
  const used = new Set();
  const trace = [];
  let draft = '';

  for (let step = 1; step <= maxSteps; step++) {
    const result = await evaluate({ state: { message, draft }, questions });

    const finished = result.answers.finished.probability;
    if (draft !== '' && finished >= stopThreshold) {
      trace.push({ step, action: 'stop', finished });
      break;
    }

    const category = result.answers.category.choice;
    const picked = result.answers[`pick_${category}`];
    if (!picked) {
      trace.push({ step, action: 'error', category, reason: '候補が見つからない' });
      break;
    }

    const phrase = chooseUnused(picked, used);
    if (phrase === null) {
      trace.push({ step, action: 'exhausted', category, finished });
      break;
    }

    used.add(phrase);
    draft += phrase;
    trace.push({
      step,
      action: 'append',
      category,
      phrase,
      finished,
      candidates: topCandidates(picked.probabilities),
    });
  }

  return { reply: draft, trace, steps: trace.length };
}
