import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function callOpenAI(prompt: string): Promise<string> {
  const chat = await openai.chat.completions.create({
    model: "gpt-4", // or "gpt-3.5-turbo" for faster/cheaper
    messages: [
      {
        role: "system",
        content: "당신은 UX Writing 전문가입니다. 사용자의 디자인 문맥과 텍스트를 기반으로 적절성 여부와 개선점을 판단합니다.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  return chat.choices[0].message?.content ?? "(응답 없음)";
}
