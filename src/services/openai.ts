export async function analyzeImageWithOpenAIVision(imageUrl: string, openaiApiKey: string): Promise<string> {
  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: "gpt-4-vision-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "이 이미지를 설명해줘. UI/UX, 텍스트, 버튼 등 시각적 요소를 중심으로." },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ],
    max_tokens: 512
  };
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("OpenAI Vision API 호출 실패");
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
} 